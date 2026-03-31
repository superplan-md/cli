const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  getSuperplanRoot,
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
} = require('./helpers.cjs');

function runGit(cwd, args, env) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function initGitRepo(sandbox) {
  runGit(sandbox.cwd, ['init'], sandbox.env);
  runGit(sandbox.cwd, ['config', 'user.name', 'Superplan Test'], sandbox.env);
  runGit(sandbox.cwd, ['config', 'user.email', 'superplan@example.com'], sandbox.env);
  await fs.writeFile(path.join(sandbox.cwd, 'README.md'), '# Test\n', 'utf-8');
  runGit(sandbox.cwd, ['add', 'README.md'], sandbox.env);
  runGit(sandbox.cwd, ['commit', '-m', 'init'], sandbox.env);
}

test('linked git worktrees share the same Superplan project state root', async () => {
  const sandbox = await makeSandbox('superplan-project-identity-');
  await initGitRepo(sandbox);

  const linkedWorktreePath = path.join(sandbox.root, 'linked-worktree');
  runGit(sandbox.cwd, ['worktree', 'add', '-b', 'feature/project-identity', linkedWorktreePath, 'HEAD'], sandbox.env);

  const mainRoot = getSuperplanRoot(sandbox, sandbox.cwd);
  const linkedRoot = getSuperplanRoot(sandbox, linkedWorktreePath);
  assert.equal(mainRoot, linkedRoot);

  await fs.mkdir(path.join(mainRoot, 'changes'), { recursive: true });
  const payload = parseCliJson(await runCli([
    'change',
    'new',
    'shared-root-demo',
    '--json',
  ], {
    cwd: linkedWorktreePath,
    env: sandbox.env,
  }));

  assert.equal(payload.ok, true);
  assert.equal(await pathExists(path.join(mainRoot, 'changes', 'shared-root-demo', 'tasks.md')), true);
});

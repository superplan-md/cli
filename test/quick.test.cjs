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

test('quick scaffolds and activates a single-task change through the fast path', async () => {
  const sandbox = await makeSandbox('superplan-quick-fast-path-');
  await fs.mkdir(path.join(getSuperplanRoot(sandbox), 'changes'), { recursive: true });

  const payload = parseCliJson(await runCli([
    'quick',
    'Fix login bug',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.title, 'Fix login bug');
  assert.equal(payload.data.task_id, 'T-001');
  assert.match(payload.data.task_ref, /^[a-z0-9-]+\/T-001$/);
  assert.equal(payload.data.status, 'in_progress');
  assert.equal(payload.data.next_action.type, 'stop');
  assert.match(payload.data.next_action.outcome, /is active/);

  const [changeId] = payload.data.task_ref.split('/');
  const superplanRoot = getSuperplanRoot(sandbox);
  const changeRoot = path.join(superplanRoot, 'changes', changeId);
  assert.equal(await pathExists(path.join(changeRoot, 'tasks.md')), true);
  assert.equal(await pathExists(path.join(changeRoot, 'tasks', 'T-001.md')), true);

  const taskContent = await fs.readFile(path.join(changeRoot, 'tasks', 'T-001.md'), 'utf-8');
  assert.match(taskContent, /task_id: T-001/);
  assert.match(taskContent, /title: Fix login bug/);
});

test('quick scaffolds work but does not activate a new task when another change is already in progress', async () => {
  const sandbox = await makeSandbox('superplan-quick-active-guard-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };
  const superplanRoot = getSuperplanRoot(sandbox);

  await initGitRepo(sandbox);
  parseCliJson(await runCli(['init', '--yes', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  await fs.mkdir(path.join(superplanRoot, 'changes'), { recursive: true });
  parseCliJson(await runCli([
    'change',
    'new',
    'alpha',
    '--title',
    'Alpha',
    '--single-task',
    'Alpha task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  const alphaStartPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(alphaStartPayload.ok, true);
  assert.equal(alphaStartPayload.data.task_id, 'alpha/T-001');
  assert.equal(alphaStartPayload.data.action, 'start');

  const quickPayload = parseCliJson(await runCli([
    'quick',
    'Beta task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  assert.equal(quickPayload.ok, true);
  assert.equal(quickPayload.data.task_id, 'T-001');
  assert.match(quickPayload.data.task_ref, /^[a-z0-9-]+\/T-001$/);
  assert.equal(quickPayload.data.status, 'ready');
  assert.equal(quickPayload.data.next_action.type, 'stop');
  assert.match(
    quickPayload.data.next_action.outcome,
    /(Resolve the current in-progress task first|dedicated execution root is ready)/,
  );

  const bareRunPayload = parseCliJson(await runCli(['run', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(bareRunPayload.ok, true);
  assert.equal(bareRunPayload.data.task_id, null);
  assert.equal(bareRunPayload.data.action, 'idle');
  assert.match(bareRunPayload.data.reason, /alpha\/T-001/);
  assert.equal(bareRunPayload.data.next_action.type, 'stop');
  assert.match(bareRunPayload.data.next_action.outcome, /superplan run alpha\/T-001 --json/);
});

test('quick fails loudly when worktree isolation cannot be ensured', async () => {
  const sandbox = await makeSandbox('superplan-quick-worktree-failure-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };

  await initGitRepo(sandbox);
  await fs.mkdir(path.join(getSuperplanRoot(sandbox), 'changes'), { recursive: true });

  parseCliJson(await runCli([
    'change', 'new', 'alpha', '--title', 'Alpha', '--single-task', 'Alpha task', '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  const brokenWorktreeRoot = path.join(sandbox.root, '.superplan-worktrees', path.basename(sandbox.cwd));
  await fs.mkdir(path.dirname(brokenWorktreeRoot), { recursive: true });
  await fs.writeFile(brokenWorktreeRoot, 'not-a-directory\n', 'utf-8');

  const quickPayload = parseCliJson(await runCli([
    'quick',
    'Beta task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  assert.equal(quickPayload.ok, false);
  assert.equal(quickPayload.error.code, 'QUICK_WORKTREE_ENSURE_FAILED');
  assert.match(quickPayload.error.message, /was scaffolded, but isolating it into a dedicated execution root failed/i);
});

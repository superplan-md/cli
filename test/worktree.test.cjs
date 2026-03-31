const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  loadDistModule,
  getSuperplanRoot,
  makeSandbox,
  parseCliJson,
  pathExists,
  readJson,
  runCli,
  withSandboxEnv,
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

test('worktree ensure isolates a second active change into a dedicated execution root', async () => {
  const sandbox = await makeSandbox('superplan-worktree-ensure-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };

  await initGitRepo(sandbox);
  await fs.mkdir(path.join(getSuperplanRoot(sandbox), 'changes'), { recursive: true });

  const alphaChange = parseCliJson(await runCli([
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
  assert.equal(alphaChange.ok, true);

  const alphaRun = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(alphaRun.ok, true);
  assert.equal(alphaRun.data.action, 'start');

  const betaChange = parseCliJson(await runCli([
    'change',
    'new',
    'beta',
    '--title',
    'Beta',
    '--single-task',
    'Beta task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(betaChange.ok, true);

  const ensurePayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.change_id, 'beta');
  assert.equal(ensurePayload.data.kind, 'worktree');
  assert.notEqual(await fs.realpath(ensurePayload.data.execution_root), await fs.realpath(sandbox.cwd));
  assert.equal(await pathExists(path.join(ensurePayload.data.execution_root, '.git')), true);

  const betaRun = parseCliJson(await runCli(['run', 'beta/T-001', '--json'], {
    cwd: ensurePayload.data.execution_root,
    env: sessionEnv,
  }));
  assert.equal(betaRun.ok, true);
  assert.equal(betaRun.data.action, 'start');
  assert.equal(await fs.realpath(betaRun.data.active_task_context.execution_root.path), await fs.realpath(ensurePayload.data.execution_root));

  const executionRoots = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'execution-roots.json'));
  const attachedChanges = Object.values(executionRoots.roots)
    .map(root => root.attached_change_id)
    .filter(Boolean)
    .sort();
  assert.deepEqual(attachedChanges, ['alpha', 'beta']);
});

test('worktree ensure does not reuse a dirty checkout even when no active change is attached there', async () => {
  const sandbox = await makeSandbox('superplan-worktree-dirty-root-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };

  await initGitRepo(sandbox);
  await fs.mkdir(path.join(getSuperplanRoot(sandbox), 'changes'), { recursive: true });

  const betaChange = parseCliJson(await runCli([
    'change',
    'new',
    'beta',
    '--title',
    'Beta',
    '--single-task',
    'Beta task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(betaChange.ok, true);

  await fs.writeFile(path.join(sandbox.cwd, 'dirty.txt'), 'leftover edits\n', 'utf-8');

  const ensurePayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.kind, 'worktree');
  assert.notEqual(await fs.realpath(ensurePayload.data.execution_root), await fs.realpath(sandbox.cwd));
});

test('explicit continue keeps session focus attached to the task execution root instead of the invoking checkout', async () => {
  const sandbox = await makeSandbox('superplan-worktree-continue-focus-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };

  await initGitRepo(sandbox);
  const superplanRoot = getSuperplanRoot(sandbox);
  await fs.mkdir(path.join(superplanRoot, 'changes'), { recursive: true });

  parseCliJson(await runCli([
    'change', 'new', 'alpha', '--title', 'Alpha', '--single-task', 'Alpha task', '--json',
  ], { cwd: sandbox.cwd, env: sessionEnv }));
  parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  parseCliJson(await runCli([
    'change', 'new', 'beta', '--title', 'Beta', '--single-task', 'Beta task', '--json',
  ], { cwd: sandbox.cwd, env: sessionEnv }));
  const ensurePayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  const betaRun = parseCliJson(await runCli(['run', 'beta/T-001', '--json'], {
    cwd: ensurePayload.data.execution_root,
    env: sessionEnv,
  }));
  assert.equal(betaRun.ok, true);
  assert.equal(betaRun.data.action, 'start');

  const continuePayload = parseCliJson(await runCli(['run', 'beta/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(continuePayload.ok, true);
  assert.equal(continuePayload.data.action, 'continue');
  assert.equal(
    await fs.realpath(continuePayload.data.active_task_context.execution_root.path),
    await fs.realpath(ensurePayload.data.execution_root),
  );

  const focusState = await readJson(path.join(superplanRoot, 'runtime', 'session-focus.json'));
  assert.equal(
    await fs.realpath(focusState.sessions['session-A'].execution_root_path),
    await fs.realpath(ensurePayload.data.execution_root),
  );
  assert.equal(
    await fs.realpath(focusState.sessions['session-A'].worktree_baseline.snapshot.workspace_root),
    await fs.realpath(ensurePayload.data.execution_root),
  );
});

test('explicit continue refuses to hand off an active task when its managed execution root is stale', async () => {
  const sandbox = await makeSandbox('superplan-worktree-stale-continue-');
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

  parseCliJson(await runCli([
    'change', 'new', 'beta', '--title', 'Beta', '--single-task', 'Beta task', '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  const ensurePayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  parseCliJson(await runCli(['run', 'beta/T-001', '--json'], {
    cwd: ensurePayload.data.execution_root,
    env: sessionEnv,
  }));

  runGit(ensurePayload.data.execution_root, ['checkout', '-B', 'rogue'], sessionEnv);

  const continuePayload = parseCliJson(await runCli(['run', 'beta/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(continuePayload.ok, false);
  assert.equal(continuePayload.error.code, 'EXECUTION_ROOT_STALE');
  assert.match(continuePayload.error.message, /worktree ensure beta --json/);
});

test('reattaching a change to a new execution root detaches older roots for that same change', async () => {
  const sandbox = await makeSandbox('superplan-worktree-dedupe-');
  await initGitRepo(sandbox);

  const linkedWorktreePath = path.join(sandbox.root, 'linked-worktree');
  runGit(sandbox.cwd, ['worktree', 'add', '-b', 'feature/dedupe', linkedWorktreePath, 'HEAD'], sandbox.env);

  await withSandboxEnv(sandbox, async () => {
    const executionRoots = loadDistModule('cli/execution-roots.js');
    await executionRoots.attachCurrentExecutionRoot({ changeId: 'demo' });
    await executionRoots.attachExecutionRootByPath({ rootPath: linkedWorktreePath, changeId: 'demo' });
  });

  const state = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'execution-roots.json'));
  const attachedDemoRoots = Object.values(state.roots).filter(root => root.attached_change_id === 'demo');
  assert.equal(attachedDemoRoots.length, 1);
  assert.equal(await fs.realpath(attachedDemoRoots[0].path), await fs.realpath(linkedWorktreePath));
});

test('execution-root refresh recovers a path that was previously marked missing', async () => {
  const sandbox = await makeSandbox('superplan-worktree-missing-recovery-');
  await initGitRepo(sandbox);

  await withSandboxEnv(sandbox, async () => {
    const executionRoots = loadDistModule('cli/execution-roots.js');
    await executionRoots.attachCurrentExecutionRoot({ changeId: null });
  });

  const statePath = path.join(getSuperplanRoot(sandbox), 'runtime', 'execution-roots.json');
  const state = await readJson(statePath);
  const [rootId] = Object.keys(state.roots);
  state.roots[rootId].status = 'missing';
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');

  const listPayload = parseCliJson(await runCli(['worktree', 'list', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(listPayload.ok, true);

  const sandboxRootPath = await fs.realpath(sandbox.cwd);
  const recoveredRoot = await (async () => {
    for (const root of listPayload.data.roots) {
      if (await fs.realpath(root.path) === sandboxRootPath) {
        return root;
      }
    }
    return null;
  })();
  assert.ok(recoveredRoot);
  assert.equal(recoveredRoot.status, 'detached');
  assert.equal(typeof recoveredRoot.head, 'string');
});

test('worktree ensure repairs managed branch drift for an attached worktree', async () => {
  const sandbox = await makeSandbox('superplan-worktree-branch-repair-');
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

  parseCliJson(await runCli([
    'change', 'new', 'beta', '--title', 'Beta', '--single-task', 'Beta task', '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  const ensurePayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.kind, 'worktree');

  runGit(ensurePayload.data.execution_root, ['checkout', '-B', 'rogue'], sessionEnv);

  const staleListPayload = parseCliJson(await runCli(['worktree', 'list', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  const staleRoot = staleListPayload.data.roots.find(root => path.resolve(root.path) === path.resolve(ensurePayload.data.execution_root));
  assert.ok(staleRoot);
  assert.equal(staleRoot.status, 'stale');
  assert.equal(staleRoot.branch, 'rogue');

  const repairedPayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: ensurePayload.data.execution_root,
    env: sessionEnv,
  }));
  assert.equal(repairedPayload.ok, true);

  const repairedListPayload = parseCliJson(await runCli(['worktree', 'list', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  const repairedRoot = repairedListPayload.data.roots.find(root => path.resolve(root.path) === path.resolve(ensurePayload.data.execution_root));
  assert.ok(repairedRoot);
  assert.equal(repairedRoot.status, 'attached');
  assert.equal(repairedRoot.branch, 'sp/beta');
});

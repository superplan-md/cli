const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
} = require('./helpers.cjs');

test('change new creates a canonical change skeleton', async () => {
  const sandbox = await makeSandbox('superplan-change-new-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  const result = await runCli(['change', 'new', 'improve-planning', '--title', 'Improve Planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      change_id: 'improve-planning',
      root: '.superplan/changes/improve-planning',
      files: [
        '.superplan/changes/improve-planning/tasks.md',
        '.superplan/changes/improve-planning/tasks',
      ],
    },
    error: null,
  });

  const tasksIndexPath = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md');
  assert.equal(await pathExists(tasksIndexPath), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks')), true);

  const tasksIndexContent = await fs.readFile(tasksIndexPath, 'utf-8');
  assert.match(tasksIndexContent, /# Improve Planning/);
  assert.match(tasksIndexContent, /- Change ID: `improve-planning`/);
  assert.match(tasksIndexContent, /## Tasks/);
});

test('change new from a nested repo directory uses the repo-root superplan workspace', async () => {
  const sandbox = await makeSandbox('superplan-change-new-nested-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');
  const changeRoot = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });

  const result = await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: nestedCwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      change_id: 'improve-planning',
      root: path.relative(nestedCwd, changeRoot) || changeRoot,
      files: [
        path.relative(nestedCwd, path.join(changeRoot, 'tasks.md')) || path.join(changeRoot, 'tasks.md'),
        path.relative(nestedCwd, path.join(changeRoot, 'tasks')) || path.join(changeRoot, 'tasks'),
      ],
    },
    error: null,
  });
  assert.equal(await pathExists(path.join(changeRoot, 'tasks.md')), true);
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('task new creates globally unique task contracts and updates each change index', async () => {
  const sandbox = await makeSandbox('superplan-task-new-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const firstTaskPayload = parseCliJson(await runCli([
    'task',
    'new',
    'improve-planning',
    '--title',
    'Add scaffolding command',
    '--priority',
    'high',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.deepEqual(firstTaskPayload, {
    ok: true,
    data: {
      task_id: 'T-001',
      change_id: 'improve-planning',
      path: '.superplan/changes/improve-planning/tasks/T-001.md',
    },
    error: null,
  });

  const secondTaskPayload = parseCliJson(await runCli([
    'task',
    'new',
    'improve-planning',
    '--title',
    'Add help coverage',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(secondTaskPayload.data.task_id, 'T-002');

  parseCliJson(await runCli(['change', 'new', 'release-polish', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const thirdTaskPayload = parseCliJson(await runCli([
    'task',
    'new',
    'release-polish',
    '--title',
    'Add release notes',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.deepEqual(thirdTaskPayload, {
    ok: true,
    data: {
      task_id: 'T-003',
      change_id: 'release-polish',
      path: '.superplan/changes/release-polish/tasks/T-003.md',
    },
    error: null,
  });

  const firstTaskPath = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks', 'T-001.md');
  const firstTaskContent = await fs.readFile(firstTaskPath, 'utf-8');
  assert.match(firstTaskContent, /task_id: T-001/);
  assert.match(firstTaskContent, /priority: high/);
  assert.match(firstTaskContent, /## Description\nAdd scaffolding command/);
  assert.match(firstTaskContent, /## Acceptance Criteria\n- \[ \] Define the first acceptance criterion\./);

  const tasksIndexContent = await fs.readFile(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md'), 'utf-8');
  assert.match(tasksIndexContent, /- `T-001` Add scaffolding command/);
  assert.match(tasksIndexContent, /- `T-002` Add help coverage/);

  const secondChangeIndexContent = await fs.readFile(path.join(sandbox.cwd, '.superplan', 'changes', 'release-polish', 'tasks.md'), 'utf-8');
  assert.match(secondChangeIndexContent, /- `T-003` Add release notes/);

  const parsePayload = parseCliJson(await runCli(['parse', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const diagnosticCodes = new Set(parsePayload.data.diagnostics.map(diagnostic => diagnostic.code));
  assert.equal(diagnosticCodes.has('DUPLICATE_TASK_ID'), false);
});

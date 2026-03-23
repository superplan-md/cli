const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  runCli,
  writeChangeGraph,
  writeFile,
} = require('./helpers.cjs');

test('validate accepts a graph-only change before task contracts are scaffolded', async () => {
  const sandbox = await makeSandbox('superplan-validate-graph-only-');

  await writeChangeGraph(sandbox.cwd, 'improve-planning', {
    title: 'Improve Planning',
    entries: [
      {
        task_id: 'T-001',
        title: 'Add scaffolding command',
      },
      {
        task_id: 'T-002',
        title: 'Add help coverage',
        depends_on_all: ['T-001'],
      },
    ],
  });

  const result = await runCli(['validate', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.valid, true);
  assert.equal(payload.data.diagnostics.length, 0);
  assert.equal(payload.data.changes[0].change_id, 'improve-planning');
  assert.deepEqual(
    payload.data.changes[0].graph.tasks.map(task => task.task_id),
    ['T-001', 'T-002'],
  );
});

test('validate reports graph dependency errors deterministically', async () => {
  const sandbox = await makeSandbox('superplan-validate-graph-errors-');

  await writeChangeGraph(sandbox.cwd, 'improve-planning', {
    title: 'Improve Planning',
    entries: [
      {
        task_id: 'T-001',
        title: 'Add scaffolding command',
        depends_on_all: ['T-999'],
      },
      {
        task_id: 'T-001',
        title: 'Duplicate entry',
      },
    ],
  });

  const result = await runCli(['validate', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);
  const codes = new Set(payload.data.diagnostics.map(diagnostic => diagnostic.code));

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.valid, false);
  assert.equal(codes.has('TASK_ENTRY_DUPLICATE'), true);
  assert.equal(codes.has('DEPENDENCY_TARGET_UNKNOWN'), true);
});

test('validate reports task contracts that are not declared in the graph', async () => {
  const sandbox = await makeSandbox('superplan-validate-unreferenced-task-');

  await writeChangeGraph(sandbox.cwd, 'improve-planning', {
    title: 'Improve Planning',
    entries: [
      {
        task_id: 'T-001',
        title: 'Add scaffolding command',
      },
    ],
  });

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks', 'T-002.md'), `---
task_id: T-002
status: pending
---

## Description
Unreferenced contract

## Acceptance Criteria
- [ ] A
`);

  const result = await runCli(['validate', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(payload.data.valid, false);
  assert.equal(
    payload.data.diagnostics.some(diagnostic => diagnostic.code === 'TASK_FILE_UNREFERENCED' && diagnostic.task_id === 'T-002'),
    true,
  );
});

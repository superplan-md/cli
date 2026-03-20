const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  runCli,
  writeFile,
} = require('./helpers.cjs');

test('parse defaults to .superplan/changes and reports missing directory gracefully', async () => {
  const sandbox = await makeSandbox('superplan-parse-missing-');
  const result = await runCli(['parse', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data.tasks, []);
  assert.equal(payload.data.diagnostics[0].code, 'CHANGES_DIR_MISSING');
  assert.equal(payload.error, null);
});

test('parse extracts task fields, dependencies, priority, and acceptance criteria from a task file', async () => {
  const sandbox = await makeSandbox('superplan-parse-file-');
  const taskPath = path.join(sandbox.cwd, '.superplan', 'changes', 'feature-a', 'tasks', 'T-001.md');

  await writeFile(taskPath, `---
task_id: T-001
status: pending
priority: high
depends_on_all: [T-000]
depends_on_any: [T-010, T-011]
---

## Description
Ship the parser

## Acceptance Criteria
- [ ] Parses frontmatter
- [x] Parses acceptance criteria
`);

  const result = await runCli(['parse', taskPath, '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(result);
  const task = payload.data.tasks[0];

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(task.task_id, 'T-001');
  assert.equal(task.status, 'pending');
  assert.equal(task.priority, 'high');
  assert.deepEqual(task.depends_on_all, ['T-000']);
  assert.deepEqual(task.depends_on_any, ['T-010', 'T-011']);
  assert.equal(task.description, 'Ship the parser');
  assert.deepEqual(task.acceptance_criteria, [
    { text: 'Parses frontmatter', done: false },
    { text: 'Parses acceptance criteria', done: true },
  ]);
  assert.equal(task.total_acceptance_criteria, 2);
  assert.equal(task.completed_acceptance_criteria, 1);
  assert.equal(task.progress_percent, 50);
  assert.deepEqual(payload.data.diagnostics, []);
  assert.equal(payload.error, null);
});

test('parse accepts multi-line yaml-style dependency lists in frontmatter', async () => {
  const sandbox = await makeSandbox('superplan-parse-multiline-');
  const taskPath = path.join(sandbox.cwd, '.superplan', 'changes', 'feature-b', 'tasks', 'T-002.md');

  await writeFile(taskPath, `---
task_id: T-002
status: pending
depends_on_all:
  - T-000
  - T-001
depends_on_any:
  - T-010
  - T-011
---

## Description
Ship the parser with friendlier frontmatter

## Acceptance Criteria
- [ ] Parses multi-line dependencies
`);

  const result = await runCli(['parse', taskPath, '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(result);
  const task = payload.data.tasks[0];

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(task.task_id, 'T-002');
  assert.deepEqual(task.depends_on_all, ['T-000', 'T-001']);
  assert.deepEqual(task.depends_on_any, ['T-010', 'T-011']);
  assert.deepEqual(payload.data.diagnostics, []);
  assert.equal(payload.error, null);
});

test('parse reports duplicate ids and invalid task diagnostics across a change set', async () => {
  const sandbox = await makeSandbox('superplan-parse-diagnostics-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
---

## Description
Valid enough

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-002.md'), `---
task_id: T-001
status: draft
---

## Description

## Acceptance Criteria
`);

  const result = await runCli(['parse', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(result);
  const diagnosticCodes = new Set(payload.data.diagnostics.map(diagnostic => diagnostic.code));

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert(diagnosticCodes.has('DUPLICATE_TASK_ID'));
  assert(diagnosticCodes.has('INVALID_STATUS_VALUE'));
  assert(diagnosticCodes.has('TASK_WITH_NO_DESCRIPTION'));
  assert(diagnosticCodes.has('EMPTY_ACCEPTANCE_CRITERIA'));
  assert.equal(payload.error, null);
});

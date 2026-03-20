const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  parseCliJson,
  makeSandbox,
  readJson,
  runCli,
  writeFile,
  writeJson,
} = require('./helpers.cjs');

test('overlay --help explains overlay lifecycle subcommands', async () => {
  const result = await runCli(['overlay', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Overlay commands:/);
  assert.match(result.stdout, /ensure\s+Prepare overlay runtime state and request the companion to be visible/);
  assert.match(result.stdout, /show\s+Request the overlay companion to become visible/);
  assert.match(result.stdout, /hide\s+Request the overlay companion to hide its window/);
});

test('overlay ensure writes snapshot and visibility control files', async () => {
  const sandbox = await makeSandbox('superplan-overlay-ensure-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Primary task
Show the current task description in the overlay

## Acceptance Criteria
- [ ] A
`);

  const ensureResult = await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const ensurePayload = parseCliJson(ensureResult);
  const realWorkspacePath = await fs.realpath(sandbox.cwd);

  assert.equal(ensureResult.code, 0);
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.requested_action, 'ensure');
  assert.equal(ensurePayload.data.visible, true);

  const snapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(snapshot.workspace_path, realWorkspacePath);
  assert.equal(snapshot.active_task, null);
  assert.deepEqual(snapshot.board.in_progress, []);
  assert.deepEqual(snapshot.board.backlog, [{
    task_id: 'T-001',
    title: 'Primary task',
    description: 'Show the current task description in the overlay',
    status: 'backlog',
  }]);
  assert.equal(snapshot.attention_state, 'normal');
  assert.deepEqual(snapshot.events, []);

  const control = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  assert.deepEqual(control, {
    workspace_path: realWorkspacePath,
    requested_action: 'ensure',
    updated_at: control.updated_at,
    visible: true,
  });
  assert.equal(typeof control.updated_at, 'string');
});

test('run ensures overlay visibility when it starts and continues work', async () => {
  const sandbox = await makeSandbox('superplan-overlay-run-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-150.md'), `---
task_id: T-150
status: pending
priority: high
---

## Description
Run overlay task

## Acceptance Criteria
- [ ] A
`);

  parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const startedSnapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  const startedControl = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  assert.equal(startedSnapshot.active_task?.task_id, 'T-150');
  assert.equal(startedSnapshot.active_task?.status, 'in_progress');
  assert.equal(startedControl.requested_action, 'ensure');
  assert.equal(startedControl.visible, true);

  parseCliJson(await runCli(['overlay', 'hide', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const hiddenControl = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  assert.equal(hiddenControl.requested_action, 'hide');
  assert.equal(hiddenControl.visible, false);

  parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const continuedControl = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  assert.equal(continuedControl.requested_action, 'ensure');
  assert.equal(continuedControl.visible, true);
});

test('task start and resume ensure overlay visibility', async () => {
  const sandbox = await makeSandbox('superplan-overlay-pickup-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-250.md'), `---
task_id: T-250
status: pending
priority: high
---

## Description
Pickup overlay task

## Acceptance Criteria
- [ ] A
`);

  parseCliJson(await runCli(['task', 'start', 'T-250', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const startedControl = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  const startedSnapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(startedControl.requested_action, 'ensure');
  assert.equal(startedControl.visible, true);
  assert.equal(startedSnapshot.active_task?.task_id, 'T-250');

  parseCliJson(await runCli(['overlay', 'hide', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  parseCliJson(await runCli(['task', 'block', 'T-250', '--reason', 'Need to pause', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  parseCliJson(await runCli(['task', 'resume', 'T-250', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const resumedControl = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  const resumedSnapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(resumedControl.requested_action, 'ensure');
  assert.equal(resumedControl.visible, true);
  assert.equal(resumedSnapshot.active_task?.task_id, 'T-250');
  assert.equal(resumedSnapshot.active_task?.status, 'in_progress');
});

test('task lifecycle updates overlay snapshot and emits high-signal alerts only', async () => {
  const feedbackSandbox = await makeSandbox('superplan-overlay-feedback-');

  await writeFile(path.join(feedbackSandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-200.md'), `---
task_id: T-200
status: pending
priority: high
---

## Description
Needs review

## Acceptance Criteria
- [ ] A
`);

  parseCliJson(await runCli(['task', 'start', 'T-200', '--json'], { cwd: feedbackSandbox.cwd, env: feedbackSandbox.env }));
  parseCliJson(await runCli(['task', 'request-feedback', 'T-200', '--message', 'Please review', '--json'], { cwd: feedbackSandbox.cwd, env: feedbackSandbox.env }));

  const feedbackSnapshot = await readJson(path.join(feedbackSandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(feedbackSnapshot.active_task, null);
  assert.equal(feedbackSnapshot.attention_state, 'needs_feedback');
  assert.deepEqual(feedbackSnapshot.board.needs_feedback, [{
    task_id: 'T-200',
    title: 'Needs review',
    status: 'needs_feedback',
    started_at: feedbackSnapshot.board.needs_feedback[0].started_at,
    updated_at: feedbackSnapshot.board.needs_feedback[0].updated_at,
    message: 'Please review',
  }]);
  assert.equal(typeof feedbackSnapshot.board.needs_feedback[0].started_at, 'string');
  assert.equal(typeof feedbackSnapshot.board.needs_feedback[0].updated_at, 'string');
  assert.equal(feedbackSnapshot.events.length, 1);
  assert.equal(feedbackSnapshot.events[0].kind, 'needs_feedback');

  const doneSandbox = await makeSandbox('superplan-overlay-done-');

  await writeFile(path.join(doneSandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-300.md'), `---
task_id: T-300
status: pending
priority: high
---

## Description
Finish me

## Acceptance Criteria
- [x] A
`);

  await writeJson(path.join(doneSandbox.cwd, '.superplan', 'runtime', 'tasks.json'), {
    tasks: {
      'T-300': {
        status: 'in_progress',
        started_at: '2026-03-19T12:00:00.000Z',
      },
    },
  });

  const reviewPayload = parseCliJson(await runCli(['task', 'complete', 'T-300', '--json'], { cwd: doneSandbox.cwd, env: doneSandbox.env }));
  assert.equal(reviewPayload.data.status, 'in_review');

  parseCliJson(await runCli(['task', 'approve', 'T-300', '--json'], { cwd: doneSandbox.cwd, env: doneSandbox.env }));

  const doneSnapshot = await readJson(path.join(doneSandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(doneSnapshot.attention_state, 'all_tasks_done');
  assert.deepEqual(doneSnapshot.board.done, [{
    task_id: 'T-300',
    title: 'Finish me',
    status: 'done',
    started_at: '2026-03-19T12:00:00.000Z',
    completed_at: doneSnapshot.board.done[0].completed_at,
    updated_at: doneSnapshot.board.done[0].updated_at,
  }]);
  assert.equal(typeof doneSnapshot.board.done[0].completed_at, 'string');
  assert.equal(typeof doneSnapshot.board.done[0].updated_at, 'string');
  assert.equal(doneSnapshot.events.length, 1);
  assert.equal(doneSnapshot.events[0].kind, 'all_tasks_done');
});

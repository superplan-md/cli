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

async function waitForFile(targetPath, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fs.readFile(targetPath, 'utf-8');
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  throw new Error(`Timed out waiting for ${targetPath}`);
}

test('overlay --help explains overlay lifecycle subcommands', async () => {
  const result = await runCli(['overlay', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Overlay commands:/);
  assert.match(result.stdout, /enable\s+\[--global\]/);
  assert.match(result.stdout, /disable\s+\[--global\]/);
  assert.match(result.stdout, /status\s+Show effective overlay preference/);
  assert.match(result.stdout, /ensure\s+Prepare overlay runtime state and launch or reveal the installed companion/);
  assert.match(result.stdout, /show\s+Launch or reveal the installed overlay companion/);
  assert.match(result.stdout, /hide\s+Request the overlay companion to hide its window/);
});

test('overlay ensure keeps the companion hidden until overlay support is enabled', async () => {
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
  assert.equal(ensurePayload.data.applied_action, 'hide');
  assert.equal(ensurePayload.data.visible, false);
  assert.equal(ensurePayload.data.enabled, false);
  assert.equal(ensurePayload.data.reason, 'disabled');

  const snapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(snapshot.workspace_path, realWorkspacePath);
  assert.equal(snapshot.active_task, null);
  assert.deepEqual(snapshot.board.in_progress, []);
  assert.deepEqual(snapshot.board.backlog, [{
    task_id: 'T-001',
    title: 'Primary task',
    description: 'Show the current task description in the overlay',
    status: 'backlog',
    completed_acceptance_criteria: 0,
    total_acceptance_criteria: 1,
    progress_percent: 0,
  }]);
  assert.equal(snapshot.attention_state, 'normal');
  assert.deepEqual(snapshot.events, []);

  const control = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay-control.json'));
  assert.deepEqual(control, {
    workspace_path: realWorkspacePath,
    requested_action: 'hide',
    updated_at: control.updated_at,
    visible: false,
  });
  assert.equal(typeof control.updated_at, 'string');
});

test('overlay enable turns on local overlay behavior and allows ensure to show the companion', async () => {
  const sandbox = await makeSandbox('superplan-overlay-enable-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-010.md'), `---
task_id: T-010
status: pending
priority: high
---

## Description
Enable overlay

## Acceptance Criteria
- [ ] A
`);

  const enablePayload = parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(enablePayload.ok, true);
  assert.equal(enablePayload.data.enabled, true);
  assert.equal(enablePayload.data.local_enabled, true);

  const ensurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.requested_action, 'ensure');
  assert.equal(ensurePayload.data.applied_action, 'ensure');
  assert.equal(ensurePayload.data.visible, true);
  assert.equal(ensurePayload.data.enabled, true);
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

  parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
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

test('overlay ensure launches the installed companion with the explicit workspace path', async () => {
  const sandbox = await makeSandbox('superplan-overlay-launch-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-launch.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-011.md'), `---
task_id: T-011
status: pending
priority: high
---

## Description
Launch overlay companion

## Acceptance Criteria
- [ ] A
`);

  parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const ensurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);

  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.applied_action, 'ensure');
  assert.equal(ensurePayload.data.companion.attempted, true);
  assert.equal(ensurePayload.data.companion.launched, true);
  assert.equal(ensurePayload.data.companion.executable_path, fakeOverlayPath);
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(launchOutput, new RegExp(`${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('task start auto-launches the overlay companion when overlay is enabled', async () => {
  const sandbox = await makeSandbox('superplan-overlay-task-start-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-task-start.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-012.md'), `---
task_id: T-012
status: pending
priority: high
depends_on_all: []
depends_on_any: []
---

## Description
Auto-launch overlay on execution

## Acceptance Criteria
- [ ] A
`);

  parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const startPayload = parseCliJson(await runCli(['task', 'start', 'T-012', '--json'], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);

  assert.equal(startPayload.ok, true);
  assert.equal(startPayload.data.status, 'in_progress');
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
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

  parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
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

test('overlay snapshot includes active-task checklist progress counts', async () => {
  const sandbox = await makeSandbox('superplan-overlay-progress-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-020.md'), `---
task_id: T-020
status: pending
priority: high
depends_on_all: []
depends_on_any: []
---

## Description
Track real checklist progress

## Acceptance Criteria
- [x] First
- [ ] Second
- [ ] Third
`);

  parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const snapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(snapshot.active_task.task_id, 'T-020');
  assert.equal(snapshot.active_task.completed_acceptance_criteria, 1);
  assert.equal(snapshot.active_task.total_acceptance_criteria, 3);
  assert.equal(snapshot.active_task.progress_percent, 33);
  assert.deepEqual(snapshot.board.in_progress, [{
    task_id: 'T-020',
    title: 'Track real checklist progress',
    status: 'in_progress',
    completed_acceptance_criteria: 1,
    total_acceptance_criteria: 3,
    progress_percent: 33,
  }]);
});

test('sync refreshes overlay snapshot after task checklist edits', async () => {
  const sandbox = await makeSandbox('superplan-overlay-sync-');
  const taskPath = path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-021.md');

  await writeFile(taskPath, `---
task_id: T-021
status: pending
priority: high
depends_on_all: []
depends_on_any: []
---

## Description
Refresh overlay after checklist edits

## Acceptance Criteria
- [x] First
- [ ] Second
`);

  parseCliJson(await runCli(['overlay', 'enable', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  let snapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(snapshot.active_task.completed_acceptance_criteria, 1);
  assert.equal(snapshot.active_task.total_acceptance_criteria, 2);

  await writeFile(taskPath, `---
task_id: T-021
status: pending
priority: high
depends_on_all: []
depends_on_any: []
---

## Description
Refresh overlay after checklist edits

## Acceptance Criteria
- [x] First
- [x] Second
`);

  parseCliJson(await runCli(['sync', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  snapshot = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(snapshot.active_task, null);
  assert.equal(snapshot.attention_state, 'all_tasks_done');
  assert.deepEqual(snapshot.board.done, [{
    task_id: 'T-021',
    title: 'Refresh overlay after checklist edits',
    status: 'done',
    completed_acceptance_criteria: 2,
    total_acceptance_criteria: 2,
    progress_percent: 100,
  }]);
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
    completed_acceptance_criteria: 0,
    total_acceptance_criteria: 1,
    progress_percent: 0,
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
        updated_at: '2026-03-19T12:00:00.000Z',
      },
    },
  });

  const reviewPayload = parseCliJson(await runCli(['task', 'complete', 'T-300', '--json'], { cwd: doneSandbox.cwd, env: doneSandbox.env }));
  assert.equal(reviewPayload.data.status, 'in_review');

  const approvePayload = parseCliJson(await runCli(['task', 'approve', 'T-300', '--json'], { cwd: doneSandbox.cwd, env: doneSandbox.env }));
  assert.equal(approvePayload.data.status, 'done');

  const doneSnapshot = await readJson(path.join(doneSandbox.cwd, '.superplan', 'runtime', 'overlay.json'));
  assert.equal(doneSnapshot.attention_state, 'all_tasks_done');
  assert.deepEqual(doneSnapshot.board.done, [{
    task_id: 'T-300',
    title: 'Finish me',
    status: 'done',
    completed_acceptance_criteria: 1,
    total_acceptance_criteria: 1,
    progress_percent: 100,
    started_at: '2026-03-19T12:00:00.000Z',
    completed_at: doneSnapshot.board.done[0].completed_at,
    updated_at: doneSnapshot.board.done[0].updated_at,
  }]);
  assert.equal(typeof doneSnapshot.board.done[0].completed_at, 'string');
  assert.equal(typeof doneSnapshot.board.done[0].updated_at, 'string');
  assert.equal(doneSnapshot.events.length, 1);
  assert.equal(doneSnapshot.events[0].kind, 'all_tasks_done');
});

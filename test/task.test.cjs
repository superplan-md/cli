const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  pathExists,
  readJson,
  runCli,
  writeFile,
  writeJson,
} = require('./helpers.cjs');

test('task next, why-next, and status reflect priority-aware ready selection', async () => {
  const sandbox = await makeSandbox('superplan-task-priority-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: low
---

## Description
Low priority task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-002.md'), `---
task_id: T-002
status: pending
priority: high
---

## Description
High priority task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-003.md'), `---
task_id: T-003
status: pending
---

## Description
Default priority task

## Acceptance Criteria
- [ ] A
`);

  const nextResult = await runCli(['task', 'next', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const nextPayload = parseCliJson(nextResult);
  assert.equal(nextPayload.data.task_id, 'T-002');
  assert.equal(nextPayload.data.status, 'ready');
  assert.equal(nextPayload.error, null);

  const whyNextResult = await runCli(['task', 'why-next', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const whyNextPayload = parseCliJson(whyNextResult);
  assert.deepEqual(whyNextPayload, {
    ok: true,
    data: {
      task_id: 'T-002',
      reason: 'Highest priority among ready tasks',
    },
    error: null,
  });

  const statusResult = await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const statusPayload = parseCliJson(statusResult);
  assert.deepEqual(statusPayload.data, {
    active: null,
    ready: ['T-001', 'T-002', 'T-003'],
    in_review: [],
    blocked: [],
    needs_feedback: [],
  });
  assert.equal(statusPayload.error, null);
});

test('run starts the next task and then continues it on the next invocation', async () => {
  const sandbox = await makeSandbox('superplan-run-loop-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-100.md'), `---
task_id: T-100
status: pending
priority: high
---

## Description
Run me

## Acceptance Criteria
- [ ] A
`);

  const firstRunResult = await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const firstRunPayload = parseCliJson(firstRunResult);
  assert.deepEqual(firstRunPayload, {
    ok: true,
    data: {
      task_id: 'T-100',
      action: 'start',
    },
    error: null,
  });

  const runtimeState = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'));
  assert.equal(runtimeState.tasks['T-100'].status, 'in_progress');
  assert.ok(runtimeState.tasks['T-100'].started_at);

  const secondRunResult = await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const secondRunPayload = parseCliJson(secondRunResult);
  assert.deepEqual(secondRunPayload, {
    ok: true,
    data: {
      task_id: 'T-100',
      action: 'continue',
    },
    error: null,
  });
});

test('task start from a nested repo directory writes runtime state at the repo root workspace', async () => {
  const sandbox = await makeSandbox('superplan-task-nested-runtime-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-150.md'), `---
task_id: T-150
status: pending
priority: high
---

## Description
Start from nested cwd

## Acceptance Criteria
- [ ] Works
`);

  const startPayload = parseCliJson(await runCli(['task', 'start', 'T-150', '--json'], {
    cwd: nestedCwd,
    env: sandbox.env,
  }));

  assert.equal(startPayload.data.status, 'in_progress');
  assert.equal((await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'))).tasks['T-150'].status, 'in_progress');
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('task lifecycle supports block, resume, request-feedback, and reset with runtime events', async () => {
  const sandbox = await makeSandbox('superplan-task-lifecycle-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-200.md'), `---
task_id: T-200
status: pending
priority: high
---

## Description
Lifecycle task

## Acceptance Criteria
- [ ] A
`);

  const startPayload = parseCliJson(await runCli(['task', 'start', 'T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(startPayload.data.status, 'in_progress');

  const blockPayload = parseCliJson(await runCli(['task', 'block', 'T-200', '--reason', 'Waiting on review', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(blockPayload.data.status, 'blocked');

  const blockedStatusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(blockedStatusPayload.data, {
    active: null,
    ready: [],
    in_review: [],
    blocked: ['T-200'],
    needs_feedback: [],
  });

  const resumePayload = parseCliJson(await runCli(['task', 'resume', 'T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(resumePayload.data.status, 'in_progress');

  const feedbackPayload = parseCliJson(await runCli(['task', 'request-feedback', 'T-200', '--message', 'Please review', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(feedbackPayload.data.status, 'needs_feedback');

  const feedbackStatusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(feedbackStatusPayload.data, {
    active: null,
    ready: [],
    in_review: [],
    blocked: [],
    needs_feedback: ['T-200'],
  });

  const resetPayload = parseCliJson(await runCli(['task', 'reset', 'T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(resetPayload, {
    ok: true,
    data: {
      task_id: 'T-200',
      reset: true,
    },
    error: null,
  });

  const eventsContent = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'));
  assert.deepEqual(eventsContent, { tasks: {} });

  const eventsOutput = await runCli(['task', 'events', 'T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const eventsPayload = parseCliJson(eventsOutput);
  const eventTypes = eventsPayload.data.events.map(event => event.type);
  assert.deepEqual(eventTypes, [
    'task.started',
    'task.blocked',
    'task.resumed',
    'task.feedback_requested',
    'task.reset',
  ]);
});

test('task complete hands work to review, approve finalizes it, and reopen returns it to implementation', async () => {
  const sandbox = await makeSandbox('superplan-task-complete-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-300.md'), `---
task_id: T-300
status: pending
---

## Description
Complete me

## Acceptance Criteria
- [x] A
- [x] B
`);

  await writeJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'), {
    tasks: {
      'T-300': {
        status: 'in_progress',
        started_at: '2026-03-19T12:00:00.000Z',
      },
    },
  });

  const completePayload = parseCliJson(await runCli(['task', 'complete', 'T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(completePayload, {
    ok: true,
    data: {
      task_id: 'T-300',
      status: 'in_review',
    },
    error: null,
  });

  const showPayload = parseCliJson(await runCli(['task', 'show', 'T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(showPayload.data.task.status, 'in_review');

  const statusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(statusPayload.data, {
    active: null,
    ready: [],
    in_review: ['T-300'],
    blocked: [],
    needs_feedback: [],
  });

  const approvePayload = parseCliJson(await runCli(['task', 'approve', 'T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(approvePayload, {
    ok: true,
    data: {
      task_id: 'T-300',
      status: 'done',
    },
    error: null,
  });

  const approvedShowPayload = parseCliJson(await runCli(['task', 'show', 'T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(approvedShowPayload.data.task.status, 'done');

  const reopenPayload = parseCliJson(await runCli(['task', 'reopen', 'T-300', '--reason', 'Changes requested', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(reopenPayload, {
    ok: true,
    data: {
      task_id: 'T-300',
      status: 'in_progress',
    },
    error: null,
  });

  const reopenedShowPayload = parseCliJson(await runCli(['task', 'show', 'T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(reopenedShowPayload.data.task.status, 'in_progress');

  const reopenedStatusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(reopenedStatusPayload.data, {
    active: 'T-300',
    ready: [],
    in_review: [],
    blocked: [],
    needs_feedback: [],
  });

  const eventsPayload = parseCliJson(await runCli(['task', 'events', 'T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const eventTypes = eventsPayload.data.events.map(event => event.type);
  assert.deepEqual(eventTypes, [
    'task.review_requested',
    'task.approved',
    'task.reopened',
  ]);
});

test('approve and reopen reject invalid review lifecycle transitions', async () => {
  const sandbox = await makeSandbox('superplan-task-review-errors-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-301.md'), `---
task_id: T-301
status: pending
---

## Description
Review me later

## Acceptance Criteria
- [x] A
`);

  const approvePayload = parseCliJson(await runCli(['task', 'approve', 'T-301', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(approvePayload, {
    ok: false,
    error: {
      code: 'TASK_NOT_IN_REVIEW',
      message: 'Task is not in review',
      retryable: false,
    },
  });

  const reopenPayload = parseCliJson(await runCli(['task', 'reopen', 'T-301', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(reopenPayload, {
    ok: false,
    error: {
      code: 'TASK_NOT_REVIEWABLE',
      message: 'Task is not in review or done',
      retryable: false,
    },
  });
});

test('task fix repairs runtime conflicts and doctor deep reports the remaining structural issues', async () => {
  const sandbox = await makeSandbox('superplan-task-fix-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-401.md'), `---
task_id: T-401
status: pending
---

## Description
Valid task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-402.md'), `---
task_id: T-402
status: pending
depends_on_all: [T-999]
---

## Description
Broken dependency task

## Acceptance Criteria
- [ ] A
`);

  await writeJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'), {
    tasks: {
      'T-401': {
        status: 'in_progress',
        started_at: '2026-03-19T10:00:00.000Z',
      },
      'T-402': {
        status: 'in_progress',
        started_at: '2026-03-19T11:00:00.000Z',
      },
    },
  });

  const deepDoctorBefore = parseCliJson(await runCli(['doctor', '--deep', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const doctorCodesBefore = new Set(deepDoctorBefore.data.issues.map(issue => issue.code));
  assert(doctorCodesBefore.has('BROKEN_DEPENDENCY'));
  assert(doctorCodesBefore.has('RUNTIME_CONFLICT_MULTIPLE_IN_PROGRESS'));

  const fixPayload = parseCliJson(await runCli(['task', 'fix', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.deepEqual(fixPayload, {
    ok: true,
    data: {
      fixed: true,
      actions: [
        {
          task_id: 'T-401',
          action: 'reset',
        },
        {
          task_id: 'T-402',
          action: 'block',
          reason: 'Dependency not satisfied',
        },
      ],
    },
    error: null,
  });

  const runtimeState = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'));
  assert.deepEqual(runtimeState, {
    tasks: {
      'T-402': {
        status: 'blocked',
        started_at: '2026-03-19T11:00:00.000Z',
        reason: 'Dependency not satisfied',
        updated_at: runtimeState.tasks['T-402'].updated_at,
      },
    },
  });
  assert.ok(runtimeState.tasks['T-402'].updated_at);

  const deepDoctorAfter = parseCliJson(await runCli(['doctor', '--deep', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const doctorCodesAfter = new Set(deepDoctorAfter.data.issues.map(issue => issue.code));
  assert(doctorCodesAfter.has('BROKEN_DEPENDENCY'));
  assert(!doctorCodesAfter.has('RUNTIME_CONFLICT_MULTIPLE_IN_PROGRESS'));
  assert(!doctorCodesAfter.has('RUNTIME_CONFLICT_DEPENDENCY_NOT_SATISFIED'));
});

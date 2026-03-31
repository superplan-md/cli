const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  runCli,
  writeChangeGraph,
  writeFile,
  writeJson,
  getSuperplanRoot,
} = require('./helpers.cjs');

test('sync reparses tasks, repairs safe runtime drift, and returns a refreshed status summary', async () => {
  const sandbox = await makeSandbox('superplan-sync-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'First task' },
      { task_id: 'T-002', title: 'Second task', depends_on_all: ['T-001'] },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
First task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-002.md'), `---
task_id: T-002
status: pending
---

## Description
Second task

## Acceptance Criteria
- [ ] A
`);

  await writeJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'), {
    tasks: {
      'demo/T-001': {
        status: 'in_progress',
        started_at: '2026-03-19T10:00:00.000Z',
      },
      'demo/T-002': {
        status: 'in_progress',
        started_at: '2026-03-19T11:00:00.000Z',
      },
    },
  });

  const syncPayload = parseCliJson(await runCli(['sync', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.deepEqual(syncPayload, {
    ok: true,
    data: {
      parsed_tasks: 2,
      diagnostics: [],
      runtime_fixed: true,
      actions: [
        {
          task_id: 'demo/T-001',
          action: 'reset',
        },
        {
          task_id: 'demo/T-002',
          action: 'block',
          reason: 'Dependency not satisfied',
        },
      ],
      active: null,
      ready: ['demo/T-001'],
      in_review: [],
      blocked: ['demo/T-002'],
      needs_feedback: [],
      message: 'Sync completed: 2 tasks parsed, 2 runtime fixes applied.',
      next_action: {
        type: 'command',
        command: 'superplan run --json',
        reason: 'There is no active task and at least one task is ready to start.',
      },
    },
    error: null,
  });
});

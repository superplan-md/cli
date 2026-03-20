const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadRuntimeHelpersModule() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'apps',
    'overlay-desktop',
    'src',
    'lib',
    'runtime-helpers.js',
  )).href);
}

test('browser fallback snapshot includes live and completed task timing cues', async () => {
  const { getBrowserFallbackSnapshot } = await loadRuntimeHelpersModule();

  const snapshot = getBrowserFallbackSnapshot('/tmp/workspace');

  assert.equal(snapshot.workspace_path, '/tmp/workspace');
  assert.equal(snapshot.attention_state, 'normal');
  assert.equal(snapshot.active_task?.status, 'in_progress');
  assert.equal(snapshot.active_task?.started_at, '2026-03-19T21:56:00.000Z');
  assert.equal(snapshot.board.in_progress.length, 1);
  assert.equal(snapshot.board.done.length > 0, true);
  assert.equal(snapshot.board.done[0].completed_at, '2026-03-19T21:19:00.000Z');
  assert.equal(snapshot.board.blocked[0].reason.includes('fullscreen'), true);
  assert.deepEqual(snapshot.events, []);
});

test('snapshot task progress prefers active-task checklist progress over board completion counts', async () => {
  const { getSnapshotTaskProgress } = await loadRuntimeHelpersModule();

  const progress = getSnapshotTaskProgress({
    workspace_path: '/tmp/workspace',
    session_id: 'workspace:/tmp/workspace',
    updated_at: '2026-03-20T00:00:00.000Z',
    active_task: {
      task_id: 'T-100',
      title: 'Show real task progress',
      status: 'in_progress',
      completed_acceptance_criteria: 2,
      total_acceptance_criteria: 3,
      progress_percent: 67,
    },
    board: {
      in_progress: [{ task_id: 'T-100', title: 'Show real task progress', status: 'in_progress' }],
      backlog: [{ task_id: 'T-101', title: 'Later', status: 'backlog' }],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
    attention_state: 'normal',
    events: [],
  });

  assert.deepEqual(progress, {
    done: 2,
    total: 3,
    ratio: 2 / 3,
  });
});

test('snapshot task progress falls back to board completion counts when task checklist counts are absent', async () => {
  const { getSnapshotTaskProgress } = await loadRuntimeHelpersModule();

  const progress = getSnapshotTaskProgress({
    workspace_path: '/tmp/workspace',
    session_id: 'workspace:/tmp/workspace',
    updated_at: '2026-03-20T00:00:00.000Z',
    active_task: null,
    board: {
      in_progress: [{ task_id: 'T-100', title: 'Working', status: 'in_progress' }],
      backlog: [{ task_id: 'T-101', title: 'Queued', status: 'backlog' }],
      done: [{ task_id: 'T-099', title: 'Done', status: 'done' }],
      blocked: [],
      needs_feedback: [],
    },
    attention_state: 'normal',
    events: [],
  });

  assert.deepEqual(progress, {
    done: 1,
    total: 3,
    ratio: 1 / 3,
  });
});

test('renderable snapshot helper hides stale all-tasks-done acknowledgement snapshots', async () => {
  const { hasRenderableSnapshotContent } = await loadRuntimeHelpersModule();

  const staleDoneSnapshot = {
    workspace_path: '/tmp/workspace',
    session_id: 'workspace:/tmp/workspace',
    updated_at: '2026-03-20T00:00:00.000Z',
    active_task: null,
    board: {
      in_progress: [],
      backlog: [],
      done: [{
        task_id: 'T-999',
        title: 'Finished task',
        status: 'done',
      }],
      blocked: [],
      needs_feedback: [],
    },
    attention_state: 'all_tasks_done',
    events: [{
      id: 'all_tasks_done:1',
      kind: 'all_tasks_done',
      created_at: '2026-03-20T00:00:00.000Z',
    }],
  };

  assert.equal(
    hasRenderableSnapshotContent(staleDoneSnapshot, Date.parse('2026-03-20T00:10:00.000Z')),
    false,
  );

  assert.equal(
    hasRenderableSnapshotContent(staleDoneSnapshot, Date.parse('2026-03-20T00:03:00.000Z')),
    true,
  );
});

test('renderable snapshot helper still shows actionable backlog and needs-feedback states', async () => {
  const { hasRenderableSnapshotContent } = await loadRuntimeHelpersModule();

  assert.equal(
    hasRenderableSnapshotContent({
      workspace_path: '/tmp/workspace',
      session_id: 'workspace:/tmp/workspace',
      updated_at: '2026-03-20T00:00:00.000Z',
      active_task: null,
      board: {
        in_progress: [],
        backlog: [{ task_id: 'T-100', title: 'Queued', status: 'backlog' }],
        done: [],
        blocked: [],
        needs_feedback: [],
      },
      attention_state: 'normal',
      events: [],
    }),
    true,
  );

  assert.equal(
    hasRenderableSnapshotContent({
      workspace_path: '/tmp/workspace',
      session_id: 'workspace:/tmp/workspace',
      updated_at: '2026-03-20T00:00:00.000Z',
      active_task: null,
      board: {
        in_progress: [],
        backlog: [],
        done: [],
        blocked: [],
        needs_feedback: [{ task_id: 'T-101', title: 'Need input', status: 'needs_feedback' }],
      },
      attention_state: 'needs_feedback',
      events: [],
    }),
    true,
  );
});

test('tauri window availability guard returns false when the runtime getter throws', async () => {
  const { isTauriWindowAvailable } = await loadRuntimeHelpersModule();

  assert.equal(isTauriWindowAvailable(() => {
    throw new TypeError('missing metadata');
  }), false);

  assert.equal(isTauriWindowAvailable(() => ({ label: 'main' })), true);
});

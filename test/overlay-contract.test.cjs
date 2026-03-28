const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadDistModule } = require('./helpers.cjs');

test('overlay snapshot factory supplies stable defaults', () => {
  const { createOverlaySnapshot } = loadDistModule('shared/overlay.js');

  const snapshot = createOverlaySnapshot({
    workspace_path: '/tmp/workspace',
    session_id: 'session-123',
    updated_at: '2026-03-19T21:30:00.000Z',
  });

  assert.deepEqual(snapshot, {
    workspace_path: '/tmp/workspace',
    session_id: 'session-123',
    updated_at: '2026-03-19T21:30:00.000Z',
    focused_change: null,
    active_task: null,
    board: {
      in_progress: [],
      backlog: [],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
    attention_state: 'normal',
    events: [],
  });
});

test('overlay snapshot factory preserves explicit event and board payloads', () => {
  const { createOverlaySnapshot } = loadDistModule('shared/overlay.js');

  const activeTask = {
    task_id: 'T-12',
    title: 'Build overlay prototype',
    description: 'Show active task details in the compact shell',
    status: 'in_progress',
    completed_acceptance_criteria: 2,
    total_acceptance_criteria: 3,
    progress_percent: 67,
    started_at: '2026-03-19T21:00:00.000Z',
    updated_at: '2026-03-19T21:30:00.000Z',
  };
  const feedbackEvent = {
    id: 'evt-1',
    kind: 'needs_feedback',
    created_at: '2026-03-19T21:29:00.000Z',
  };
  const focusedChange = {
    change_id: 'shape-spec',
    title: 'Shape Spec',
    status: 'tracking',
    task_total: 0,
    task_done: 0,
    updated_at: '2026-03-19T21:30:00.000Z',
  };

  const snapshot = createOverlaySnapshot({
    workspace_path: '/tmp/workspace',
    session_id: 'session-123',
    updated_at: '2026-03-19T21:30:00.000Z',
    focused_change: focusedChange,
    active_task: activeTask,
    board: {
      in_progress: [activeTask],
      done: [],
    },
    attention_state: 'needs_feedback',
    events: [feedbackEvent],
  });

  assert.deepEqual(snapshot, {
    workspace_path: '/tmp/workspace',
    session_id: 'session-123',
    updated_at: '2026-03-19T21:30:00.000Z',
    focused_change: focusedChange,
    active_task: activeTask,
    board: {
      in_progress: [activeTask],
      backlog: [],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
    attention_state: 'needs_feedback',
    events: [feedbackEvent],
  });
});

test('overlay runtime paths live under global workspace-scoped runtime storage', () => {
  const { getOverlayRuntimePaths, getWorkspaceOverlayKey } = loadDistModule('shared/overlay.js');
  const workspaceKey = getWorkspaceOverlayKey('/tmp/workspace');

  assert.deepEqual(getOverlayRuntimePaths('/tmp/workspace'), {
    runtime_dir: path.join(process.env.HOME, '.config', 'superplan', 'runtime', workspaceKey),
    snapshot_path: path.join(process.env.HOME, '.config', 'superplan', 'runtime', workspaceKey, 'overlay.json'),
    control_path: path.join(process.env.HOME, '.config', 'superplan', 'runtime', workspaceKey, 'overlay-control.json'),
  });
});

test('overlay event kind guard only accepts high-signal alert kinds', () => {
  const { isOverlayEventKind } = loadDistModule('shared/overlay.js');

  assert.equal(isOverlayEventKind('needs_feedback'), true);
  assert.equal(isOverlayEventKind('all_tasks_done'), true);
  assert.equal(isOverlayEventKind('task_started'), false);
  assert.equal(isOverlayEventKind('blocked'), false);
});

test('overlay control factory records visibility requests for the desktop companion', () => {
  const { createOverlayControlState } = loadDistModule('shared/overlay.js');

  assert.deepEqual(createOverlayControlState({
    workspace_path: '/tmp/workspace',
    requested_action: 'show',
    updated_at: '2026-03-19T21:30:00.000Z',
  }), {
    workspace_path: '/tmp/workspace',
    requested_action: 'show',
    updated_at: '2026-03-19T21:30:00.000Z',
    visible: true,
  });

  assert.deepEqual(createOverlayControlState({
    workspace_path: '/tmp/workspace',
    requested_action: 'hide',
    updated_at: '2026-03-19T21:31:00.000Z',
  }), {
    workspace_path: '/tmp/workspace',
    requested_action: 'hide',
    updated_at: '2026-03-19T21:31:00.000Z',
    visible: false,
  });
});

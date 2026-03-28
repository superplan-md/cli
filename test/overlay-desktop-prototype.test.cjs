const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadPrototypeStateModule() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'apps',
    'overlay-desktop',
    'src',
    'lib',
    'prototype-state.js',
  )).href);
}

const sampleSnapshot = {
  workspace_path: '/tmp/workspace',
  session_id: 'workspace:/tmp/workspace',
  updated_at: '2026-03-19T16:45:00.000Z',
  tracked_changes: [{
    change_id: 'overlay-refresh',
    title: 'Overlay Refresh',
    status: 'in_progress',
    task_total: 3,
    task_done: 1,
    updated_at: '2026-03-19T16:45:00.000Z',
  }],
  active_task: {
    task_id: 'T-901',
    change_id: 'overlay-refresh',
    title: 'Ship overlay prototype',
    status: 'in_progress',
    started_at: '2026-03-19T16:00:00.000Z',
  },
  board: {
    in_progress: [
      {
        task_id: 'T-901',
        change_id: 'overlay-refresh',
        title: 'Ship overlay prototype',
        status: 'in_progress',
        started_at: '2026-03-19T16:00:00.000Z',
      },
    ],
    backlog: [
      {
        task_id: 'T-902',
        change_id: 'overlay-refresh',
        title: 'Wire snapshot polling',
        status: 'backlog',
      },
    ],
    done: [
      {
        task_id: 'T-899',
        change_id: 'overlay-refresh',
        title: 'Define overlay contract',
        status: 'done',
        started_at: '2026-03-19T15:10:00.000Z',
        completed_at: '2026-03-19T15:28:00.000Z',
      },
    ],
    blocked: [],
    needs_feedback: [],
  },
  attention_state: 'normal',
  events: [],
};

test('prototype view model derives compact overlay content from the active task', async () => {
  const { createPrototypeViewModel } = await loadPrototypeStateModule();

  const viewModel = createPrototypeViewModel(sampleSnapshot, 'compact');

  assert.equal(viewModel.mode, 'compact');
  assert.equal(viewModel.primaryTask.title, 'Ship overlay prototype');
  assert.equal(viewModel.primaryTask.status, 'in_progress');
  assert.equal(viewModel.surfaceLabel, 'Tracking change');
  assert.equal(viewModel.secondaryLabel, 'Working now');
  assert.deepEqual(viewModel.columnCounts, {
    in_progress: 1,
    backlog: 1,
    done: 1,
    blocked: 0,
    needs_feedback: 0,
  });
  assert.equal(viewModel.board.backlog[0].title, 'Wire snapshot polling');
});

test('prototype view model falls back to tracked_changes when focused_change is absent', async () => {
  const { createPrototypeViewModel } = await loadPrototypeStateModule();

  const viewModel = createPrototypeViewModel({
    ...sampleSnapshot,
    focused_change: null,
    active_task: null,
    board: {
      in_progress: [],
      backlog: [],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
  }, 'expanded');

  assert.equal(viewModel.focusedChange?.change_id, 'overlay-refresh');
  assert.equal(viewModel.surfaceLabel, 'Tracking change');
});

test('prototype view model builds board columns in UX order and only shows Needs You when populated', async () => {
  const { createPrototypeViewModel } = await loadPrototypeStateModule();

  const viewModel = createPrototypeViewModel({
    ...sampleSnapshot,
    attention_state: 'needs_feedback',
    active_task: null,
    board: {
      ...sampleSnapshot.board,
      in_progress: [],
      needs_feedback: [
        {
          task_id: 'T-903',
          title: 'Review edge hover behavior',
          status: 'needs_feedback',
        },
      ],
      blocked: [
        {
          task_id: 'T-904',
          title: 'Wait on debug build',
          status: 'blocked',
        },
      ],
    },
  }, 'expanded');

  assert.equal(viewModel.mode, 'expanded');
  assert.equal(viewModel.attentionState, 'needs_feedback');
  assert.equal(viewModel.primaryTask.title, 'Review edge hover behavior');
  assert.deepEqual(viewModel.visibleColumns.map(column => column.key), [
    'needs_feedback',
    'in_progress',
    'backlog',
    'blocked',
    'done',
  ]);
  assert.equal(viewModel.visibleColumns[0].title, 'Needs You');
  assert.equal(viewModel.visibleColumns[0].items.length, 1);
});

test('prototype view model marks fully complete backlog tasks as ready for review', async () => {
  const { createPrototypeViewModel } = await loadPrototypeStateModule();

  const viewModel = createPrototypeViewModel({
    ...sampleSnapshot,
    active_task: null,
    board: {
      ...sampleSnapshot.board,
      in_progress: [],
      backlog: [{
        task_id: 'T-905',
        title: 'Approve compact overlay transitions',
        status: 'backlog',
        completed_acceptance_criteria: 3,
        total_acceptance_criteria: 3,
        progress_percent: 100,
      }],
      done: [],
    },
  }, 'compact');

  assert.equal(viewModel.primaryTask?.task_id, 'T-905');
  assert.equal(viewModel.secondaryLabel, 'Ready for review');
});

test('prototype mode toggles between compact and expanded and exposes refined window presets', async () => {
  const { getNextMode, getWindowPreset } = await loadPrototypeStateModule();

  assert.equal(getNextMode('compact'), 'expanded');
  assert.equal(getNextMode('expanded'), 'compact');
  assert.deepEqual(getWindowPreset('compact'), {
    width: 56,
    height: 40,
  });
  assert.deepEqual(getWindowPreset('expanded'), {
    width: 1360,
    height: 780,
  });
});

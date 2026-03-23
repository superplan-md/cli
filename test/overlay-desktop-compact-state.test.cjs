const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadCompactStateModule() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'apps',
    'overlay-desktop',
    'src',
    'lib',
    'compact-state.js',
  )).href);
}

function createSnapshot(overrides = {}) {
  const activeTask = {
    task_id: 'T-100',
    title: 'Implement compact task transitions',
    status: 'in_progress',
    completed_acceptance_criteria: 1,
    total_acceptance_criteria: 3,
    progress_percent: 33,
    started_at: '2026-03-21T08:00:00.000Z',
    updated_at: '2026-03-21T08:05:00.000Z',
  };

  return {
    workspace_path: '/tmp/workspace',
    session_id: 'workspace:/tmp/workspace',
    updated_at: '2026-03-21T08:05:00.000Z',
    active_task: activeTask,
    board: {
      in_progress: [activeTask],
      backlog: [{
        task_id: 'T-101',
        title: 'Review follow-up',
        status: 'backlog',
      }],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
    attention_state: 'normal',
    events: [],
    ...overrides,
  };
}

test('compact detail stays expanded for non-active primary-task states', async () => {
  const { createCompactPresentationModel } = await loadCompactStateModule();

  const snapshot = createSnapshot({
    active_task: null,
    board: {
      in_progress: [],
      backlog: [{
        task_id: 'T-200',
        title: 'Approve the finished task',
        status: 'backlog',
        completed_acceptance_criteria: 1,
        total_acceptance_criteria: 1,
        progress_percent: 100,
      }],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
  });

  const presentation = createCompactPresentationModel(snapshot, {
    detailExpanded: true,
  });

  assert.equal(presentation.presentation, 'detail');
  assert.equal(presentation.primaryTask?.task_id, 'T-200');
  assert.equal(presentation.showHideAction, true);
  assert.equal(presentation.showCollapseAction, true);
  assert.equal(presentation.showBoardAction, true);
});

test('compact transitions auto-expand when task focus changes in compact mode', async () => {
  const { shouldAutoExpandCompactDetail } = await loadCompactStateModule();

  const previousSnapshot = createSnapshot();
  const nextSnapshot = createSnapshot({
    updated_at: '2026-03-21T08:06:00.000Z',
    active_task: {
      task_id: 'T-101',
      title: 'Review follow-up',
      status: 'in_progress',
      completed_acceptance_criteria: 0,
      total_acceptance_criteria: 2,
      progress_percent: 0,
      started_at: '2026-03-21T08:06:00.000Z',
      updated_at: '2026-03-21T08:06:00.000Z',
    },
    board: {
      in_progress: [{
        task_id: 'T-101',
        title: 'Review follow-up',
        status: 'in_progress',
        completed_acceptance_criteria: 0,
        total_acceptance_criteria: 2,
        progress_percent: 0,
        started_at: '2026-03-21T08:06:00.000Z',
        updated_at: '2026-03-21T08:06:00.000Z',
      }],
      backlog: [],
      done: [{
        task_id: 'T-100',
        title: 'Implement compact task transitions',
        status: 'done',
        completed_acceptance_criteria: 3,
        total_acceptance_criteria: 3,
        progress_percent: 100,
        completed_at: '2026-03-21T08:05:59.000Z',
      }],
      blocked: [],
      needs_feedback: [],
    },
  });

  assert.equal(shouldAutoExpandCompactDetail(previousSnapshot, nextSnapshot, 'compact'), true);
  assert.equal(shouldAutoExpandCompactDetail(previousSnapshot, nextSnapshot, 'expanded'), false);
});

test('compact transitions auto-expand when an active task hands off into a review-ready summary', async () => {
  const { shouldAutoExpandCompactDetail } = await loadCompactStateModule();

  const previousSnapshot = createSnapshot();
  const nextSnapshot = createSnapshot({
    updated_at: '2026-03-21T08:06:00.000Z',
    active_task: null,
    board: {
      in_progress: [],
      backlog: [{
        task_id: 'T-100',
        title: 'Implement compact task transitions',
        status: 'backlog',
        completed_acceptance_criteria: 3,
        total_acceptance_criteria: 3,
        progress_percent: 100,
      }],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
  });

  assert.equal(shouldAutoExpandCompactDetail(previousSnapshot, nextSnapshot, 'compact'), true);
});

test('compact transitions ignore progress-only updates on the same active task', async () => {
  const { shouldAutoExpandCompactDetail } = await loadCompactStateModule();

  const previousSnapshot = createSnapshot();
  const nextSnapshot = createSnapshot({
    updated_at: '2026-03-21T08:07:00.000Z',
    active_task: {
      ...createSnapshot().active_task,
      completed_acceptance_criteria: 2,
      progress_percent: 67,
      updated_at: '2026-03-21T08:07:00.000Z',
    },
    board: {
      in_progress: [{
        ...createSnapshot().active_task,
        completed_acceptance_criteria: 2,
        progress_percent: 67,
        updated_at: '2026-03-21T08:07:00.000Z',
      }],
      backlog: [{
        task_id: 'T-101',
        title: 'Review follow-up',
        status: 'backlog',
      }],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
  });

  assert.equal(shouldAutoExpandCompactDetail(previousSnapshot, nextSnapshot, 'compact'), false);
});

test('attention cards keep the hide affordance in compact detail mode', async () => {
  const { createCompactPresentationModel } = await loadCompactStateModule();

  const needsFeedbackPresentation = createCompactPresentationModel(createSnapshot({
    active_task: null,
    attention_state: 'needs_feedback',
    board: {
      in_progress: [],
      backlog: [],
      done: [],
      blocked: [],
      needs_feedback: [{
        task_id: 'T-300',
        title: 'Review the compact overlay',
        status: 'needs_feedback',
        updated_at: '2026-03-21T08:10:00.000Z',
        message: 'Please review the latest task transition.',
      }],
    },
  }), {
    detailExpanded: false,
  });

  const donePresentation = createCompactPresentationModel(createSnapshot({
    active_task: null,
    attention_state: 'all_tasks_done',
    board: {
      in_progress: [],
      backlog: [],
      done: [{
        task_id: 'T-301',
        title: 'Ship compact overlay transitions',
        status: 'done',
        completed_acceptance_criteria: 2,
        total_acceptance_criteria: 2,
        progress_percent: 100,
        completed_at: '2026-03-21T08:12:00.000Z',
      }],
      blocked: [],
      needs_feedback: [],
    },
  }), {
    detailExpanded: false,
  });

  assert.equal(needsFeedbackPresentation.presentation, 'detail');
  assert.equal(needsFeedbackPresentation.showHideAction, true);
  assert.equal(donePresentation.presentation, 'detail');
  assert.equal(donePresentation.showHideAction, true);
});

test('tracked changes without tasks render as a compact notification card', async () => {
  const { createCompactPresentationModel, shouldShowCompactDetail } = await loadCompactStateModule();

  const snapshot = createSnapshot({
    active_task: null,
    focused_change: {
      change_id: 'shape-spec',
      title: 'Shape Spec',
      status: 'tracking',
      task_total: 0,
      task_done: 0,
      updated_at: '2026-03-21T08:10:00.000Z',
    },
    board: {
      in_progress: [],
      backlog: [],
      done: [],
      blocked: [],
      needs_feedback: [],
    },
  });

  assert.equal(shouldShowCompactDetail(snapshot, false), true);

  const presentation = createCompactPresentationModel(snapshot, {
    detailExpanded: false,
  });

  assert.equal(presentation.presentation, 'detail');
  assert.equal(presentation.primaryTask, null);
  assert.equal(presentation.focusKind, 'change');
  assert.equal(presentation.focusedChange?.change_id, 'shape-spec');
  assert.equal(presentation.showHideAction, true);
  assert.equal(presentation.showCollapseAction, false);
  assert.equal(presentation.showBoardAction, false);
});

import { isTaskReadyForReview } from './compact-state.js';

export const WINDOW_PRESETS = {
  compact: {
    width: 56,
    height: 40,
  },
  expanded: {
    width: 1360,
    height: 780,
  },
};

export const COMPACT_ATTENTION_PRESET = {
  width: 384,
  height: 86,
};

const COLUMN_DEFINITIONS = [
  {
    key: 'needs_feedback',
    title: 'Needs You',
    optional: true,
    tone: 'needs-feedback',
  },
  {
    key: 'in_progress',
    title: 'In Progress',
    optional: false,
    tone: 'active',
  },
  {
    key: 'backlog',
    title: 'Backlog',
    optional: false,
    tone: 'default',
  },
  {
    key: 'blocked',
    title: 'Blocked',
    optional: true,
    tone: 'blocked',
  },
  {
    key: 'done',
    title: 'Done',
    optional: false,
    tone: 'done',
  },
];

function getPrimaryTask(snapshot) {
  return snapshot.active_task
    ?? snapshot.board.needs_feedback[0]
    ?? snapshot.board.in_progress[0]
    ?? snapshot.board.blocked[0]
    ?? snapshot.board.backlog[0]
    ?? snapshot.board.done[0]
    ?? null;
}

function getFocusedChange(snapshot) {
  const change = snapshot.focused_change
    ?? snapshot.tracked_changes?.find(candidate => candidate.status !== 'done')
    ?? snapshot.tracked_changes?.[0]
    ?? null;

  if (!change || change.status === 'done') {
    return null;
  }

  return change;
}

function createColumnCounts(board) {
  return {
    in_progress: board.in_progress.length,
    backlog: board.backlog.length,
    done: board.done.length,
    blocked: board.blocked.length,
    needs_feedback: board.needs_feedback.length,
  };
}

function getAttentionLabel(attentionState) {
  if (attentionState === 'needs_feedback') {
    return 'Needs feedback';
  }

  if (attentionState === 'all_tasks_done') {
    return 'All tasks done';
  }

  return 'Working quietly';
}

function getSurfaceLabel(attentionState, focusedChange) {
  if (attentionState === 'needs_feedback') {
    return 'Agent needs feedback';
  }

  if (attentionState === 'all_tasks_done') {
    return 'All tasks done';
  }

  if (focusedChange) {
    return 'Tracking change';
  }

  return 'Tracking active session';
}

function getSecondaryLabel(snapshot, primaryTask, focusedChange) {
  if (snapshot.attention_state === 'needs_feedback') {
    return 'Waiting on you';
  }

  if (snapshot.attention_state === 'all_tasks_done') {
    return 'Session complete';
  }

  if (!primaryTask && focusedChange) {
    if (focusedChange.status === 'tracking') {
      return 'Waiting for the first task';
    }

    if (focusedChange.status === 'done') {
      return 'Change complete';
    }

    return 'Tracking change';
  }

  if (!primaryTask) {
    return 'Waiting for the next task';
  }

  if (primaryTask.status === 'blocked') {
    return 'Blocked for now';
  }

  if (primaryTask.status === 'backlog') {
    if (isTaskReadyForReview(primaryTask)) {
      return 'Ready for review';
    }

    return 'Up next';
  }

  if (primaryTask.status === 'done') {
    return 'Recently finished';
  }

  return 'Working now';
}

function formatUpdatedLabel(updatedAt) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return 'Updated just now';
  }

  return `Updated ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function getWorkspaceLabel(workspacePath) {
  const segments = workspacePath.split('/').filter(Boolean);
  return segments.length === 0 ? workspacePath : segments[segments.length - 1];
}

function createVisibleColumns(board) {
  return COLUMN_DEFINITIONS
    .filter(column => !column.optional || board[column.key].length > 0)
    .map(column => ({
      key: column.key,
      title: column.title,
      tone: column.tone,
      items: board[column.key],
      count: board[column.key].length,
    }));
}

export function getNextMode(mode) {
  return mode === 'compact' ? 'expanded' : 'compact';
}

export function getWindowPreset(mode) {
  return { ...WINDOW_PRESETS[mode] };
}

export function getCompactAttentionPreset() {
  return { ...COMPACT_ATTENTION_PRESET };
}

export function createPrototypeViewModel(snapshot, mode) {
  const primaryTask = getPrimaryTask(snapshot);
  const focusedChange = getFocusedChange(snapshot);

  return {
    mode,
    attentionState: snapshot.attention_state,
    attentionLabel: getAttentionLabel(snapshot.attention_state),
    surfaceLabel: getSurfaceLabel(snapshot.attention_state, focusedChange),
    secondaryLabel: getSecondaryLabel(snapshot, primaryTask, focusedChange),
    workspaceLabel: getWorkspaceLabel(snapshot.workspace_path),
    updatedLabel: formatUpdatedLabel(snapshot.updated_at),
    focusedChange,
    primaryTask,
    columnCounts: createColumnCounts(snapshot.board),
    visibleColumns: createVisibleColumns(snapshot.board),
    board: snapshot.board,
  };
}

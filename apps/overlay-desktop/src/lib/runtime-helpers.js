const DONE_ACK_WINDOW_MS = 5 * 60 * 1000;

export function getEmptyRuntimeSnapshot(workspacePath = '') {
  return {
    workspace_path: workspacePath,
    session_id: workspacePath ? `workspace:${workspacePath}` : 'workspace:unknown',
    updated_at: new Date(0).toISOString(),
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
  };
}

export function getBrowserFallbackSnapshot(workspacePath = '/Users/puneetbhatt/cli') {
  return {
    workspace_path: workspacePath,
    session_id: `workspace:${workspacePath}`,
    updated_at: '2026-03-19T22:10:00.000Z',
    active_task: {
      task_id: 'T-412',
      title: 'Refine the compact in-progress overlay UX',
      description: 'Tighten the desktop kanban around live progress cues instead of decorative framing.',
      status: 'in_progress',
      completed_acceptance_criteria: 2,
      total_acceptance_criteria: 5,
      progress_percent: 40,
      started_at: '2026-03-19T21:56:00.000Z',
      updated_at: '2026-03-19T22:10:00.000Z',
    },
    board: {
      in_progress: [
        {
          task_id: 'T-412',
          title: 'Refine the compact in-progress overlay UX',
          description: 'Tighten the desktop kanban around live progress cues instead of decorative framing.',
          status: 'in_progress',
          completed_acceptance_criteria: 2,
          total_acceptance_criteria: 5,
          progress_percent: 40,
          started_at: '2026-03-19T21:56:00.000Z',
          updated_at: '2026-03-19T22:10:00.000Z',
        },
      ],
      backlog: [
        {
          task_id: 'T-413',
          title: 'Tune the compact motion language',
          status: 'backlog',
        },
      ],
      done: [
        {
          task_id: 'T-399',
          title: 'Define overlay runtime contract',
          status: 'done',
          started_at: '2026-03-19T21:02:00.000Z',
          completed_at: '2026-03-19T21:19:00.000Z',
        },
        {
          task_id: 'T-400',
          title: 'Emit overlay snapshot from CLI',
          status: 'done',
          started_at: '2026-03-19T21:20:00.000Z',
          completed_at: '2026-03-19T21:42:00.000Z',
        },
        {
          task_id: 'T-401',
          title: 'Boot the desktop prototype shell',
          status: 'done',
          started_at: '2026-03-19T21:43:00.000Z',
          completed_at: '2026-03-19T21:55:00.000Z',
        },
      ],
      blocked: [
        {
          task_id: 'T-414',
          title: 'Validate fullscreen-space panel behavior',
          status: 'blocked',
          reason: 'Needs fullscreen verification on the real macOS panel path.',
          updated_at: '2026-03-19T21:58:00.000Z',
        },
      ],
      needs_feedback: [],
    },
    attention_state: 'normal',
    events: [],
  };
}

export function getSnapshotTaskProgress(snapshot) {
  const activeTask = snapshot.active_task;

  if (
    activeTask
    && typeof activeTask.completed_acceptance_criteria === 'number'
    && typeof activeTask.total_acceptance_criteria === 'number'
  ) {
    const total = activeTask.total_acceptance_criteria;
    const done = Math.min(activeTask.completed_acceptance_criteria, total);

    return {
      done,
      total,
      ratio: total === 0 ? 0 : done / total,
    };
  }

  const total = snapshot.board.in_progress.length
    + snapshot.board.backlog.length
    + snapshot.board.done.length
    + snapshot.board.blocked.length
    + snapshot.board.needs_feedback.length;
  const done = snapshot.board.done.length;

  return {
    done,
    total,
    ratio: total === 0 ? 0 : done / total,
  };
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getLatestDoneEventTimestamp(snapshot) {
  const matchingEvents = (snapshot.events ?? [])
    .filter(event => event.kind === 'all_tasks_done')
    .map(event => parseTimestamp(event.created_at))
    .filter(timestamp => timestamp !== null);

  if (matchingEvents.length > 0) {
    return Math.max(...matchingEvents);
  }

  return parseTimestamp(snapshot.updated_at);
}

export function hasRenderableSnapshotContent(snapshot, nowMs = Date.now()) {
  if (!snapshot) {
    return false;
  }

  if (snapshot.active_task) {
    return true;
  }

  if ((snapshot.board?.in_progress?.length ?? 0) > 0) {
    return true;
  }

  if ((snapshot.board?.backlog?.length ?? 0) > 0) {
    return true;
  }

  if ((snapshot.board?.blocked?.length ?? 0) > 0) {
    return true;
  }

  if ((snapshot.board?.needs_feedback?.length ?? 0) > 0) {
    return true;
  }

  if (snapshot.attention_state === 'needs_feedback') {
    return true;
  }

  if (snapshot.attention_state === 'all_tasks_done') {
    const latestDoneTimestamp = getLatestDoneEventTimestamp(snapshot);
    if (latestDoneTimestamp === null) {
      return false;
    }

    return nowMs - latestDoneTimestamp <= DONE_ACK_WINDOW_MS;
  }

  return false;
}

export function isTauriWindowAvailable(getWindow) {
  try {
    return Boolean(getWindow());
  } catch {
    return false;
  }
}

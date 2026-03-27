const ALERT_SOUND_WINDOW_MS = 15 * 1000;
const ALERT_SOUND_EVENT_KINDS = new Set(['needs_feedback', 'all_tasks_done']);

export function getEmptyRuntimeSnapshot(workspacePath = '') {
  return {
    workspace_path: workspacePath,
    session_id: workspacePath ? `workspace:${workspacePath}` : 'workspace:unknown',
    updated_at: new Date(0).toISOString(),
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
  };
}

export function getBrowserFallbackSnapshot(workspacePath = '/Users/puneetbhatt/cli') {
  return {
    workspace_path: workspacePath,
    session_id: `workspace:${workspacePath}`,
    updated_at: '2026-03-19T22:10:00.000Z',
    focused_change: null,
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

function getLatestAlertEvent(snapshot) {
  if (!snapshot) {
    return null;
  }

  let latestEvent = null;
  let latestTimestamp = null;

  for (const event of snapshot.events ?? []) {
    if (!ALERT_SOUND_EVENT_KINDS.has(event.kind)) {
      continue;
    }

    const parsedTimestamp = parseTimestamp(event.created_at);
    if (parsedTimestamp === null) {
      continue;
    }

    if (latestTimestamp === null || parsedTimestamp >= latestTimestamp) {
      latestEvent = event;
      latestTimestamp = parsedTimestamp;
    }
  }

  return latestEvent;
}

export function hasRenderableSnapshotContent(snapshot, nowMs = Date.now()) {
  if (!snapshot) {
    return false;
  }

  if (snapshot.focused_change && snapshot.focused_change.status !== 'done') {
    return true;
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
    return true;
  }

  return false;
}

export function getAttentionSoundKind(previousSnapshot, nextSnapshot, nowMs = Date.now()) {
  const latestAlertEvent = getLatestAlertEvent(nextSnapshot);
  if (!latestAlertEvent) {
    return null;
  }

  const latestAlertTimestamp = parseTimestamp(latestAlertEvent.created_at);
  if (latestAlertTimestamp === null) {
    return null;
  }

  if (nowMs - latestAlertTimestamp > ALERT_SOUND_WINDOW_MS) {
    return null;
  }

  const previousAlertEvent = getLatestAlertEvent(previousSnapshot);
  if (previousAlertEvent?.id === latestAlertEvent.id) {
    return null;
  }

  return latestAlertEvent.kind;
}

export function isTauriWindowAvailable(getWindow) {
  try {
    return Boolean(getWindow());
  } catch {
    return false;
  }
}

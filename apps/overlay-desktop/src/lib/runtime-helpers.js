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

export function isTauriWindowAvailable(getWindow) {
  try {
    return Boolean(getWindow());
  } catch {
    return false;
  }
}

import * as path from 'path';

export type OverlayTaskStatus =
  | 'in_progress'
  | 'backlog'
  | 'done'
  | 'blocked'
  | 'needs_feedback';

export type OverlayAttentionState = 'normal' | 'needs_feedback' | 'all_tasks_done';

export type OverlayEventKind = 'needs_feedback' | 'all_tasks_done';

export type OverlayRequestedAction = 'ensure' | 'show' | 'hide';

export interface OverlayTaskSummary {
  task_id: string;
  title: string;
  description?: string;
  status: OverlayTaskStatus;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  reason?: string;
  message?: string;
}

export interface OverlayBoard {
  in_progress: OverlayTaskSummary[];
  backlog: OverlayTaskSummary[];
  done: OverlayTaskSummary[];
  blocked: OverlayTaskSummary[];
  needs_feedback: OverlayTaskSummary[];
}

export interface OverlayEvent {
  id: string;
  kind: OverlayEventKind;
  created_at: string;
}

export interface OverlaySnapshot {
  workspace_path: string;
  session_id: string;
  updated_at: string;
  active_task: OverlayTaskSummary | null;
  board: OverlayBoard;
  attention_state: OverlayAttentionState;
  events: OverlayEvent[];
}

export interface OverlayRuntimePaths {
  runtime_dir: string;
  snapshot_path: string;
  control_path: string;
}

export interface CreateOverlaySnapshotInput {
  workspace_path: string;
  session_id: string;
  updated_at: string;
  active_task?: OverlayTaskSummary | null;
  board?: Partial<OverlayBoard>;
  attention_state?: OverlayAttentionState;
  events?: OverlayEvent[];
}

export interface OverlayControlState {
  workspace_path: string;
  requested_action: OverlayRequestedAction;
  updated_at: string;
  visible: boolean;
}

export interface CreateOverlayControlStateInput {
  workspace_path: string;
  requested_action: OverlayRequestedAction;
  updated_at: string;
}

const OVERLAY_EVENT_KINDS: OverlayEventKind[] = ['needs_feedback', 'all_tasks_done'];

export function createEmptyOverlayBoard(): OverlayBoard {
  return {
    in_progress: [],
    backlog: [],
    done: [],
    blocked: [],
    needs_feedback: [],
  };
}

function cloneTasks(tasks: OverlayTaskSummary[] | undefined): OverlayTaskSummary[] {
  return (tasks ?? []).map(task => ({ ...task }));
}

function cloneEvents(events: OverlayEvent[] | undefined): OverlayEvent[] {
  return (events ?? []).map(event => ({ ...event }));
}

export function createOverlaySnapshot(input: CreateOverlaySnapshotInput): OverlaySnapshot {
  const board = input.board ?? {};

  return {
    workspace_path: input.workspace_path,
    session_id: input.session_id,
    updated_at: input.updated_at,
    active_task: input.active_task ? { ...input.active_task } : null,
    board: {
      in_progress: cloneTasks(board.in_progress),
      backlog: cloneTasks(board.backlog),
      done: cloneTasks(board.done),
      blocked: cloneTasks(board.blocked),
      needs_feedback: cloneTasks(board.needs_feedback),
    },
    attention_state: input.attention_state ?? 'normal',
    events: cloneEvents(input.events),
  };
}

export function getOverlayRuntimePaths(workspacePath: string): OverlayRuntimePaths {
  const runtimeDir = path.join(workspacePath, '.superplan', 'runtime');

  return {
    runtime_dir: runtimeDir,
    snapshot_path: path.join(runtimeDir, 'overlay.json'),
    control_path: path.join(runtimeDir, 'overlay-control.json'),
  };
}

export function isOverlayEventKind(value: string): value is OverlayEventKind {
  return OVERLAY_EVENT_KINDS.includes(value as OverlayEventKind);
}

export function createOverlayControlState(input: CreateOverlayControlStateInput): OverlayControlState {
  return {
    workspace_path: input.workspace_path,
    requested_action: input.requested_action,
    updated_at: input.updated_at,
    visible: input.requested_action !== 'hide',
  };
}

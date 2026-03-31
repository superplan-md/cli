import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'node:crypto';

export type OverlayTaskStatus =
  | 'in_progress'
  | 'backlog'
  | 'done'
  | 'blocked'
  | 'needs_feedback';

export type OverlayChangeStatus =
  | 'tracking'
  | 'backlog'
  | 'in_progress'
  | 'blocked'
  | 'needs_feedback'
  | 'done';

export type OverlayAttentionState = 'normal' | 'needs_feedback' | 'all_tasks_done';

export type OverlayEventKind = 'needs_feedback' | 'all_tasks_done';

export type OverlayRequestedAction = 'ensure' | 'show' | 'hide';

export interface OverlayTaskSummary {
  task_id: string;
  change_id?: string;
  task_ref?: string;
  title: string;
  description?: string;
  status: OverlayTaskStatus;
  completed_acceptance_criteria?: number;
  total_acceptance_criteria?: number;
  progress_percent?: number;
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

export interface OverlayFocusedChange {
  change_id: string;
  title: string;
  status: OverlayChangeStatus;
  task_total: number;
  task_done: number;
  updated_at: string;
}

export interface OverlayTrackedChange extends OverlayFocusedChange {}

export interface OverlayEvent {
  id: string;
  kind: OverlayEventKind;
  created_at: string;
}

export interface OverlaySnapshot {
  workspace_path: string;
  session_id: string;
  updated_at: string;
  tracked_changes: OverlayTrackedChange[];
  focused_change: OverlayFocusedChange | null;
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
  tracked_changes?: OverlayTrackedChange[];
  focused_change?: OverlayFocusedChange | null;
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
const GLOBAL_SUPERPLAN_DIR = path.join(os.homedir(), '.config', 'superplan');

function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function getWorkspaceOverlayKey(workspacePath: string): string {
  const normalizedWorkspacePath = (() => {
    try {
      return fs.realpathSync(workspacePath);
    } catch {
      return path.resolve(workspacePath);
    }
  })();
  const workspaceName = sanitizeSegment(path.basename(normalizedWorkspacePath)) || 'root';
  const workspaceHash = createHash('sha1').update(normalizedWorkspacePath).digest('hex').slice(0, 10);
  return `workspace-${workspaceName}-${workspaceHash}`;
}

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

function cloneFocusedChange(focusedChange: OverlayFocusedChange | null | undefined): OverlayFocusedChange | null {
  return focusedChange ? { ...focusedChange } : null;
}

function cloneTrackedChanges(trackedChanges: OverlayTrackedChange[] | undefined): OverlayTrackedChange[] {
  return (trackedChanges ?? []).map(change => ({ ...change }));
}

export function createOverlaySnapshot(input: CreateOverlaySnapshotInput): OverlaySnapshot {
  const board = input.board ?? {};

  return {
    workspace_path: input.workspace_path,
    session_id: input.session_id,
    updated_at: input.updated_at,
    tracked_changes: cloneTrackedChanges(input.tracked_changes),
    focused_change: cloneFocusedChange(input.focused_change),
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
  const runtimeDir = path.join(
    GLOBAL_SUPERPLAN_DIR,
    getWorkspaceOverlayKey(workspacePath),
    'runtime',
  );

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

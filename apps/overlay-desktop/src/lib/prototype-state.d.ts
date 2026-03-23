export type PrototypeMode = 'compact' | 'expanded';

export interface PrototypeTask {
  task_id: string;
  title: string;
  description?: string;
  status: string;
  completed_acceptance_criteria?: number;
  total_acceptance_criteria?: number;
  progress_percent?: number;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  reason?: string;
  message?: string;
}

export interface PrototypeFocusedChange {
  change_id: string;
  title: string;
  status: 'tracking' | 'backlog' | 'in_progress' | 'blocked' | 'needs_feedback' | 'done';
  task_total: number;
  task_done: number;
  updated_at: string;
}

export interface PrototypeBoard {
  in_progress: PrototypeTask[];
  backlog: PrototypeTask[];
  done: PrototypeTask[];
  blocked: PrototypeTask[];
  needs_feedback: PrototypeTask[];
}

export interface PrototypeColumn {
  key: keyof PrototypeBoard;
  title: string;
  tone: 'default' | 'active' | 'done' | 'blocked' | 'needs-feedback';
  items: PrototypeTask[];
  count: number;
}

export interface PrototypeSnapshot {
  workspace_path: string;
  session_id: string;
  updated_at: string;
  focused_change: PrototypeFocusedChange | null;
  active_task: PrototypeTask | null;
  board: PrototypeBoard;
  attention_state: 'normal' | 'needs_feedback' | 'all_tasks_done';
  events: Array<{ id: string; kind: string; created_at: string }>;
}

export interface PrototypeViewModel {
  mode: PrototypeMode;
  attentionState: PrototypeSnapshot['attention_state'];
  attentionLabel: string;
  surfaceLabel: string;
  secondaryLabel: string;
  workspaceLabel: string;
  updatedLabel: string;
  focusedChange: PrototypeFocusedChange | null;
  primaryTask: PrototypeTask | null;
  columnCounts: {
    in_progress: number;
    backlog: number;
    done: number;
    blocked: number;
    needs_feedback: number;
  };
  visibleColumns: PrototypeColumn[];
  board: PrototypeBoard;
}

export const WINDOW_PRESETS: Record<PrototypeMode, { width: number; height: number }>;
export const COMPACT_ATTENTION_PRESET: { width: number; height: number };

export function getNextMode(mode: PrototypeMode): PrototypeMode;
export function getWindowPreset(mode: PrototypeMode): { width: number; height: number };
export function getCompactAttentionPreset(): { width: number; height: number };
export function createPrototypeViewModel(snapshot: PrototypeSnapshot, mode: PrototypeMode): PrototypeViewModel;

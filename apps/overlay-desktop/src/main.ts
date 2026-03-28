import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import {
  getCompactAttentionPreset,
  createPrototypeViewModel,
  getNextMode,
  getWindowPreset,
  type PrototypeMode,
  type PrototypeViewModel,
} from './lib/prototype-state.js';
import {
  getBrowserFallbackSnapshot,
  getEmptyRuntimeSnapshot,
  getAttentionSoundKind,
  hasRenderableSnapshotContent,
  getSnapshotTaskProgress,
  isTauriWindowAvailable,
} from './lib/runtime-helpers.js';
import {
  createCompactPresentationModel,
  isTaskReadyForReview,
  shouldAutoExpandCompactDetail,
  shouldShowCompactDetail,
} from './lib/compact-state.js';

type OverlayTask = {
  task_id: string;
  change_id?: string;
  task_ref?: string;
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
};

type OverlayChange = {
  change_id: string;
  title: string;
  status: 'tracking' | 'backlog' | 'in_progress' | 'blocked' | 'needs_feedback' | 'done';
  task_total: number;
  task_done: number;
  updated_at: string;
};

type OverlaySnapshot = {
  workspace_path: string;
  session_id: string;
  updated_at: string;
  tracked_changes: OverlayChange[];
  focused_change: OverlayChange | null;
  active_task: OverlayTask | null;
  board: {
    in_progress: OverlayTask[];
    backlog: OverlayTask[];
    done: OverlayTask[];
    blocked: OverlayTask[];
    needs_feedback: OverlayTask[];
  };
  attention_state: 'normal' | 'needs_feedback' | 'all_tasks_done';
  events: Array<{ id: string; kind: string; created_at: string }>;
};

type OverlayControlState = {
  workspace_path: string;
  requested_action: 'ensure' | 'show' | 'hide';
  updated_at: string;
  visible: boolean;
};

type ResizeDirection = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

const POLL_INTERVAL_MS = 2000;
const LIVE_TIME_REFRESH_MS = 1000;
const COMPACT_ADVANCE_DURATION_MS = 1600;
const COMPACT_HINT_DURATION_MS = 2400;
const COMPACT_DRAG_CLICK_SUPPRESSION_MS = 3000;
const COMPACT_COMING_SOON_MESSAGE = 'Click coming soon. Go to your coding agent';
const DRAG_THRESHOLD_PX = 4;
const EXPANDED_MIN_WIDTH = 980;
const EXPANDED_MIN_HEIGHT = 620;
const OVERLAY_POSITION_STORAGE_KEY = 'superplan.overlay.position';
const COMPACT_WORKING_CARD_STORAGE_KEY = 'superplan.overlay.compactWorkingCardExpanded';

// Bug #5/#12: only treat snapshot load as fatal after this many consecutive
// failures so transient disk hiccups don't immediately collapse the overlay.
const MAX_CONSECUTIVE_SNAPSHOT_FAILURES = 3;
const superplanMarkUrl = new URL('./assets/superplan-mark.png', import.meta.url).href;
const RESIZE_DIRECTIONS = new Set<ResizeDirection>([
  'North',
  'South',
  'East',
  'West',
  'NorthEast',
  'NorthWest',
  'SouthEast',
  'SouthWest',
] as const);

let mode: PrototypeMode = 'compact';
let latestSnapshot: OverlaySnapshot | null = null;
let latestSnapshots: OverlaySnapshot[] = [];
let latestControlStates: OverlayControlState[] = [];
let lastSnapshotText = '';
let lastControlText = '';
let lastAppliedVisibility: boolean | null = null;
let pollTimer: number | undefined;
let liveTimeTimer: number | undefined;
let compactAdvanceTimer: number | undefined;
let compactAdvanceActive = false;
let compactHintMessage: string | null = null;
let compactHintTimer: number | undefined;
let compactWorkingExpanded = true;
let overlayMovedUnlisten: (() => void) | null = null;
let pendingOverlayDragSurface: HTMLElement | null = null;
let pendingOverlayDragStartX = 0;
let pendingOverlayDragStartY = 0;
let overlayDragDidStart = false;
let overlayDragInProgress = false;
let suppressNextCompactSurfaceClick = false;
let suppressNextCompactSurfaceClickTimer: number | undefined;

// Bug #13: prevent concurrent syncOverlayRuntime calls.
let syncInFlight = false;
// Bug #5/#12: reset to 0 on every successful snapshot load.
let consecutiveSnapshotFailures = 0;
// Bug H6: don't terminate before we've received at least one non-null control
// state — on cold start, loadControlState() may return null (file not yet
// written) which collapses to requestedVisibility=false → instant self-destruct.
let bootstrapComplete = false;

const root = document.querySelector<HTMLDivElement>('#app');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAppWindow() {
  if (!isTauriWindowAvailable(getCurrentWindow)) {
    return null;
  }

  return getCurrentWindow();
}

function getWorkspaceName(workspacePath: string): string {
  const segments = workspacePath.split('/').filter(Boolean);
  return segments.length === 0 ? workspacePath : segments[segments.length - 1];
}

function getSnapshotTrackedChanges(snapshot: OverlaySnapshot | null | undefined): OverlayChange[] {
  return Array.isArray(snapshot?.tracked_changes) ? snapshot.tracked_changes : [];
}

function getSnapshotSelectionKey(snapshot: OverlaySnapshot | null | undefined): string {
  if (!snapshot) {
    return '';
  }

  return `${snapshot.session_id}|${snapshot.workspace_path}|${snapshot.updated_at}`;
}

function compareSnapshots(left: OverlaySnapshot, right: OverlaySnapshot): number {
  const attentionRank = (snapshot: OverlaySnapshot): number => {
    if (snapshot.attention_state === 'needs_feedback') {
      return 0;
    }

    if (snapshot.active_task) {
      return 1;
    }

    if (getSnapshotTrackedChanges(snapshot).some(change => change.status !== 'done')) {
      return 2;
    }

    if (snapshot.attention_state === 'all_tasks_done') {
      return 4;
    }

    return 3;
  };

  const rankDifference = attentionRank(left) - attentionRank(right);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  const timestampDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.workspace_path.localeCompare(right.workspace_path);
}

function getVisibleWorkspacePaths(): Set<string> {
  return new Set(
    latestControlStates
      .filter(control => control.visible)
      .map(control => control.workspace_path),
  );
}

function getRenderableSnapshots(): OverlaySnapshot[] {
  const visibleWorkspacePaths = getVisibleWorkspacePaths();
  return latestSnapshots
    .filter(snapshot => visibleWorkspacePaths.has(snapshot.workspace_path))
    .filter(snapshot => hasRenderableSnapshotContent(snapshot))
    .sort(compareSnapshots);
}

function getPrimarySnapshot(): OverlaySnapshot | null {
  return getRenderableSnapshots()[0] ?? latestSnapshots.slice().sort(compareSnapshots)[0] ?? null;
}

function readStoredOverlayPosition(): { x: number; y: number } | null {
  try {
    const stored = window.localStorage.getItem(OVERLAY_POSITION_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null;
    }

    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function writeStoredOverlayPosition(x: number, y: number): void {
  try {
    window.localStorage.setItem(OVERLAY_POSITION_STORAGE_KEY, JSON.stringify({ x, y }));
  } catch {
    // Ignore storage failures; dragging should still work for the session.
  }
}

function readStoredCompactWorkingExpanded(): boolean {
  try {
    const stored = window.localStorage.getItem(COMPACT_WORKING_CARD_STORAGE_KEY);
    if (stored === null) {
      return true;
    }

    return stored !== 'false';
  } catch {
    return true;
  }
}

function writeStoredCompactWorkingExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(COMPACT_WORKING_CARD_STORAGE_KEY, expanded ? 'true' : 'false');
  } catch {
    // Ignore storage failures; session state still updates.
  }
}

async function restoreOverlayPosition(): Promise<void> {
  const appWindow = getAppWindow();
  const stored = readStoredOverlayPosition();

  if (!appWindow || !stored) {
    return;
  }

  try {
    await appWindow.setPosition(new PhysicalPosition(stored.x, stored.y));
  } catch (error) {
    console.error('restore overlay position failed', error);
  }
}

async function installOverlayPositionPersistence(): Promise<void> {
  const appWindow = getAppWindow();
  if (!appWindow || overlayMovedUnlisten) {
    return;
  }

  overlayMovedUnlisten = await appWindow.onMoved(({ payload }) => {
    if (mode !== 'compact') {
      return;
    }

    writeStoredOverlayPosition(payload.x, payload.y);
  });
}

function getCompactStatusLabel(viewModel: PrototypeViewModel): string {
  if (viewModel.attentionState === 'needs_feedback') {
    return viewModel.primaryTask
      ? `Agent needs feedback on ${viewModel.primaryTask.title}.`
      : 'Agent needs feedback.';
  }

  if (viewModel.attentionState === 'all_tasks_done') {
    const finishedCount = viewModel.columnCounts.done;
    return finishedCount > 0
      ? `All tasks done. Finished ${finishedCount} ${finishedCount === 1 ? 'task' : 'tasks'}.`
      : 'All tasks done.';
  }

  if (!viewModel.primaryTask) {
    if (viewModel.focusedChange) {
      return `Tracking ${viewModel.focusedChange.title}.`;
    }

    return 'Waiting for the next task.';
  }

  return `Working on ${viewModel.primaryTask.title}.`;
}

function getCompactBoardLabel(viewModel: PrototypeViewModel): string {
  if (viewModel.primaryTask) {
    return `Open full board for ${viewModel.primaryTask.title}.`;
  }

  if (viewModel.focusedChange) {
    return `Open full board for ${viewModel.focusedChange.title}.`;
  }

  return 'Open full board.';
}

function getExpandedSurfaceLabel(snapshot: OverlaySnapshot, viewModel: PrototypeViewModel): string {
  if (snapshot.attention_state === 'normal' && snapshot.active_task) {
    return 'Active';
  }

  return viewModel.surfaceLabel;
}

function compactMarkMarkup(showBadge = true): string {
  return `
    <span class="compact-indicator__core">
      <img class="compact-indicator__mark" src="${superplanMarkUrl}" alt="" draggable="false" />
      ${showBadge ? '<span class="compact-indicator__badge" aria-hidden="true"></span>' : ''}
    </span>
  `;
}

function compactBoardIconMarkup(): string {
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1.3"></rect>
      <rect x="12" y="3" width="5" height="5" rx="1.3"></rect>
      <rect x="3" y="12" width="5" height="5" rx="1.3"></rect>
      <rect x="12" y="12" width="5" height="5" rx="1.3"></rect>
    </svg>
  `;
}

function compactCollapseIconMarkup(): string {
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 10h10"></path>
    </svg>
  `;
}

function compactCloseIconMarkup(): string {
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6.5 6.5 13.5 13.5"></path>
      <path d="M13.5 6.5 6.5 13.5"></path>
    </svg>
  `;
}

function boardShrinkIconMarkup(): string {
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M8 3H3v5"></path>
      <path d="M3 3l6 6"></path>
      <path d="M12 17h5v-5"></path>
      <path d="M17 17l-6-6"></path>
    </svg>
  `;
}

function boardBrandMarkup(): string {
  return `
    <span class="board-heading__mark" aria-hidden="true">
      <img class="board-heading__mark-image" src="${superplanMarkUrl}" alt="" />
    </span>
  `;
}

function boardTrafficLightsMarkup(): string {
  return `
    <div class="board-traffic-lights" role="toolbar" aria-label="Window controls">
      <button
        class="traffic-light traffic-light--close"
        data-action="hide-overlay"
        aria-label="Close overlay"
        title="Close overlay"
        type="button"
      >
        <span class="traffic-light__glyph" aria-hidden="true">×</span>
      </button>
      <button
        class="traffic-light traffic-light--minimize"
        data-action="toggle-mode"
        aria-label="Collapse to compact overlay"
        title="Collapse to compact overlay"
        type="button"
      ></button>
      <button
        class="traffic-light traffic-light--disabled"
        aria-label="Zoom unavailable"
        title="Zoom unavailable"
        type="button"
        disabled
      ></button>
    </div>
  `;
}

function parseTimestamp(value?: string): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatShortDuration(durationMs: number): string {
  if (durationMs < 60_000) {
    return `${Math.max(1, Math.floor(durationMs / 1000))}s`;
  }

  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes === 0 ? `${totalHours}h` : `${totalHours}h ${remainingMinutes}m`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours === 0 ? `${totalDays}d` : `${totalDays}d ${remainingHours}h`;
}

function formatClockLabel(timestamp?: string): string | null {
  const parsed = parseTimestamp(timestamp);
  if (parsed === null) {
    return null;
  }

  return new Date(parsed).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatElapsedLabel(startedAt?: string, prefix = 'Working for '): string | null {
  const startedTimestamp = parseTimestamp(startedAt);
  if (startedTimestamp === null) {
    return null;
  }

  return `${prefix}${formatShortDuration(Math.max(0, Date.now() - startedTimestamp))}`;
}

function formatRelativeLabel(timestamp?: string, prefix = 'Finished '): string | null {
  const parsedTimestamp = parseTimestamp(timestamp);
  if (parsedTimestamp === null) {
    return null;
  }

  const delta = Math.max(0, Date.now() - parsedTimestamp);
  if (delta < 60_000) {
    return `${prefix}just now`;
  }

  return `${prefix}${formatShortDuration(delta)} ago`;
}

function formatCompletionDurationLabel(task: OverlayTask): string | null {
  const startedTimestamp = parseTimestamp(task.started_at);
  const completedTimestamp = parseTimestamp(task.completed_at);
  if (startedTimestamp === null || completedTimestamp === null || completedTimestamp < startedTimestamp) {
    return null;
  }

  return `Done in ${formatShortDuration(completedTimestamp - startedTimestamp)}`;
}

function liveLabelMarkup(kind: 'elapsed' | 'relative', timestamp: string, prefix: string): string {
  const initialText = kind === 'elapsed'
    ? formatElapsedLabel(timestamp, prefix)
    : formatRelativeLabel(timestamp, prefix);

  if (!initialText) {
    return '';
  }

  return `
    <span
      data-live-label="${kind}"
      data-prefix="${escapeHtml(prefix)}"
      data-timestamp="${escapeHtml(timestamp)}"
    >${escapeHtml(initialText)}</span>
  `;
}

function refreshLiveTimeLabels(): void {
  document.querySelectorAll<HTMLElement>('[data-live-label]').forEach(element => {
    const kind = element.dataset.liveLabel;
    const timestamp = element.dataset.timestamp;
    const prefix = element.dataset.prefix ?? '';

    if (!timestamp || (kind !== 'elapsed' && kind !== 'relative')) {
      return;
    }

    const nextLabel = kind === 'elapsed'
      ? formatElapsedLabel(timestamp, prefix)
      : formatRelativeLabel(timestamp, prefix);

    if (nextLabel) {
      element.textContent = nextLabel;
    }
  });
}

function getTaskNote(task: OverlayTask): string | null {
  if (task.status === 'needs_feedback') {
    return task.message ?? task.description ?? null;
  }

  if (task.status === 'blocked') {
    return task.reason ?? task.description ?? null;
  }

  return null;
}

function taskCueMarkup(task: OverlayTask): string {
  if (typeof task.completed_acceptance_criteria === 'number'
    && typeof task.total_acceptance_criteria === 'number'
    && task.total_acceptance_criteria > 0) {
    return `
      <span class="task-progress-pill">
        ${escapeHtml(`${task.completed_acceptance_criteria}/${task.total_acceptance_criteria}`)}
      </span>
    `;
  }

  return '';
}

function taskLeadMarkup(task: OverlayTask): string {
  if (task.status === 'needs_feedback') {
    return 'Needs feedback';
  }

  if (task.status === 'blocked') {
    return 'Blocked';
  }

  if (task.status === 'done') {
    return 'Done';
  }

  if (task.status === 'in_progress') {
    return 'In progress';
  }

  if (isTaskReadyForReview(task)) {
    return 'Ready for review';
  }

  return 'Queued';
}

function taskMetaMarkup(task: OverlayTask): string {
  let detailMarkup = '';

  if (task.status === 'in_progress' && task.started_at) {
    const startedClock = formatClockLabel(task.started_at);
    const detailParts = [
      liveLabelMarkup('elapsed', task.started_at, 'Live '),
      startedClock ? `Started ${escapeHtml(startedClock)}` : '',
    ].filter(Boolean);

    detailMarkup = detailParts.length > 0
      ? `<span class="task-card__detail">${detailParts.join('<span class="task-card__detail-separator" aria-hidden="true"></span>')}</span>`
      : '';
  } else if (task.status === 'done' && task.completed_at) {
    const completionLabel = formatCompletionDurationLabel(task);
    const detailParts = [
      liveLabelMarkup('relative', task.completed_at, 'Finished '),
      completionLabel ? escapeHtml(completionLabel) : '',
    ].filter(Boolean);

    detailMarkup = `
      <span class="task-card__detail task-card__detail--relative">
        ${detailParts.join('<span class="task-card__detail-separator" aria-hidden="true"></span>')}
      </span>
    `;
  } else if ((task.status === 'needs_feedback' || task.status === 'blocked') && task.updated_at) {
    detailMarkup = `
      <span class="task-card__detail task-card__detail--relative">
        ${liveLabelMarkup('relative', task.updated_at, 'Updated ')}
      </span>
    `;
  }

  return `
    <div class="task-card__meta">
      <div class="task-card__meta-left">
        <span class="task-card__id">${escapeHtml(task.task_id)}</span>
        ${taskCueMarkup(task)}
      </div>
      ${detailMarkup}
    </div>
  `;
}

function changeStatusLabel(status: OverlayChange['status']): string {
  if (status === 'in_progress') {
    return 'In progress';
  }

  if (status === 'needs_feedback') {
    return 'Needs feedback';
  }

  if (status === 'blocked') {
    return 'Blocked';
  }

  if (status === 'done') {
    return 'Done';
  }

  if (status === 'tracking') {
    return 'Tracking';
  }

  return 'Queued';
}

function getSnapshotTasksForChange(snapshot: OverlaySnapshot, changeId: string): OverlayTask[] {
  return [
    ...snapshot.board.needs_feedback,
    ...snapshot.board.in_progress,
    ...snapshot.board.backlog,
    ...snapshot.board.blocked,
    ...snapshot.board.done,
  ].filter(task => task.change_id === changeId);
}

function taskGroupLabel(status: OverlayTask['status']): string {
  if (status === 'needs_feedback') {
    return 'Needs you';
  }

  if (status === 'in_progress') {
    return 'In progress';
  }

  if (status === 'blocked') {
    return 'Blocked';
  }

  if (status === 'done') {
    return 'Done';
  }

  return 'Backlog';
}

function changeTaskGroupMarkup(status: OverlayTask['status'], tasks: OverlayTask[]): string {
  if (tasks.length === 0) {
    return '';
  }

  return `
    <section class="change-card__task-group">
      <div class="change-card__task-group-header">
        <span>${escapeHtml(taskGroupLabel(status))}</span>
        <span>${escapeHtml(String(tasks.length))}</span>
      </div>
      <div class="change-card__task-list">
        ${tasks.map(task => `
          <article class="task-card task-card--${task.status}">
            <div class="task-card__topline">
              <p class="task-card__eyebrow">${taskLeadMarkup(task)}</p>
            </div>
            <strong>${escapeHtml(task.title)}</strong>
            ${getTaskNote(task) ? `<p class="task-card__note">${escapeHtml(getTaskNote(task)!)}</p>` : ''}
            ${taskMetaMarkup(task)}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function changeCardMarkup(snapshot: OverlaySnapshot, change: OverlayChange): string {
  const tasks = getSnapshotTasksForChange(snapshot, change.change_id);
  const workspaceName = getWorkspaceName(snapshot.workspace_path);
  const remainingTasks = Math.max(0, change.task_total - change.task_done);

  const groupedMarkup = ([
    'needs_feedback',
    'in_progress',
    'backlog',
    'blocked',
    'done',
  ] as OverlayTask['status'][]).map(status => (
    changeTaskGroupMarkup(status, tasks.filter(task => task.status === status))
  )).join('');

  return `
    <article class="change-card change-card--${change.status}">
      <header class="change-card__header">
        <div class="change-card__title-block">
          <div class="change-card__eyebrow-row">
            <span class="change-card__workspace">${escapeHtml(workspaceName)}</span>
            <span class="change-card__status">${escapeHtml(changeStatusLabel(change.status))}</span>
          </div>
          <h3>${escapeHtml(change.title)}</h3>
          <p class="change-card__meta">${escapeHtml(snapshot.workspace_path)}</p>
        </div>
        <div class="change-card__counts">
          <span class="change-card__count">${escapeHtml(`${change.task_done}/${change.task_total}`)}</span>
          <span class="change-card__count-label">${escapeHtml(remainingTasks === 0 ? 'Complete' : `${remainingTasks} left`)}</span>
        </div>
      </header>
      <div class="change-card__chips">
        <span class="change-card__chip">${escapeHtml(change.change_id)}</span>
        <span class="change-card__chip">${escapeHtml(`Updated ${new Date(change.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)}</span>
      </div>
      <div class="change-card__body">
        ${groupedMarkup || '<p class="change-card__empty">No tasks yet for this change.</p>'}
      </div>
    </article>
  `;
}

function expandedCardGridMarkup(): string {
  const snapshots = getRenderableSnapshots();
  const cards = snapshots.flatMap(snapshot => (
    getSnapshotTrackedChanges(snapshot).map(change => changeCardMarkup(snapshot, change))
  ));

  if (snapshots.length === 0 || cards.length === 0) {
    return `
      <section class="change-card-grid change-card-grid--empty">
        <article class="change-card change-card--empty">
          <header class="change-card__header">
            <div class="change-card__title-block">
              <div class="change-card__eyebrow-row">
                <span class="change-card__workspace">Overlay</span>
                <span class="change-card__status">Idle</span>
              </div>
              <h3>No tracked changes yet</h3>
              <p class="change-card__meta">Start a change in any Superplan workspace to populate this board.</p>
            </div>
          </header>
        </article>
      </section>
    `;
  }

  return `
    <section class="change-card-grid">
      ${cards.join('')}
    </section>
  `;
}

function getCompactTaskProgress(snapshot: OverlaySnapshot): { done: number; total: number; ratio: number } {
  return getSnapshotTaskProgress(snapshot);
}

function getCompactTaskDescription(task: OverlayTask | null): string {
  return task?.description?.trim() || 'Active task in progress.';
}

function compactWorkingDescriptionMarkup(task: OverlayTask | null): string {
  if (task?.started_at) {
    const liveMarkup = liveLabelMarkup('elapsed', task.started_at, 'Working for ');
    if (liveMarkup) {
      return liveMarkup;
    }
  }

  return escapeHtml(getCompactTaskDescription(task));
}

function getCompactDetailEyebrow(snapshot: OverlaySnapshot, task: OverlayTask | null, reviewReady: boolean): string {
  if (snapshot.active_task) {
    return 'Working now';
  }

  if (task?.status === 'blocked') {
    return 'Blocked';
  }

  if (task?.status === 'done') {
    return 'Recently finished';
  }

  if (reviewReady) {
    return 'Ready for review';
  }

  return 'Up next';
}

function compactDetailDescriptionMarkup(
  snapshot: OverlaySnapshot,
  viewModel: PrototypeViewModel,
  task: OverlayTask | null,
  reviewReady: boolean,
): string {
  if (snapshot.active_task) {
    return compactWorkingDescriptionMarkup(task);
  }

  if (task?.status === 'blocked' && task.updated_at) {
    return liveLabelMarkup('relative', task.updated_at, 'Updated ');
  }

  if (task?.status === 'done' && task.completed_at) {
    const completionDuration = formatCompletionDurationLabel(task);
    const detailParts = [
      liveLabelMarkup('relative', task.completed_at, 'Finished '),
      completionDuration ? escapeHtml(completionDuration) : '',
    ].filter(Boolean);

    if (detailParts.length > 0) {
      return detailParts.join('<span class="task-card__detail-separator" aria-hidden="true"></span>');
    }
  }

  const note = task ? getTaskNote(task) ?? task.description?.trim() ?? null : null;
  if (note) {
    return escapeHtml(note);
  }

  if (reviewReady) {
    return 'Task complete and waiting for approval.';
  }

  return escapeHtml(viewModel.secondaryLabel);
}

function getCompactChangeEyebrow(change: OverlayChange): string {
  if (change.status === 'tracking') {
    return 'Tracking change';
  }

  if (change.status === 'blocked') {
    return 'Change blocked';
  }

  if (change.status === 'needs_feedback') {
    return 'Needs your input';
  }

  if (change.status === 'done') {
    return 'Change complete';
  }

  return 'Change in motion';
}

function getCompactChangeHint(change: OverlayChange): string {
  if (change.task_total === 0) {
    return 'Waiting for the first task contract.';
  }

  if (change.status === 'done') {
    return 'All tracked tasks are complete.';
  }

  const remainingTasks = Math.max(0, change.task_total - change.task_done);
  if (remainingTasks === 0) {
    return 'No remaining tasks.';
  }

  return `${remainingTasks} ${remainingTasks === 1 ? 'task remains' : 'tasks remain'}.`;
}

function compactProgressMarkup(snapshot: OverlaySnapshot): string {
  const progress = getCompactTaskProgress(snapshot);
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - progress.ratio);

  return `
    <span class="compact-indicator__progress" aria-hidden="true">
      <svg viewBox="0 0 44 44" class="compact-indicator__progress-ring">
        <circle class="compact-indicator__progress-track" cx="22" cy="22" r="${radius}"></circle>
        <circle
          class="compact-indicator__progress-value-ring"
          cx="22"
          cy="22"
          r="${radius}"
          stroke-dasharray="${circumference.toFixed(2)}"
          stroke-dashoffset="${dashoffset.toFixed(2)}"
        ></circle>
      </svg>
      <span class="compact-indicator__progress-value">${progress.done}/${progress.total}</span>
    </span>
  `;
}

function compactLiveLoaderMarkup(): string {
  return `
    <span class="compact-indicator__live-loader" aria-hidden="true">
      <span class="compact-indicator__live-dot"></span>
      <span class="compact-indicator__live-dot"></span>
      <span class="compact-indicator__live-dot"></span>
    </span>
  `;
}

function compactIndicatorMarkup(viewModel: PrototypeViewModel): string {
  const statusLabel = getCompactStatusLabel(viewModel);
  const boardLabel = getCompactBoardLabel(viewModel);
  const presentation = latestSnapshot
    ? createCompactPresentationModel(latestSnapshot, { detailExpanded: compactWorkingExpanded })
    : null;
  const shouldShowDetail = presentation?.presentation === 'detail';

  if (shouldShowDetail && (viewModel.attentionState === 'needs_feedback' || viewModel.attentionState === 'all_tasks_done')) {
    const isDone = viewModel.attentionState === 'all_tasks_done';
    const doneCount = viewModel.columnCounts.done;
    const eyebrow = isDone ? 'Session complete' : 'Needs your input';
    const title = isDone
      ? 'All tasks done'
      : viewModel.primaryTask?.title ?? 'Task needs your input';
    const hint = compactHintMessage ?? (
      isDone
        ? doneCount > 0
          ? `Finished ${doneCount} ${doneCount === 1 ? 'task' : 'tasks'}.`
          : 'Everything is complete.'
        : null
    );
    const cornerBadgeMarkup = isDone
      ? ''
      : '<span class="compact-indicator__corner-badge" aria-hidden="true"></span>';

    return `
      <section
        class="compact-indicator compact-indicator--${viewModel.attentionState}"
        aria-label="${escapeHtml(statusLabel)}"
      >
        ${cornerBadgeMarkup}
        <div
          class="compact-indicator__main"
          data-action="show-compact-message"
          data-overlay-drag
        >
          ${compactMarkMarkup(false)}
          <span class="compact-indicator__content">
            <span class="compact-indicator__eyebrow">${escapeHtml(eyebrow)}</span>
            <span class="compact-indicator__title">${escapeHtml(title)}</span>
            ${hint
              ? `<span class="compact-indicator__hint" role="status">${escapeHtml(hint)}</span>`
              : ''}
          </span>
        </div>
        <div class="compact-indicator__attention-actions">
          <button
            class="compact-indicator__utility-button compact-indicator__utility-button--close"
            data-action="hide-overlay"
            aria-label="Hide overlay"
            type="button"
          >
            ${compactCloseIconMarkup()}
          </button>
          <button
            class="compact-indicator__board-button compact-indicator__board-button--attention"
            data-action="open-board"
            aria-label="${escapeHtml(boardLabel)}"
            type="button"
          >
            ${compactBoardIconMarkup()}
          </button>
        </div>
      </section>
    `;
  }

  if (shouldShowDetail && presentation?.focusKind === 'change' && presentation.focusedChange) {
    const change = presentation.focusedChange;
    const hint = compactHintMessage ?? getCompactChangeHint(change);

    return `
      <section
        class="compact-indicator compact-indicator--change_notice"
        aria-label="${escapeHtml(statusLabel)}"
      >
        <div
          class="compact-indicator__main"
          data-action="show-compact-message"
          data-overlay-drag
        >
          ${compactMarkMarkup(false)}
          <span class="compact-indicator__content">
            <span class="compact-indicator__eyebrow">${escapeHtml(getCompactChangeEyebrow(change))}</span>
            <span class="compact-indicator__title">${escapeHtml(change.title)}</span>
            <span class="compact-indicator__hint" role="status">${escapeHtml(hint)}</span>
          </span>
        </div>
        <div class="compact-indicator__attention-actions">
          <button
            class="compact-indicator__utility-button compact-indicator__utility-button--close"
            data-action="hide-overlay"
            aria-label="Hide overlay"
            type="button"
          >
            ${compactCloseIconMarkup()}
          </button>
          ${presentation.showBoardAction
            ? `
              <button
                class="compact-indicator__board-button compact-indicator__board-button--attention"
                data-action="open-board"
                aria-label="${escapeHtml(boardLabel)}"
                type="button"
              >
                ${compactBoardIconMarkup()}
              </button>
            `
            : ''}
        </div>
      </section>
    `;
  }

  if (viewModel.attentionState === 'normal' && presentation?.primaryTask && latestSnapshot && shouldShowDetail) {
    const detailTask = presentation.primaryTask;
    const reviewReady = presentation.isReviewReadyTask;
    const eyebrow = getCompactDetailEyebrow(latestSnapshot, detailTask, reviewReady);
    const descriptionMarkup = compactDetailDescriptionMarkup(latestSnapshot, viewModel, detailTask, reviewReady);
    const eyebrowClass = latestSnapshot.active_task
      ? 'compact-indicator__eyebrow'
      : 'compact-indicator__eyebrow compact-indicator__eyebrow--quiet';
    const detailModifier = latestSnapshot.active_task ? '' : ' compact-indicator--working_summary';

    return `
      <section
        class="compact-indicator compact-indicator--working_detail${detailModifier}"
        aria-label="${escapeHtml(statusLabel)}"
      >
        <div class="compact-indicator__main compact-indicator__main--working" data-overlay-drag>
          ${compactMarkMarkup(false)}
          <span class="compact-indicator__content compact-indicator__content--working">
            <span class="${eyebrowClass}">${escapeHtml(eyebrow)}${latestSnapshot.active_task ? compactLiveLoaderMarkup() : ''}</span>
            <span class="compact-indicator__title">${escapeHtml(detailTask.title)}</span>
            <span class="compact-indicator__description${latestSnapshot.active_task ? ' compact-indicator__description--live' : ''}">${descriptionMarkup}</span>
          </span>
          <div class="compact-indicator__working-actions">
            ${compactProgressMarkup(latestSnapshot)}
            <div class="compact-indicator__working-rail">
              <div class="compact-indicator__working-utility">
                <button
                  class="compact-indicator__utility-button compact-indicator__utility-button--close"
                  data-action="hide-overlay"
                  aria-label="Hide overlay"
                  type="button"
                >
                  ${compactCloseIconMarkup()}
                </button>
                ${presentation.showCollapseAction
                  ? `
                    <button
                      class="compact-indicator__utility-button compact-indicator__utility-button--collapse"
                      data-action="collapse-working-card"
                      aria-label="Minimize to compact chip"
                      type="button"
                    >
                      ${compactCollapseIconMarkup()}
                    </button>
                  `
                  : ''}
              </div>
              <button
                class="compact-indicator__board-button compact-indicator__board-button--working"
                data-action="open-board"
                aria-label="${escapeHtml(boardLabel)}"
                type="button"
              >
                ${compactBoardIconMarkup()}
              </button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <button
      class="compact-indicator compact-indicator--${viewModel.attentionState}"
      data-action="${viewModel.attentionState === 'normal' && viewModel.primaryTask ? 'expand-working-card' : 'show-compact-message'}"
      data-overlay-drag
      aria-label="${escapeHtml(statusLabel)}"
      type="button"
    >
      ${compactMarkMarkup(true)}
    </button>
  `;
}

function getCompactSize(snapshot: OverlaySnapshot): { width: number; height: number } {
  if (shouldShowCompactDetail(snapshot, compactWorkingExpanded)) {
    return getCompactAttentionPreset();
  }

  return getWindowPreset('compact');
}

function applyRootFrame(snapshot: OverlaySnapshot): void {
  if (!root) {
    return;
  }

  if (mode !== 'compact') {
    root.style.width = '';
    root.style.height = '';
    root.style.minHeight = '';
    return;
  }

  const preset = getCompactSize(snapshot);
  root.style.width = `${preset.width}px`;
  root.style.height = `${preset.height}px`;
  root.style.minHeight = `${preset.height}px`;
}

function shouldTriggerCompactAdvance(previousSnapshot: OverlaySnapshot | null, nextSnapshot: OverlaySnapshot): boolean {
  if (!previousSnapshot || nextSnapshot.attention_state !== 'normal') {
    return false;
  }

  return nextSnapshot.board.done.length > previousSnapshot.board.done.length
    || nextSnapshot.active_task?.task_id !== previousSnapshot.active_task?.task_id;
}

function activateCompactAdvanceCue(): void {
  compactAdvanceActive = true;

  if (compactAdvanceTimer !== undefined) {
    window.clearTimeout(compactAdvanceTimer);
  }

  compactAdvanceTimer = window.setTimeout(() => {
    compactAdvanceActive = false;
    compactAdvanceTimer = undefined;

    if (latestSnapshot) {
      render(latestSnapshot);
    }
  }, COMPACT_ADVANCE_DURATION_MS);
}

function showCompactHint(): void {
  compactHintMessage = COMPACT_COMING_SOON_MESSAGE;
  console.info('compact surface clicked', {
    sessionId: latestSnapshot?.session_id ?? null,
    attentionState: latestSnapshot?.attention_state ?? null,
  });

  if (compactHintTimer !== undefined) {
    window.clearTimeout(compactHintTimer);
  }

  compactHintTimer = window.setTimeout(() => {
    compactHintMessage = null;
    compactHintTimer = undefined;

    if (latestSnapshot) {
      render(latestSnapshot);
    }
  }, COMPACT_HINT_DURATION_MS);

  if (latestSnapshot) {
    render(latestSnapshot);
  }
}

function waitForNextFrame(): Promise<void> {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => resolve());
  });
}

function resetPendingOverlayDrag(): void {
  pendingOverlayDragSurface = null;
  pendingOverlayDragStartX = 0;
  pendingOverlayDragStartY = 0;
  overlayDragDidStart = false;
}

function clearCompactSurfaceClickSuppression(): void {
  suppressNextCompactSurfaceClick = false;

  if (suppressNextCompactSurfaceClickTimer !== undefined) {
    window.clearTimeout(suppressNextCompactSurfaceClickTimer);
    suppressNextCompactSurfaceClickTimer = undefined;
  }
}

function suppressCompactSurfaceClick(): void {
  suppressNextCompactSurfaceClick = true;

  if (suppressNextCompactSurfaceClickTimer !== undefined) {
    window.clearTimeout(suppressNextCompactSurfaceClickTimer);
  }

  suppressNextCompactSurfaceClickTimer = window.setTimeout(() => {
    clearCompactSurfaceClickSuppression();
  }, COMPACT_DRAG_CLICK_SUPPRESSION_MS);
}

function shouldSuppressCompactSurfaceClick(): boolean {
  return overlayDragDidStart || overlayDragInProgress || suppressNextCompactSurfaceClick;
}

async function startOverlayDrag(): Promise<void> {
  overlayDragInProgress = true;

  try {
    await invoke('start_overlay_drag');
  } catch (error) {
    console.error('native start_overlay_drag failed', error);

    const appWindow = getAppWindow();
    if (appWindow) {
      try {
        await appWindow.startDragging();
      } catch (fallbackError) {
        console.error('window drag fallback failed', fallbackError);
      }
    }
  } finally {
    overlayDragInProgress = false;
    suppressCompactSurfaceClick();
  }
}

function handleOverlayDragMove(event: MouseEvent): void {
  if (!pendingOverlayDragSurface || mode !== 'compact') {
    return;
  }

  const deltaX = event.clientX - pendingOverlayDragStartX;
  const deltaY = event.clientY - pendingOverlayDragStartY;
  if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  overlayDragDidStart = true;
  suppressCompactSurfaceClick();
  pendingOverlayDragSurface = null;
  pendingOverlayDragStartX = 0;
  pendingOverlayDragStartY = 0;
  void startOverlayDrag();
}

function handleOverlayDragEnd(): void {
  if (overlayDragDidStart || overlayDragInProgress) {
    suppressCompactSurfaceClick();
  }

  resetPendingOverlayDrag();
}

function bindOverlayDragSurface(surface: HTMLElement): void {
  surface.addEventListener('mousedown', event => {
    if (mode !== 'compact' || event.button !== 0) {
      return;
    }

    pendingOverlayDragSurface = surface;
    pendingOverlayDragStartX = event.clientX;
    pendingOverlayDragStartY = event.clientY;
  });

  surface.addEventListener('dragstart', event => {
    event.preventDefault();
  });

  surface.addEventListener('click', event => {
    if (!shouldSuppressCompactSurfaceClick()) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    clearCompactSurfaceClickSuppression();
  }, true);
}

async function setCompactWorkingExpanded(expanded: boolean): Promise<void> {
  compactWorkingExpanded = expanded;
  writeStoredCompactWorkingExpanded(expanded);

  if (!latestSnapshot || mode !== 'compact') {
    return;
  }

  const preset = getCompactSize(latestSnapshot);
  render(latestSnapshot);
  await waitForNextFrame();
  await setOverlaySize(preset.width, preset.height);
  render(latestSnapshot);
}

async function hideOverlayFromUi(): Promise<void> {
  const updatedAt = new Date().toISOString();

  for (const workspacePath of getVisibleWorkspacePaths()) {
    try {
      await invoke('persist_overlay_requested_action', {
        requestedAction: 'hide',
        updatedAt,
        visible: false,
        workspacePath,
      });
    } catch (error) {
      console.error('persist_overlay_requested_action failed', error);
    }
  }

  latestControlStates = latestControlStates.map(control => ({
    ...control,
    requested_action: 'hide',
    updated_at: updatedAt,
    visible: false,
  }));
  lastAppliedVisibility = false;
  await terminateOverlayApplication();
}

async function enterExpandedWindowMode(): Promise<void> {
  const appWindow = getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    await appWindow.setResizable(true);
    await appWindow.setMaxSize(null);
    await appWindow.setMinSize(new LogicalSize(EXPANDED_MIN_WIDTH, EXPANDED_MIN_HEIGHT));
  } catch (error) {
    console.error('set expanded window mode failed', error);
  }
}

async function enterCompactWindowMode(): Promise<void> {
  const appWindow = getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    if (latestSnapshot) {
      const preset = getCompactSize(latestSnapshot);
      await appWindow.setMinSize(new LogicalSize(preset.width, preset.height));
      await appWindow.setMaxSize(new LogicalSize(preset.width, preset.height));
    }
    await appWindow.setResizable(false);
  } catch (error) {
    console.error('set compact window mode failed', error);
  }
}

function bindExpandedWindowDragSurface(surface: HTMLElement): void {
  surface.addEventListener('mousedown', event => {
    if (mode !== 'expanded' || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select')) {
      return;
    }

    event.preventDefault();
    void startOverlayDrag();
  });
}

function boardResizeZonesMarkup(): string {
  const zones = [
    ['North', 'board-resize-zone--north'],
    ['South', 'board-resize-zone--south'],
    ['East', 'board-resize-zone--east'],
    ['West', 'board-resize-zone--west'],
    ['NorthEast', 'board-resize-zone--north-east'],
    ['NorthWest', 'board-resize-zone--north-west'],
    ['SouthEast', 'board-resize-zone--south-east'],
    ['SouthWest', 'board-resize-zone--south-west'],
  ] as const;

  return zones.map(([direction, className]) => `
    <div class="board-resize-zone ${className}" data-resize-direction="${direction}" aria-hidden="true"></div>
  `).join('');
}

function isResizeDirection(value: string): value is ResizeDirection {
  return RESIZE_DIRECTIONS.has(value as ResizeDirection);
}

function render(snapshot: OverlaySnapshot): void {
  if (!root) {
    return;
  }

  const viewModel = createPrototypeViewModel(snapshot, mode);
  applyRootFrame(snapshot);

  root.className = [
    'app-shell',
    `app-shell--${viewModel.mode}`,
    `app-shell--attention-${viewModel.attentionState}`,
    compactAdvanceActive ? 'app-shell--advance' : '',
  ].filter(Boolean).join(' ');
  root.innerHTML = viewModel.mode === 'compact'
    ? `
      ${compactIndicatorMarkup(viewModel)}
    `
    : `
      <section class="board-surface">
        <header class="board-topbar" data-expanded-window-drag>
          <div class="board-heading">
            ${boardTrafficLightsMarkup()}
            ${boardBrandMarkup()}
            <div class="board-heading__copy">
              <p class="eyebrow">Superplan board</p>
              <h1>Tracked changes</h1>
              <p class="board-heading__meta">${escapeHtml(`${getRenderableSnapshots().length} active workspace view${getRenderableSnapshots().length === 1 ? '' : 's'}`)}</p>
            </div>
          </div>
          <div class="board-topbar__actions">
            <div class="status-pill status-pill--${viewModel.attentionState}">
              <span class="status-pill__dot"></span>
              ${escapeHtml(getExpandedSurfaceLabel(snapshot, viewModel))}
            </div>
            <button
              class="ghost-button board-shrink-button"
              data-action="toggle-mode"
              aria-label="Shrink overlay"
              title="Shrink overlay"
              type="button"
            >
              ${boardShrinkIconMarkup()}
              <span>Shrink</span>
            </button>
          </div>
        </header>

        ${expandedCardGridMarkup()}
      </section>
      ${boardResizeZonesMarkup()}
    `;

  refreshLiveTimeLabels();

  root.querySelectorAll<HTMLElement>('[data-action="toggle-mode"]').forEach(element => {
    element.addEventListener('click', async () => {
      await setMode(getNextMode(mode));
    });
  });

  root.querySelector('[data-action="expand-working-card"]')?.addEventListener('click', async () => {
    await setCompactWorkingExpanded(true);
  });

  root.querySelector('[data-action="collapse-working-card"]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await setCompactWorkingExpanded(false);
  });

  root.querySelectorAll<HTMLElement>('[data-action="hide-overlay"]').forEach(element => {
    element.addEventListener('click', async (event) => {
      event.stopPropagation();
      await hideOverlayFromUi();
    });
  });

  root.querySelector('[data-action="open-board"]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    compactWorkingExpanded = false;
    await setMode('expanded');
  });

  root.querySelector('[data-action="show-compact-message"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    showCompactHint();
  });

  root.querySelectorAll<HTMLElement>('[data-action="refresh"]').forEach(element => {
    element.addEventListener('click', async () => {
      await loadSnapshot();
    });
  });

  root.querySelectorAll<HTMLElement>('[data-resize-direction]').forEach(element => {
    element.addEventListener('mousedown', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const appWindow = getAppWindow();
      const direction = element.getAttribute('data-resize-direction');
      if (!appWindow || mode !== 'expanded' || !direction || !isResizeDirection(direction)) {
        return;
      }

      try {
        await appWindow.startResizeDragging(direction);
      } catch (error) {
        console.error('board resize drag failed', error);
      }
    });
  });

  root.querySelectorAll<HTMLElement>('[data-overlay-drag]').forEach(bindOverlayDragSurface);
  root.querySelectorAll<HTMLElement>('[data-expanded-window-drag]').forEach(bindExpandedWindowDragSurface);
}

function renderStartupError(error: unknown): void {
  if (!root) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  root.className = 'app-shell app-shell--compact app-shell--attention-needs_feedback';
  root.innerHTML = `
    <section class="compact-card">
      <p class="eyebrow">Startup error</p>
      <h2>Overlay prototype failed to initialize</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

async function setMode(nextMode: PrototypeMode): Promise<void> {
  if (nextMode !== 'compact') {
    compactWorkingExpanded = false;
  } else {
    compactWorkingExpanded = readStoredCompactWorkingExpanded();
  }

  mode = nextMode;
  const preset = nextMode === 'compact' && latestSnapshot
    ? getCompactSize(latestSnapshot)
    : getWindowPreset(nextMode);

  if (nextMode === 'expanded') {
    await enterExpandedWindowMode();
  } else {
    await enterCompactWindowMode();
  }

  await setOverlaySize(preset.width, preset.height);

  if (nextMode === 'expanded') {
    const appWindow = getAppWindow();
    if (appWindow) {
      try {
        await appWindow.center();
      } catch (error) {
        console.error('center expanded window failed', error);
      }
    }
  } else {
    await restoreOverlayPosition();
  }

  if (latestSnapshot) {
    render(latestSnapshot);
  }
}

async function loadSnapshot(): Promise<void> {
  let snapshotText: string;
  if (isTauriWindowAvailable(getCurrentWindow)) {
    try {
      snapshotText = await invoke<string>('load_overlay_snapshots');
      // Bug fix: reset failure counter on every success.
      consecutiveSnapshotFailures = 0;
    } catch {
      consecutiveSnapshotFailures += 1;

      if (consecutiveSnapshotFailures < MAX_CONSECUTIVE_SNAPSHOT_FAILURES) {
        // Transient failure (disk hiccup, cold-start race) — keep the last
        // known snapshot rather than collapsing to empty immediately.
        return;
      }

      // N consecutive failures — something is structurally wrong, fall through
      // to empty snapshot which will trigger a graceful exit.
      snapshotText = JSON.stringify([]);
    }
  } else {
    snapshotText = JSON.stringify([getBrowserFallbackSnapshot()]);
  }

  if (snapshotText === lastSnapshotText && latestSnapshot) {
    return;
  }

  lastSnapshotText = snapshotText;
  const previousSnapshot = latestSnapshot;
  latestSnapshots = JSON.parse(snapshotText) as OverlaySnapshot[];
  latestSnapshot = getPrimarySnapshot();
  if (!latestSnapshot) {
    latestSnapshot = getEmptyRuntimeSnapshot() as OverlaySnapshot;
  }
  const attentionSoundKind = getAttentionSoundKind(previousSnapshot, latestSnapshot);

  if (attentionSoundKind) {
    void playAttentionSound(attentionSoundKind);
  }

  if (shouldAutoExpandCompactDetail(previousSnapshot, latestSnapshot, mode)) {
    compactWorkingExpanded = true;
    writeStoredCompactWorkingExpanded(true);
  }

  if (shouldTriggerCompactAdvance(previousSnapshot, latestSnapshot)) {
    activateCompactAdvanceCue();
  }

  if (mode === 'compact') {
    const preset = getCompactSize(latestSnapshot);
    await setOverlaySize(preset.width, preset.height);
  }

  render(latestSnapshot);
}

async function applyVisibility(visible: boolean): Promise<void> {
  try {
    await invoke('set_overlay_visibility', { visible });
    return;
  } catch (error) {
    console.error('set_overlay_visibility failed', error);
  }

  const appWindow = getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    if (visible) {
      await appWindow.show();
    } else {
      await appWindow.hide();
    }
  } catch (error) {
    console.error('window visibility fallback failed', error);
  }
}

async function setOverlaySize(width: number, height: number): Promise<void> {
  try {
    await invoke('set_overlay_size', { width, height });
    return;
  } catch (error) {
    console.error('set_overlay_size failed', error);
  }

  const appWindow = getAppWindow();
  if (!appWindow) {
    return;
  }

  try {
    await appWindow.setSize(new LogicalSize(width, height));
  } catch (error) {
    console.error('window size fallback failed', error);
  }
}

async function playAttentionSound(kind: string): Promise<void> {
  try {
    await invoke('play_overlay_alert_sound', { kind });
  } catch (error) {
    console.error('play_overlay_alert_sound failed', error);
  }
}

let consecutiveControlFailures = 0;

async function loadControlState(): Promise<void> {
  let controlText: string;
  try {
    controlText = await invoke<string>('load_overlay_control_states');
    consecutiveControlFailures = 0;
  } catch {
    consecutiveControlFailures += 1;
    if (consecutiveControlFailures < MAX_CONSECUTIVE_SNAPSHOT_FAILURES) {
      // Transient FS error. Keep previous control state and skip update this tick.
      return;
    }
    controlText = '[]';
  }

  if (controlText === lastControlText) {
    return;
  }

  lastControlText = controlText;
  const previousSelectionKey = getSnapshotSelectionKey(latestSnapshot);
  latestControlStates = JSON.parse(controlText) as OverlayControlState[];
  const nextPrimarySnapshot = getPrimarySnapshot() ?? latestSnapshot;
  latestSnapshot = nextPrimarySnapshot;

  if (nextPrimarySnapshot && getSnapshotSelectionKey(nextPrimarySnapshot) !== previousSelectionKey) {
    render(nextPrimarySnapshot);
  }
}

async function syncDerivedVisibility(): Promise<void> {
  latestSnapshot = getPrimarySnapshot() ?? latestSnapshot;
  const visibleWorkspacePaths = getVisibleWorkspacePaths();
  const visible = latestSnapshots.some(snapshot => (
    visibleWorkspacePaths.has(snapshot.workspace_path) && hasRenderableSnapshotContent(snapshot)
  ));

  if (lastAppliedVisibility === visible) {
    return;
  }

  lastAppliedVisibility = visible;
  if (!visible) {
    // Bug H6 fix: don't terminate on the very first tick when the control-state
    // files have not been flushed yet at cold start. That momentarily looks
    // like "no workspace asked to be visible" and would otherwise exit early.
    if (!bootstrapComplete) {
      return;
    }
    await terminateOverlayApplication();
    return;
  }

  // Mark bootstrap complete once we've successfully shown the overlay.
  bootstrapComplete = true;

  // Restart the poll timer in case it was stopped when the overlay was last hidden.
  if (pollTimer === undefined) {
    pollTimer = window.setInterval(() => {
      void syncOverlayRuntime();
    }, POLL_INTERVAL_MS);
  }

  await applyVisibility(true);
}

async function terminateOverlayApplication(): Promise<void> {
  // Bug H4/H8 fix: stop ALL timers immediately so they don't fire during the
  // async process-exit window and waste CPU/prevent V8 GC idle time.
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }

  if (liveTimeTimer !== undefined) {
    window.clearInterval(liveTimeTimer);
    liveTimeTimer = undefined;
  }

  if (compactAdvanceTimer !== undefined) {
    window.clearTimeout(compactAdvanceTimer);
    compactAdvanceTimer = undefined;
  }

  if (compactHintTimer !== undefined) {
    window.clearTimeout(compactHintTimer);
    compactHintTimer = undefined;
  }

  clearCompactSurfaceClickSuppression();

  try {
    await invoke('exit_overlay_application');
    return;
  } catch (error) {
    console.error('exit_overlay_application failed', error);
  }

  const appWindow = getAppWindow();
  if (appWindow) {
    try {
      await appWindow.close();
      return;
    } catch (error) {
      console.error('window close fallback failed', error);
    }
  }

  // Last resort: navigate away so all JS timers stop and the WebView idles.
  // Do NOT call applyVisibility(false) here — that only hides the window
  // while leaving the process alive and burning CPU/RAM.
  try {
    window.location.replace('about:blank');
  } catch {
    // ignore — already done our best
  }
}

// Bug #13 fix: only run one syncOverlayRuntime at a time.  If a previous sync
// is still in flight (slow disk) and the poll timer fires again, skip so we
// don't end up calling terminateOverlayApplication twice concurrently.
async function syncOverlayRuntime(): Promise<void> {
  if (syncInFlight) {
    return;
  }

  syncInFlight = true;
  try {
    await Promise.all([
      loadSnapshot(),
      loadControlState(),
    ]);
    await syncDerivedVisibility();
  } finally {
    syncInFlight = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || mode !== 'expanded') {
    return;
  }

  event.preventDefault();
  void setMode('compact');
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    compactWorkingExpanded = readStoredCompactWorkingExpanded();
    await installOverlayPositionPersistence();
    await restoreOverlayPosition();
    await syncOverlayRuntime();
    await setMode('compact');
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mousemove', handleOverlayDragMove, true);
    window.addEventListener('mouseup', handleOverlayDragEnd, true);
    window.addEventListener('blur', handleOverlayDragEnd);
    // Only start the poll timer if the overlay is actually visible.
    // syncDerivedVisibility will restart it when visibility turns on.
    if (lastAppliedVisibility !== false) {
      pollTimer = window.setInterval(() => {
        void syncOverlayRuntime();
      }, POLL_INTERVAL_MS);
    }
    liveTimeTimer = window.setInterval(() => {
      refreshLiveTimeLabels();
    }, LIVE_TIME_REFRESH_MS);
    // Bug #9 fix: immediately re-poll when the Rust single-instance handler
    // switches workspace. Without this, the frontend waits up to POLL_INTERVAL_MS
    // before picking up the new workspace's snapshot.
    try {
      await listen('overlay:workspace-changed', () => {
        consecutiveSnapshotFailures = 0;
        void syncOverlayRuntime();
      });
    } catch {
      // Non-fatal: older Tauri contexts may not support this event.
    }
  } catch (error) {
    console.error('startup failed', error);
    renderStartupError(error);
  }
});

window.addEventListener('beforeunload', () => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('mousemove', handleOverlayDragMove, true);
  window.removeEventListener('mouseup', handleOverlayDragEnd, true);
  window.removeEventListener('blur', handleOverlayDragEnd);

  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
  }

  if (liveTimeTimer !== undefined) {
    window.clearInterval(liveTimeTimer);
  }

  if (compactAdvanceTimer !== undefined) {
    window.clearTimeout(compactAdvanceTimer);
  }

  if (compactHintTimer !== undefined) {
    window.clearTimeout(compactHintTimer);
  }

  clearCompactSurfaceClickSuppression();

  if (overlayMovedUnlisten) {
    overlayMovedUnlisten();
    overlayMovedUnlisten = null;
  }

  resetPendingOverlayDrag();
});

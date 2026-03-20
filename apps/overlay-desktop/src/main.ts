import { invoke } from '@tauri-apps/api/core';
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
import { getBrowserFallbackSnapshot, isTauriWindowAvailable } from './lib/runtime-helpers.js';

type OverlayTask = {
  task_id: string;
  title: string;
  description?: string;
  status: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  reason?: string;
  message?: string;
};

type OverlaySnapshot = {
  workspace_path: string;
  session_id: string;
  updated_at: string;
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

const POLL_INTERVAL_MS = 900;
const LIVE_TIME_REFRESH_MS = 1000;
const COMPACT_ADVANCE_DURATION_MS = 1600;
const COMPACT_HINT_DURATION_MS = 2400;
const COMPACT_DRAG_CLICK_SUPPRESSION_MS = 3000;
const COMPACT_COMING_SOON_MESSAGE = 'Click coming soon. Go to your coding agent';
const DRAG_THRESHOLD_PX = 4;
const OVERLAY_POSITION_STORAGE_KEY = 'superplan.overlay.position';
const superplanMarkUrl = new URL('./assets/superplan-mark.png', import.meta.url).href;

let mode: PrototypeMode = 'compact';
let latestSnapshot: OverlaySnapshot | null = null;
let lastSnapshotText = '';
let lastControlText: string | null = null;
let pollTimer: number | undefined;
let liveTimeTimer: number | undefined;
let compactAdvanceTimer: number | undefined;
let compactAdvanceActive = false;
let compactHintMessage: string | null = null;
let compactHintTimer: number | undefined;
let compactWorkingExpanded = false;
let overlayMovedUnlisten: (() => void) | null = null;
let pendingOverlayDragSurface: HTMLElement | null = null;
let pendingOverlayDragStartX = 0;
let pendingOverlayDragStartY = 0;
let overlayDragDidStart = false;
let overlayDragInProgress = false;
let suppressNextCompactSurfaceClick = false;
let suppressNextCompactSurfaceClickTimer: number | undefined;

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
    return 'All tasks done.';
  }

  if (!viewModel.primaryTask) {
    return 'Waiting for the next task.';
  }

  return `Working on ${viewModel.primaryTask.title}.`;
}

function getCompactBoardLabel(viewModel: PrototypeViewModel): string {
  if (viewModel.primaryTask) {
    return `Open full board for ${viewModel.primaryTask.title}.`;
  }

  return 'Open full board.';
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
      <path d="M5 12.5 10 7.5 15 12.5"></path>
    </svg>
  `;
}

function boardRefreshIconMarkup(): string {
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M16 10a6 6 0 1 1-1.76-4.24"></path>
      <path d="M16 4v4h-4"></path>
    </svg>
  `;
}

function boardCollapseIconMarkup(): string {
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
      <span class="board-heading__mark-core">
        <img class="board-heading__mark-image" src="${superplanMarkUrl}" alt="" />
      </span>
    </span>
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

function getBoardStatLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function boardStatMarkup(label: string, value: string, tone: 'neutral' | 'live' | 'done' | 'warning' = 'neutral'): string {
  return `
    <div class="board-stat board-stat--${tone}">
      <span class="board-stat__label">${escapeHtml(label)}</span>
      <strong class="board-stat__value">${escapeHtml(value)}</strong>
    </div>
  `;
}

function boardStatLiveMarkup(
  label: string,
  kind: 'elapsed' | 'relative',
  timestamp: string,
  prefix: string,
  tone: 'neutral' | 'live' | 'done' | 'warning' = 'neutral',
): string {
  return `
    <div class="board-stat board-stat--${tone}">
      <span class="board-stat__label">${escapeHtml(label)}</span>
      <strong class="board-stat__value">
        ${liveLabelMarkup(kind, timestamp, prefix)}
      </strong>
    </div>
  `;
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
  if (task.status === 'in_progress') {
    return `
      <span class="task-cue task-cue--live">
        <span class="live-indicator" aria-hidden="true"></span>
        Live
      </span>
    `;
  }

  if (task.status === 'needs_feedback') {
    return '<span class="task-cue task-cue--needs_feedback">You</span>';
  }

  if (task.status === 'blocked') {
    return '<span class="task-cue task-cue--blocked">Blocked</span>';
  }

  if (task.status === 'done') {
    return '<span class="task-cue task-cue--done">Done</span>';
  }

  return '';
}

function taskLeadMarkup(task: OverlayTask): string {
  if (task.status === 'in_progress' && task.started_at) {
    return liveLabelMarkup('elapsed', task.started_at, 'Working for ');
  }

  if (task.status === 'done') {
    return escapeHtml(formatCompletionDurationLabel(task) ?? 'Finished');
  }

  if (task.status === 'needs_feedback') {
    return 'Waiting on you';
  }

  if (task.status === 'blocked') {
    return 'Blocked';
  }

  return 'Queued';
}

function taskMetaMarkup(task: OverlayTask): string {
  let detailMarkup = '';

  if (task.status === 'in_progress' && task.started_at) {
    const startedClock = formatClockLabel(task.started_at);
    detailMarkup = startedClock ? `<span class="task-card__detail">Started ${escapeHtml(startedClock)}</span>` : '';
  } else if (task.status === 'done' && task.completed_at) {
    detailMarkup = `
      <span class="task-card__detail task-card__detail--relative">
        ${liveLabelMarkup('relative', task.completed_at, 'Finished ')}
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
      <span class="task-card__id">${escapeHtml(task.task_id)}</span>
      ${detailMarkup}
    </div>
  `;
}

function getEmptyColumnLabel(columnKey: PrototypeViewModel['visibleColumns'][number]['key']): string {
  if (columnKey === 'in_progress') {
    return 'No live task';
  }

  if (columnKey === 'backlog') {
    return 'Nothing queued';
  }

  if (columnKey === 'done') {
    return 'Nothing shipped yet';
  }

  if (columnKey === 'blocked') {
    return 'Nothing blocked';
  }

  return 'No handoff waiting';
}

function getCompactTaskProgress(snapshot: OverlaySnapshot): { done: number; total: number; ratio: number } {
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

function getCompactTaskDescription(task: OverlayTask | null): string {
  return task?.description?.trim() || 'Active task in progress.';
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

function shouldShowWorkingDetail(snapshot: OverlaySnapshot): boolean {
  return snapshot.attention_state === 'normal'
    && Boolean(snapshot.active_task)
    && compactWorkingExpanded;
}

function compactIndicatorMarkup(viewModel: PrototypeViewModel): string {
  const statusLabel = getCompactStatusLabel(viewModel);
  const boardLabel = getCompactBoardLabel(viewModel);

  if (viewModel.attentionState === 'needs_feedback') {
    const feedbackTitle = viewModel.primaryTask?.title ?? 'Task needs your input';

    return `
      <section
        class="compact-indicator compact-indicator--${viewModel.attentionState}"
        aria-label="${escapeHtml(statusLabel)}"
      >
        <span class="compact-indicator__corner-badge" aria-hidden="true"></span>
        <div
          class="compact-indicator__main"
          data-action="show-compact-message"
          data-overlay-drag
        >
          ${compactMarkMarkup(false)}
          <span class="compact-indicator__content">
            <span class="compact-indicator__eyebrow">Needs your input</span>
            <span class="compact-indicator__title">${escapeHtml(feedbackTitle)}</span>
            ${compactHintMessage
              ? `<span class="compact-indicator__hint" role="status">${escapeHtml(compactHintMessage)}</span>`
              : ''}
          </span>
        </div>
        <button
          class="compact-indicator__board-button"
          data-action="open-board"
          aria-label="${escapeHtml(boardLabel)}"
          type="button"
        >
          ${compactBoardIconMarkup()}
        </button>
      </section>
    `;
  }

  if (viewModel.attentionState === 'normal' && viewModel.primaryTask && latestSnapshot && shouldShowWorkingDetail(latestSnapshot)) {
    return `
      <section
        class="compact-indicator compact-indicator--working_detail"
        aria-label="${escapeHtml(statusLabel)}"
      >
        <div class="compact-indicator__main compact-indicator__main--working" data-overlay-drag>
          ${compactMarkMarkup(false)}
          <span class="compact-indicator__content compact-indicator__content--working">
            <span class="compact-indicator__eyebrow">Working now</span>
            <span class="compact-indicator__title">${escapeHtml(viewModel.primaryTask.title)}</span>
            <span class="compact-indicator__description">${escapeHtml(getCompactTaskDescription(viewModel.primaryTask))}</span>
          </span>
          ${compactProgressMarkup(latestSnapshot)}
        </div>
        <div class="compact-indicator__utility">
          <button
            class="compact-indicator__utility-button"
            data-action="collapse-working-card"
            aria-label="Collapse working details"
            type="button"
          >
            ${compactCollapseIconMarkup()}
          </button>
          <button
            class="compact-indicator__utility-button"
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
  if (snapshot.attention_state === 'needs_feedback' || shouldShowWorkingDetail(snapshot)) {
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

  if (!latestSnapshot || mode !== 'compact') {
    return;
  }

  const preset = getCompactSize(latestSnapshot);
  render(latestSnapshot);
  await waitForNextFrame();
  await setOverlaySize(preset.width, preset.height);
  render(latestSnapshot);
}

function activeStripMarkup(snapshot: OverlaySnapshot, viewModel: PrototypeViewModel): string {
  const activeTask = snapshot.active_task;
  const stripTask = activeTask ?? viewModel.primaryTask;
  const stripTone = activeTask?.status
    ?? (viewModel.attentionState === 'needs_feedback'
      ? 'needs_feedback'
      : viewModel.attentionState === 'all_tasks_done'
        ? 'done'
        : 'backlog');

  const boardStats = [
    activeTask?.started_at
      ? boardStatLiveMarkup('Live', 'elapsed', activeTask.started_at, '', 'live')
      : '',
    viewModel.columnCounts.backlog > 0
      ? boardStatMarkup('Queued', getBoardStatLabel(viewModel.columnCounts.backlog, 'task'), 'neutral')
      : '',
    viewModel.columnCounts.done > 0
      ? boardStatMarkup('Done', getBoardStatLabel(viewModel.columnCounts.done, 'task'), 'done')
      : '',
    viewModel.columnCounts.blocked > 0
      ? boardStatMarkup('Blocked', getBoardStatLabel(viewModel.columnCounts.blocked, 'task'), 'warning')
      : '',
  ].filter(Boolean).join('');

  if (!stripTask) {
    return `
      <section class="active-strip active-strip--empty">
        <div class="active-strip__main">
          <p class="eyebrow">No task in progress</p>
          <div class="active-strip__copy">
            <h2>Waiting for the next snapshot</h2>
          </div>
        </div>
        <div class="active-strip__stats">
          ${boardStats || boardStatMarkup('State', 'Quiet', 'neutral')}
        </div>
      </section>
    `;
  }

  const stripNote = activeTask?.description
    ?? (stripTask.status === 'needs_feedback' ? stripTask.message : null)
    ?? (stripTask.status === 'blocked' ? stripTask.reason : null)
    ?? null;

  return `
    <section class="active-strip active-strip--${stripTone}">
      <div class="active-strip__main">
        <div class="active-strip__status">
          ${stripTask.status === 'in_progress' ? '<span class="live-indicator" aria-hidden="true"></span>' : ''}
          <span>${escapeHtml(viewModel.secondaryLabel)}</span>
        </div>
        <div class="active-strip__copy">
          <h2>${escapeHtml(stripTask.title)}</h2>
          ${stripNote ? `<p>${escapeHtml(stripNote)}</p>` : ''}
        </div>
      </div>
      <div class="active-strip__stats">
        ${boardStats}
      </div>
    </section>
  `;
}

function columnMarkup(column: PrototypeViewModel['visibleColumns'][number]): string {
  return `
    <section class="board-column board-column--${column.tone}" data-column="${column.key}">
      <header>
        <div>
          <p class="eyebrow">${column.count === 1 ? '1 task' : `${column.count} tasks`}</p>
          <h3>${column.title}</h3>
        </div>
        <span>${column.count}</span>
      </header>
      <div class="board-stack">
        ${column.items.length === 0
          ? `<p class="board-empty">${getEmptyColumnLabel(column.key)}</p>`
          : column.items.map(item => `
              <article class="task-card task-card--${item.status}">
                <div class="task-card__header">
                  <div class="task-card__headline">
                    <p class="task-card__eyebrow">${taskLeadMarkup(item)}</p>
                    <strong>${escapeHtml(item.title)}</strong>
                  </div>
                  ${taskCueMarkup(item)}
                </div>
                ${taskMetaMarkup(item)}
                ${getTaskNote(item) ? `<p class="task-card__note">${escapeHtml(getTaskNote(item)!)}</p>` : ''}
              </article>
            `).join('')}
      </div>
    </section>
  `;
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
        <header class="board-topbar">
          <div class="board-heading">
            ${boardBrandMarkup()}
            <div class="board-heading__copy">
              <p class="eyebrow">Superplan board</p>
              <h1>${escapeHtml(viewModel.workspaceLabel)}</h1>
              <p class="board-heading__meta">${escapeHtml(viewModel.updatedLabel)}</p>
            </div>
          </div>
          <div class="board-topbar__actions">
            <div class="status-pill status-pill--${viewModel.attentionState}">
              <span class="status-pill__dot"></span>
              ${escapeHtml(viewModel.surfaceLabel)}
            </div>
            <div class="board-window-controls" role="toolbar" aria-label="Board controls">
              <button
                class="icon-button icon-button--subtle"
                data-action="refresh"
                aria-label="Refresh board"
                title="Refresh board"
                type="button"
              >
                ${boardRefreshIconMarkup()}
              </button>
              <button
                class="icon-button icon-button--solid"
                data-action="toggle-mode"
                aria-label="Collapse board to compact overlay"
                title="Collapse board to compact overlay"
                type="button"
              >
                ${boardCollapseIconMarkup()}
              </button>
            </div>
          </div>
        </header>

        ${activeStripMarkup(snapshot, viewModel)}

        <section class="board-grid">
          ${viewModel.visibleColumns.map(column => columnMarkup(column)).join('')}
        </section>
      </section>
    `;

  refreshLiveTimeLabels();

  root.querySelector('[data-action="toggle-mode"]')?.addEventListener('click', async () => {
    await setMode(getNextMode(mode));
  });

  root.querySelector('[data-action="expand-working-card"]')?.addEventListener('click', async () => {
    await setCompactWorkingExpanded(true);
  });

  root.querySelector('[data-action="collapse-working-card"]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await setCompactWorkingExpanded(false);
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

  root.querySelector('[data-action="refresh"]')?.addEventListener('click', async () => {
    await loadSnapshot();
  });

  root.querySelectorAll<HTMLElement>('[data-overlay-drag]').forEach(bindOverlayDragSurface);
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
  }

  mode = nextMode;
  const preset = nextMode === 'compact' && latestSnapshot
    ? getCompactSize(latestSnapshot)
    : getWindowPreset(nextMode);
  await setOverlaySize(preset.width, preset.height);

  if (latestSnapshot) {
    render(latestSnapshot);
  }
}

async function loadSnapshot(): Promise<void> {
  let snapshotText: string;
  try {
    snapshotText = await invoke<string>('load_overlay_snapshot');
  } catch {
    snapshotText = JSON.stringify(getBrowserFallbackSnapshot());
  }

  if (snapshotText === lastSnapshotText && latestSnapshot) {
    return;
  }

  lastSnapshotText = snapshotText;
  const previousSnapshot = latestSnapshot;
  latestSnapshot = JSON.parse(snapshotText) as OverlaySnapshot;

  if (latestSnapshot.attention_state !== 'normal' || !latestSnapshot.active_task) {
    compactWorkingExpanded = false;
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

async function loadControlState(): Promise<void> {
  let controlText: string | null;
  try {
    controlText = await invoke<string | null>('load_overlay_control_state');
  } catch {
    controlText = null;
  }

  if (!controlText || controlText === lastControlText) {
    return;
  }

  lastControlText = controlText;
  const controlState = JSON.parse(controlText) as OverlayControlState;
  await applyVisibility(controlState.visible);
}

async function syncOverlayRuntime(): Promise<void> {
  await Promise.all([
    loadSnapshot(),
    loadControlState(),
  ]);
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
    await installOverlayPositionPersistence();
    await restoreOverlayPosition();
    await syncOverlayRuntime();
    await setMode('compact');
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mousemove', handleOverlayDragMove, true);
    window.addEventListener('mouseup', handleOverlayDragEnd, true);
    window.addEventListener('blur', handleOverlayDragEnd);
    pollTimer = window.setInterval(() => {
      void syncOverlayRuntime();
    }, POLL_INTERVAL_MS);
    liveTimeTimer = window.setInterval(() => {
      refreshLiveTimeLabels();
    }, LIVE_TIME_REFRESH_MS);
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

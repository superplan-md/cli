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

type ResizeDirection = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

const POLL_INTERVAL_MS = 900;
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
let latestControlState: OverlayControlState | null = null;
let lastSnapshotText = '';
let lastControlText: string | null = null;
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
    const badgeModifier = isDone ? ' compact-indicator__corner-badge--done' : '';

    return `
      <section
        class="compact-indicator compact-indicator--${viewModel.attentionState}"
        aria-label="${escapeHtml(statusLabel)}"
      >
        <span class="compact-indicator__corner-badge${badgeModifier}" aria-hidden="true"></span>
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
            <span class="${eyebrowClass}">${escapeHtml(eyebrow)}</span>
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
  try {
    await invoke('persist_overlay_requested_action', {
      requestedAction: 'hide',
      updatedAt: new Date().toISOString(),
      visible: false,
    });
  } catch (error) {
    console.error('persist_overlay_requested_action failed', error);
  }

  latestControlState = {
    workspace_path: latestSnapshot?.workspace_path ?? '',
    requested_action: 'hide',
    updated_at: new Date().toISOString(),
    visible: false,
  };
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
      ? boardStatMarkup('Queued', String(viewModel.columnCounts.backlog), 'neutral')
      : '',
    viewModel.columnCounts.done > 0
      ? boardStatMarkup('Done', String(viewModel.columnCounts.done), 'done')
      : '',
    viewModel.columnCounts.blocked > 0
      ? boardStatMarkup('Blocked', String(viewModel.columnCounts.blocked), 'warning')
      : '',
  ].filter(Boolean).join('');

  if (!stripTask) {
    return `
      <section class="active-strip active-strip--empty">
        <div class="active-strip__main">
          <div class="active-strip__status">
            <span>Idle</span>
          </div>
          <div class="active-strip__copy">
            <h2>No active task</h2>
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
      <header class="board-column__header">
        <div class="board-column__heading">
          <h3>${escapeHtml(column.title)}</h3>
        </div>
        <span class="board-count-pill">${escapeHtml(String(column.count))}</span>
      </header>
      <div class="board-column__rule" aria-hidden="true"></div>
      <div class="board-stack ${column.items.length === 0 ? 'board-stack--empty' : ''}">
        ${column.items.length === 0
          ? `
            <div class="board-empty">
              <p>${escapeHtml(getEmptyColumnLabel(column.key))}</p>
            </div>
          `
          : column.items.map(item => `
              <article class="task-card task-card--${item.status}">
                <div class="task-card__topline">
                  <p class="task-card__eyebrow">${taskLeadMarkup(item)}</p>
                </div>
                <strong>${escapeHtml(item.title)}</strong>
                ${getTaskNote(item) ? `<p class="task-card__note">${escapeHtml(getTaskNote(item)!)}</p>` : ''}
                ${taskMetaMarkup(item)}
              </article>
            `).join('')}
      </div>
    </section>
  `;
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
              <h1>${escapeHtml(viewModel.workspaceLabel)}</h1>
              <p class="board-heading__meta">${escapeHtml(viewModel.updatedLabel)}</p>
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

        ${activeStripMarkup(snapshot, viewModel)}

        <section class="board-grid">
          ${viewModel.visibleColumns.map(column => columnMarkup(column)).join('')}
        </section>
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
      snapshotText = await invoke<string>('load_overlay_snapshot');
    } catch {
      snapshotText = JSON.stringify(getEmptyRuntimeSnapshot());
    }
  } else {
    snapshotText = JSON.stringify(getBrowserFallbackSnapshot());
  }

  if (snapshotText === lastSnapshotText && latestSnapshot) {
    return;
  }

  lastSnapshotText = snapshotText;
  const previousSnapshot = latestSnapshot;
  latestSnapshot = JSON.parse(snapshotText) as OverlaySnapshot;
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

async function loadControlState(): Promise<void> {
  let controlText: string | null;
  try {
    controlText = await invoke<string | null>('load_overlay_control_state');
  } catch {
    controlText = null;
  }

  if (controlText === lastControlText) {
    return;
  }

  lastControlText = controlText;
  latestControlState = controlText ? JSON.parse(controlText) as OverlayControlState : null;
}

async function syncDerivedVisibility(): Promise<void> {
  const requestedVisibility = latestControlState?.visible ?? false;
  const visible = requestedVisibility && hasRenderableSnapshotContent(latestSnapshot);

  if (lastAppliedVisibility === visible) {
    return;
  }

  lastAppliedVisibility = visible;
  if (!visible) {
    await terminateOverlayApplication();
    return;
  }

  await applyVisibility(true);
}

async function terminateOverlayApplication(): Promise<void> {
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

  await applyVisibility(false);
}

async function syncOverlayRuntime(): Promise<void> {
  await Promise.all([
    loadSnapshot(),
    loadControlState(),
  ]);
  await syncDerivedVisibility();
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

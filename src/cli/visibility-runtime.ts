import * as fs from 'fs/promises';
import * as path from 'path';
import { getTaskRef } from './task-identity';
import { resolveSuperplanRoot } from './workspace-root';

export type VisibilityEventSource = 'human' | 'agent' | 'unknown';
export type VisibilityEventOutcome = 'success' | 'error';
export type VisibilityWorkflowPhase = 'execution' | 'feedback' | 'review' | 'runtime' | 'overlay';

export interface VisibilityEventRecord {
  ts: number;
  type: string;
  task_id?: string;
  run_id?: string;
  command?: string;
  workflow_phase?: VisibilityWorkflowPhase;
  source?: VisibilityEventSource;
  outcome?: VisibilityEventOutcome;
  detail_code?: string;
  reason_code?: string;
  legacy?: boolean;
}

export interface VisibilitySessionState {
  run_id: string;
  status: 'active' | 'closed';
  started_at: string;
  last_event_at: string;
  ended_at?: string;
  route_decision: string | null;
  depth_mode: string | null;
}

export interface VisibilityTaskSnapshot {
  task_id: string;
  change_id?: string;
  task_ref?: string;
  status: string;
  is_ready?: boolean;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  reason?: string;
  message?: string;
}

export interface VisibilityDoctorIssue {
  code: string;
  message: string;
  fix?: string;
  task_id?: string;
}

export interface VisibilityDoctorSnapshot {
  valid: boolean;
  issues: VisibilityDoctorIssue[];
}

export interface VisibilityRunReport {
  run_id: string;
  status: 'active' | 'completed';
  started_at: string | null;
  ended_at: string | null;
  route_decision: string | null;
  depth_mode: string | null;
  counts: {
    task_started: number;
    task_blocked: number;
    task_feedback_requested: number;
    task_resumed: number;
    task_review_requested: number;
    task_approved: number;
    task_reopened: number;
    task_reset: number;
    task_complete_failed: number;
    overlay_ensure: number;
    overlay_hide: number;
    overlay_failed_launches: number;
  };
  metrics: {
    time_in_progress_ms: number;
    time_to_feedback_ms: number | null;
  };
  layers: {
    routing: {
      status: 'unknown';
      note: string;
    };
    task_loop: {
      status: 'idle' | 'healthy' | 'attention';
      active_task_id: string | null;
      started_count: number;
      complete_failed_count: number;
    };
    interruption_recovery: {
      status: 'idle' | 'healthy' | 'attention';
      blocked_count: number;
      resumed_count: number;
      reset_count: number;
    };
    feedback: {
      status: 'idle' | 'healthy' | 'attention';
      requested_count: number;
      outstanding: boolean;
    };
    review: {
      status: 'idle' | 'healthy' | 'attention';
      requested_count: number;
      approved_count: number;
      reopened_count: number;
    };
    runtime_integrity: {
      status: 'healthy' | 'attention';
      issue_count: number;
    };
    overlay: {
      status: 'disabled' | 'healthy' | 'attention';
      ensure_count: number;
      hide_count: number;
      failed_launch_count: number;
      last_detail_code: string | null;
    };
  };
  doctor: VisibilityDoctorSnapshot;
  assessment: string;
}

interface VisibilityPaths {
  runtime_dir: string;
  events_path: string;
  session_path: string;
  reports_dir: string;
  latest_report_path: string;
}

function pathExists(targetPath: string): Promise<boolean> {
  return fs.access(targetPath).then(() => true).catch(() => false);
}

function isVisibilityEventSource(value: unknown): value is VisibilityEventSource {
  return value === 'human' || value === 'agent' || value === 'unknown';
}

function isVisibilityEventOutcome(value: unknown): value is VisibilityEventOutcome {
  return value === 'success' || value === 'error';
}

function isVisibilityWorkflowPhase(value: unknown): value is VisibilityWorkflowPhase {
  return value === 'execution' || value === 'feedback' || value === 'review' || value === 'runtime' || value === 'overlay';
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function createRunId(timestampIso: string): string {
  const compactTimestamp = timestampIso.replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `run-${compactTimestamp}-${suffix}`;
}

function inferWorkflowPhase(type: string): VisibilityWorkflowPhase {
  if (type.startsWith('overlay.')) {
    return 'overlay';
  }

  if (type === 'task.feedback_requested' || type === 'task.blocked') {
    return 'feedback';
  }

  if (type === 'task.review_requested' || type === 'task.approved' || type === 'task.reopened') {
    return 'review';
  }

  return 'execution';
}

function inferLegacyCommand(type: string): string {
  switch (type) {
    case 'task.started':
      return 'task start';
    case 'task.blocked':
      return 'task runtime block';
    case 'task.feedback_requested':
      return 'task runtime request-feedback';
    case 'task.resumed':
      return 'task resume';
    case 'task.review_requested':
      return 'task review complete';
    case 'task.approved':
      return 'task review approve';
    case 'task.reopened':
      return 'task review reopen';
    case 'task.reset':
      return 'task repair reset';
    case 'task.complete_failed':
      return 'task review complete';
    case 'overlay.ensure':
      return 'overlay ensure';
    case 'overlay.hide':
      return 'overlay hide';
    default:
      return type;
  }
}

function getEnvironmentSource(): VisibilityEventSource {
  const source = normalizeOptionalString(process.env.SUPERPLAN_EVENT_SOURCE);
  return source === 'human' || source === 'agent' ? source : 'unknown';
}

function getRunIdSortTimestamp(runId: string, events: VisibilityEventRecord[], session: VisibilitySessionState | null): number {
  if (session?.run_id === runId) {
    const timestamp = Date.parse(session.ended_at ?? session.last_event_at ?? session.started_at);
    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return events
    .filter(event => event.run_id === runId)
    .reduce((latest, event) => Math.max(latest, event.ts), 0);
}

function getReportTaskIds(events: VisibilityEventRecord[]): Set<string> {
  return new Set(events.map(event => event.task_id).filter((taskId): taskId is string => typeof taskId === 'string'));
}

function getTaskTimestamp(task: VisibilityTaskSnapshot, key: 'started_at' | 'completed_at' | 'updated_at'): number | null {
  const value = task[key];
  if (!value) {
    return null;
  }

  const parsedTimestamp = Date.parse(value);
  return Number.isNaN(parsedTimestamp) ? null : parsedTimestamp;
}

function buildAssessment(report: VisibilityRunReport): string {
  if (report.layers.runtime_integrity.status === 'attention') {
    return 'Runtime health needs attention before the run evidence is fully trustworthy.';
  }

  if (report.layers.feedback.status === 'attention') {
    return 'The run is currently waiting on feedback or was interrupted by an explicit feedback handoff.';
  }

  if (report.layers.review.status === 'attention') {
    return 'The review loop reopened work or still needs explicit attention.';
  }

  if (report.layers.overlay.status === 'attention') {
    return 'The workflow ran, but overlay visibility or launch health degraded during the run.';
  }

  if (report.status === 'completed') {
    return 'The run completed cleanly with no open review or runtime integrity issues.';
  }

  return 'The run is active and currently has no blocking integrity or review problems.';
}

function createEmptyCounts() {
  return {
    task_started: 0,
    task_blocked: 0,
    task_feedback_requested: 0,
    task_resumed: 0,
    task_review_requested: 0,
    task_approved: 0,
    task_reopened: 0,
    task_reset: 0,
    task_complete_failed: 0,
    overlay_ensure: 0,
    overlay_hide: 0,
    overlay_failed_launches: 0,
  };
}

export function getVisibilityPaths(): VisibilityPaths {
  const runtimeDir = path.join(resolveSuperplanRoot(), 'runtime');
  const reportsDir = path.join(runtimeDir, 'reports');

  return {
    runtime_dir: runtimeDir,
    events_path: path.join(runtimeDir, 'events.ndjson'),
    session_path: path.join(runtimeDir, 'session.json'),
    reports_dir: reportsDir,
    latest_report_path: path.join(reportsDir, 'latest.json'),
  };
}

export async function readVisibilitySession(): Promise<VisibilitySessionState | null> {
  const { session_path: sessionPath } = getVisibilityPaths();

  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<VisibilitySessionState>;
    if (typeof parsed.run_id !== 'string' || (parsed.status !== 'active' && parsed.status !== 'closed')) {
      return null;
    }

    return {
      run_id: parsed.run_id,
      status: parsed.status,
      started_at: typeof parsed.started_at === 'string' ? parsed.started_at : new Date().toISOString(),
      last_event_at: typeof parsed.last_event_at === 'string' ? parsed.last_event_at : new Date().toISOString(),
      ...(typeof parsed.ended_at === 'string' ? { ended_at: parsed.ended_at } : {}),
      route_decision: normalizeOptionalString(parsed.route_decision),
      depth_mode: normalizeOptionalString(parsed.depth_mode),
    };
  } catch {
    return null;
  }
}

async function writeVisibilitySession(sessionState: VisibilitySessionState): Promise<void> {
  const { session_path: sessionPath } = getVisibilityPaths();
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(sessionPath, JSON.stringify(sessionState, null, 2), 'utf-8');
}

async function getOrCreateActiveSession(startIfMissing: boolean): Promise<VisibilitySessionState | null> {
  const existingSession = await readVisibilitySession();
  if (existingSession?.status === 'active') {
    return existingSession;
  }

  if (!startIfMissing) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const nextSession: VisibilitySessionState = {
    run_id: createRunId(timestamp),
    status: 'active',
    started_at: timestamp,
    last_event_at: timestamp,
    route_decision: normalizeOptionalString(process.env.SUPERPLAN_ROUTE_DECISION),
    depth_mode: normalizeOptionalString(process.env.SUPERPLAN_DEPTH_MODE),
  };

  await writeVisibilitySession(nextSession);
  return nextSession;
}

export async function recordVisibilityEvent(options: {
  type: string;
  taskId?: string;
  command: string;
  workflowPhase?: VisibilityWorkflowPhase;
  outcome?: VisibilityEventOutcome;
  detailCode?: string;
  reasonCode?: string;
  startRun?: boolean;
}): Promise<void> {
  const paths = getVisibilityPaths();
  const timestamp = Date.now();
  const nowIso = new Date(timestamp).toISOString();
  const session = await getOrCreateActiveSession(options.startRun !== false);

  const event: VisibilityEventRecord = {
    ts: timestamp,
    type: options.type,
    ...(options.taskId ? { task_id: options.taskId } : {}),
    ...(session ? { run_id: session.run_id } : {}),
    command: options.command,
    workflow_phase: options.workflowPhase ?? inferWorkflowPhase(options.type),
    source: getEnvironmentSource(),
    outcome: options.outcome ?? 'success',
    ...(options.detailCode ? { detail_code: options.detailCode } : {}),
    ...(options.reasonCode ? { reason_code: options.reasonCode } : {}),
  };

  await fs.mkdir(path.dirname(paths.events_path), { recursive: true });
  await fs.appendFile(paths.events_path, `${JSON.stringify(event)}\n`, 'utf-8');

  if (session) {
    await writeVisibilitySession({
      ...session,
      last_event_at: nowIso,
    });
  }
}

export async function readVisibilityEvents(): Promise<VisibilityEventRecord[]> {
  const { events_path: eventsPath } = getVisibilityPaths();

  try {
    const content = await fs.readFile(eventsPath, 'utf-8');
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .map(rawEvent => {
        const type = typeof rawEvent.type === 'string' ? rawEvent.type : 'unknown';
        const taskId = typeof rawEvent.task_id === 'string' ? rawEvent.task_id : undefined;
        const hasRunId = typeof rawEvent.run_id === 'string';

        return {
          ts: typeof rawEvent.ts === 'number' ? rawEvent.ts : Date.now(),
          type,
          ...(taskId ? { task_id: taskId } : {}),
          run_id: hasRunId ? rawEvent.run_id as string : 'legacy-history',
          command: typeof rawEvent.command === 'string' ? rawEvent.command : inferLegacyCommand(type),
          workflow_phase: isVisibilityWorkflowPhase(rawEvent.workflow_phase)
            ? rawEvent.workflow_phase
            : inferWorkflowPhase(type),
          source: isVisibilityEventSource(rawEvent.source) ? rawEvent.source : 'unknown',
          outcome: isVisibilityEventOutcome(rawEvent.outcome) ? rawEvent.outcome : 'success',
          ...(typeof rawEvent.detail_code === 'string' ? { detail_code: rawEvent.detail_code } : {}),
          ...(typeof rawEvent.reason_code === 'string' ? { reason_code: rawEvent.reason_code } : {}),
          ...(hasRunId ? {} : { legacy: true }),
        } satisfies VisibilityEventRecord;
      });
  } catch {
    return [];
  }
}

function isWorkspaceIdle(tasks: VisibilityTaskSnapshot[]): boolean {
  const hasAttentionTask = tasks.some(task =>
    task.status === 'in_progress'
    || task.status === 'blocked'
    || task.status === 'needs_feedback'
    || task.status === 'in_review',
  );

  if (hasAttentionTask) {
    return false;
  }

  return !tasks.some(task => task.is_ready);
}

export async function finalizeVisibilitySessionIfIdle(tasks: VisibilityTaskSnapshot[]): Promise<VisibilitySessionState | null> {
  const session = await readVisibilitySession();
  if (!session || session.status !== 'active') {
    return session;
  }

  if (!isWorkspaceIdle(tasks)) {
    return session;
  }

  const endedAt = new Date().toISOString();
  const closedSession: VisibilitySessionState = {
    ...session,
    status: 'closed',
    ended_at: endedAt,
    last_event_at: endedAt,
  };

  await writeVisibilitySession(closedSession);
  return closedSession;
}

function resolveTargetRunId(options: {
  explicitRunId?: string;
  session: VisibilitySessionState | null;
  events: VisibilityEventRecord[];
}): string | null {
  if (options.explicitRunId) {
    return options.explicitRunId;
  }

  if (options.session?.run_id) {
    return options.session.run_id;
  }

  const availableRunIds = [...new Set(options.events.map(event => event.run_id).filter((runId): runId is string => typeof runId === 'string'))];
  if (availableRunIds.length === 0) {
    return null;
  }

  return availableRunIds.sort((left, right) => (
    getRunIdSortTimestamp(right, options.events, options.session)
    - getRunIdSortTimestamp(left, options.events, options.session)
  ))[0] ?? null;
}

export async function buildAndWriteVisibilityReport(options: {
  tasks: VisibilityTaskSnapshot[];
  doctor: VisibilityDoctorSnapshot;
  overlayEnabled: boolean;
  runId?: string;
}): Promise<VisibilityRunReport | null> {
  const session = await finalizeVisibilitySessionIfIdle(options.tasks);
  const events = await readVisibilityEvents();
  const targetRunId = resolveTargetRunId({
    explicitRunId: options.runId,
    session,
    events,
  });

  if (!targetRunId) {
    return null;
  }

  const runEvents = events.filter(event => event.run_id === targetRunId);
  if (runEvents.length === 0 && targetRunId !== 'legacy-history') {
    return null;
  }

  const counts = createEmptyCounts();
  let lastOverlayDetailCode: string | null = null;

  for (const event of runEvents) {
    switch (event.type) {
      case 'task.started':
        counts.task_started += 1;
        break;
      case 'task.blocked':
        counts.task_blocked += 1;
        break;
      case 'task.feedback_requested':
        counts.task_feedback_requested += 1;
        break;
      case 'task.resumed':
        counts.task_resumed += 1;
        break;
      case 'task.review_requested':
        counts.task_review_requested += 1;
        break;
      case 'task.approved':
        counts.task_approved += 1;
        break;
      case 'task.reopened':
        counts.task_reopened += 1;
        break;
      case 'task.reset':
        counts.task_reset += 1;
        break;
      case 'task.complete_failed':
        counts.task_complete_failed += 1;
        break;
      case 'overlay.ensure':
        counts.overlay_ensure += 1;
        if (event.outcome === 'error') {
          counts.overlay_failed_launches += 1;
        }
        lastOverlayDetailCode = event.detail_code ?? lastOverlayDetailCode;
        break;
      case 'overlay.hide':
        counts.overlay_hide += 1;
        lastOverlayDetailCode = event.detail_code ?? lastOverlayDetailCode;
        break;
      default:
        break;
    }
  }

  const runTaskIds = getReportTaskIds(runEvents);
  const runTasks = options.tasks.filter(task => runTaskIds.size === 0 || runTaskIds.has(getTaskRef(task)));
  const startedAt = session?.run_id === targetRunId
    ? session.started_at
    : (runEvents[0] ? new Date(Math.min(...runEvents.map(event => event.ts))).toISOString() : null);
  const endedAt = session?.run_id === targetRunId && session.status === 'closed'
    ? session.ended_at ?? null
    : (
      counts.task_approved > 0 && isWorkspaceIdle(options.tasks)
        ? new Date(Math.max(...runEvents.map(event => event.ts))).toISOString()
        : null
    );

  const firstWorkEvent = runEvents.find(event =>
    event.type === 'task.started'
    || event.type === 'task.resumed'
    || event.type === 'task.reopened',
  );
  const firstFeedbackEvent = runEvents.find(event => event.type === 'task.feedback_requested');
  const timeToFeedbackMs = firstWorkEvent && firstFeedbackEvent
    ? Math.max(firstFeedbackEvent.ts - firstWorkEvent.ts, 0)
    : null;

  const timeInProgressMs = runTasks.reduce((total, task) => {
    const startedTimestamp = getTaskTimestamp(task, 'started_at');
    const endedTimestamp = getTaskTimestamp(task, 'completed_at')
      ?? getTaskTimestamp(task, 'updated_at');

    if (startedTimestamp === null || endedTimestamp === null) {
      return total;
    }

    return total + Math.max(endedTimestamp - startedTimestamp, 0);
  }, 0);

  const activeTask = runTasks.find(task => task.status === 'in_progress');
  const outstandingFeedback = runTasks.some(task => task.status === 'needs_feedback');
  const outstandingReview = runTasks.some(task => task.status === 'in_review');
  const overlayIssueCount = counts.overlay_failed_launches
    + options.doctor.issues.filter(issue => issue.code === 'OVERLAY_COMPANION_UNAVAILABLE').length;

  const report: VisibilityRunReport = {
    run_id: targetRunId,
    status: endedAt ? 'completed' : 'active',
    started_at: startedAt,
    ended_at: endedAt,
    route_decision: session?.run_id === targetRunId ? session.route_decision : null,
    depth_mode: session?.run_id === targetRunId ? session.depth_mode : null,
    counts,
    metrics: {
      time_in_progress_ms: timeInProgressMs,
      time_to_feedback_ms: timeToFeedbackMs,
    },
    layers: {
      routing: {
        status: 'unknown',
        note: 'Route and depth decisions are not yet emitted directly by the CLI runtime.',
      },
      task_loop: {
        status: counts.task_complete_failed > 0
          ? 'attention'
          : counts.task_started > 0 || counts.task_resumed > 0 || counts.task_review_requested > 0
            ? 'healthy'
            : 'idle',
        active_task_id: activeTask ? getTaskRef(activeTask) : null,
        started_count: counts.task_started,
        complete_failed_count: counts.task_complete_failed,
      },
      interruption_recovery: {
        status: counts.task_blocked > 0 || counts.task_reset > 0 ? 'attention' : counts.task_resumed > 0 ? 'healthy' : 'idle',
        blocked_count: counts.task_blocked,
        resumed_count: counts.task_resumed,
        reset_count: counts.task_reset,
      },
      feedback: {
        status: outstandingFeedback ? 'attention' : counts.task_feedback_requested > 0 ? 'healthy' : 'idle',
        requested_count: counts.task_feedback_requested,
        outstanding: outstandingFeedback,
      },
      review: {
        status: outstandingReview || counts.task_reopened > 0
          ? 'attention'
          : counts.task_review_requested > 0 || counts.task_approved > 0
            ? 'healthy'
            : 'idle',
        requested_count: counts.task_review_requested,
        approved_count: counts.task_approved,
        reopened_count: counts.task_reopened,
      },
      runtime_integrity: {
        status: options.doctor.valid ? 'healthy' : 'attention',
        issue_count: options.doctor.issues.length,
      },
      overlay: {
        status: !options.overlayEnabled
          ? 'disabled'
          : overlayIssueCount > 0
            ? 'attention'
            : 'healthy',
        ensure_count: counts.overlay_ensure,
        hide_count: counts.overlay_hide,
        failed_launch_count: counts.overlay_failed_launches,
        last_detail_code: lastOverlayDetailCode,
      },
    },
    doctor: options.doctor,
    assessment: '',
  };

  report.assessment = buildAssessment(report);

  const paths = getVisibilityPaths();
  await fs.mkdir(paths.reports_dir, { recursive: true });
  await fs.writeFile(path.join(paths.reports_dir, `${targetRunId}.json`), JSON.stringify(report, null, 2), 'utf-8');
  await fs.writeFile(paths.latest_report_path, JSON.stringify(report, null, 2), 'utf-8');

  return report;
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { loadChangeGraph } from '../graph';
import { parse } from './parse';
import { refreshOverlaySnapshot } from '../overlay-runtime';
import {
  applyRequestedOverlayAction,
  createOverlayRuntimeNotice,
  type OverlayRuntimeNotice,
  type OverlayVisibilityApplyResult,
} from '../overlay-visibility';
import { resolveSuperplanRoot } from '../workspace-root';
import type { OverlayEventKind, OverlayRequestedAction } from '../../shared/overlay';
import {
  buildTaskContract,
  getChangePaths,
  isValidChangeSlug,
  pathExists,
  type ChangePaths,
  type ScaffoldPriority,
} from './scaffold';
import { recordVisibilityEvent } from '../visibility-runtime';

interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

export interface ParsedTask {
  task_id: string;
  status: string;
  priority: 'high' | 'medium' | 'low';
  depends_on_all: string[];
  depends_on_any: string[];
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  total_acceptance_criteria: number;
  completed_acceptance_criteria: number;
  progress_percent: number;
  effective_status: 'draft' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'needs_feedback';
  is_valid: boolean;
  is_ready: boolean;
  issues: string[];
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  reason?: string;
  message?: string;
}

interface RuntimeTaskState {
  status: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  reason?: string;
  message?: string;
}

interface RuntimeState {
  tasks: Record<string, RuntimeTaskState>;
}

interface RuntimePaths {
  tasksPath: string;
  eventsPath: string;
}

interface TaskFixAction {
  task_id: string;
  action: 'reset' | 'block';
  reason?: string;
}

interface TaskBatchCreatedTask {
  task_id: string;
  ref: string | null;
  title: string;
  path: string;
}

interface TaskBatchItem {
  taskId: string;
  priority: ScaffoldPriority;
  description?: string;
  acceptanceCriteria: string[];
}

type TaskLifecycleStatus = 'in_progress' | 'in_review' | 'done' | 'blocked' | 'needs_feedback';
type TaskSelectionStatus = 'in_progress' | 'ready' | null;
type TaskActivationAction = 'start' | 'resume' | 'continue';

export type TaskErrorResult = { ok: false; error: { code: string; message: string; retryable: boolean } };
export type TaskListResult = { ok: true; data: { tasks: ParsedTask[] } } | TaskErrorResult;
export type TaskSelectionResult =
  | { ok: true; data: { task_id: string | null; status: TaskSelectionStatus; task: ParsedTask | null; reason: string } }
  | TaskErrorResult;
export type TaskActivationResult =
  | {
      ok: true;
      data: {
        task_id: string;
        status: 'in_progress';
        task: ParsedTask;
        action: TaskActivationAction;
        reason: string;
        overlay?: OverlayRuntimeNotice;
      };
    }
  | TaskErrorResult;

interface TaskCommandSuccessData {
  task?: ParsedTask | null;
  tasks?: ParsedTask[];
  created?: TaskBatchCreatedTask[];
  task_id?: string | null;
  change_id?: string;
  path?: string;
  status?: TaskLifecycleStatus | TaskSelectionStatus | string | null;
  action?: TaskActivationAction;
  reason?: string;
  reasons?: string[];
  is_ready?: boolean;
  reset?: true;
  fixed?: boolean;
  actions?: TaskFixAction[];
  overlay?: OverlayRuntimeNotice;
}

type TaskCommandResult =
  | { ok: true; data: TaskCommandSuccessData }
  | TaskErrorResult;

const TASK_SUBCOMMANDS = new Set([
  'show',
  'new',
  'batch',
  'complete',
  'approve',
  'reopen',
  'fix',
  'reset',
  'block',
  'request-feedback',
]);

const REMOVED_TASK_SUBCOMMAND_GUIDANCE: Record<string, string> = {
  current: 'Use "status" to see the active task or "run" to continue it.',
  events: 'No direct replacement in the local MVP loop.',
  list: 'Use "status" for the frontier summary or "show <task_id>" for a specific task.',
  next: 'Use "run" to choose or continue work.',
  start: 'Use "run <task_id>" instead.',
  resume: 'Use "run <task_id>" instead.',
  why: 'Use "show <task_id>" instead.',
  'why-next': 'Use "run" to choose work or "status" to inspect the frontier.',
  'submit-review': 'Use "complete" instead.',
};

function getRuntimePaths(): RuntimePaths {
  const runtimeDir = path.join(resolveSuperplanRoot(), 'runtime');
  return {
    tasksPath: path.join(runtimeDir, 'tasks.json'),
    eventsPath: path.join(runtimeDir, 'events.ndjson'),
  };
}

async function getParsedTasks(): Promise<{ tasks?: ParsedTask[]; error?: TaskErrorResult }> {
  const parseResult = await parse([], { json: true });
  if (!parseResult.ok) {
    return { error: parseResult };
  }

  return { tasks: parseResult.data.tasks };
}

async function getParsedTask(taskId: string): Promise<{ task?: ParsedTask; error?: TaskErrorResult }> {
  const parsedTasksResult = await getParsedTasks();
  if (parsedTasksResult.error) {
    return { error: parsedTasksResult.error };
  }

  const matchedTask = parsedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId);
  if (!matchedTask) {
    return {
      error: {
        ok: false,
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'Task not found',
          retryable: false,
        },
      },
    };
  }

  return { task: matchedTask };
}

async function readRuntimeState(runtimeFilePath: string): Promise<RuntimeState> {
  try {
    const content = await fs.readFile(runtimeFilePath, 'utf-8');
    const parsedContent = JSON.parse(content) as Partial<RuntimeState>;

    return {
      tasks: parsedContent.tasks ?? {},
    };
  } catch {
    return { tasks: {} };
  }
}

async function writeRuntimeState(runtimeFilePath: string, runtimeState: RuntimeState): Promise<void> {
  await fs.mkdir(path.dirname(runtimeFilePath), { recursive: true });
  await fs.writeFile(runtimeFilePath, JSON.stringify(runtimeState, null, 2), 'utf-8');
}

async function appendEvent(
  eventsPath: string,
  type:
    | 'task.started'
    | 'task.completed'
    | 'task.complete_failed'
    | 'task.review_requested'
    | 'task.approved'
    | 'task.reopened'
    | 'task.blocked'
    | 'task.feedback_requested'
    | 'task.resumed'
    | 'task.reset',
  taskId: string,
  options: {
    command?: string;
    workflowPhase?: 'execution' | 'feedback' | 'review' | 'runtime' | 'overlay';
    outcome?: 'success' | 'error';
    detailCode?: string;
    reasonCode?: string;
    startRun?: boolean;
  } = {},
): Promise<void> {
  const defaultCommand = (() => {
    switch (type) {
      case 'task.started':
        return 'task start';
      case 'task.complete_failed':
      case 'task.review_requested':
        return 'task complete';
      case 'task.approved':
        return 'task approve';
      case 'task.reopened':
        return 'task reopen';
      case 'task.blocked':
        return 'task block';
      case 'task.feedback_requested':
        return 'task request-feedback';
      case 'task.resumed':
        return 'task resume';
      case 'task.reset':
        return 'task reset';
      default:
        return type;
    }
  })();

  await recordVisibilityEvent({
    type,
    taskId,
    command: options.command ?? defaultCommand,
    ...(options.workflowPhase ? { workflowPhase: options.workflowPhase } : {}),
    ...(options.outcome ? { outcome: options.outcome } : {}),
    ...(options.detailCode ? { detailCode: options.detailCode } : {}),
    ...(options.reasonCode ? { reasonCode: options.reasonCode } : {}),
    ...(options.startRun === false ? { startRun: false } : {}),
  });
}

async function appendOverlayEvent(options: {
  command: string;
  requestedAction: OverlayRequestedAction;
  visibility: OverlayVisibilityApplyResult | null;
}): Promise<void> {
  const visibility = options.visibility;
  if (!visibility) {
    return;
  }

  const detailCode = visibility.enabled
    ? visibility.companion.reason ?? (visibility.applied_action === 'hide' ? 'hidden' : 'shown')
    : 'disabled';
  const outcome = options.requestedAction === 'hide' || !visibility.enabled || visibility.companion.launched
    ? 'success'
    : 'error';

  await recordVisibilityEvent({
    type: `overlay.${options.requestedAction}`,
    command: options.command,
    workflowPhase: 'overlay',
    outcome,
    detailCode,
    startRun: false,
  });
}

function getOverlayAlertKinds(tasks: ParsedTask[], preferredAlerts?: OverlayEventKind[]): OverlayEventKind[] {
  const alerts = [...(preferredAlerts ?? [])];

  if (tasks.length > 0 && tasks.every(task => task.status === 'done')) {
    alerts.push('all_tasks_done');
  }

  return [...new Set(alerts)];
}

async function refreshOverlayFromMergedTasks(options: {
  preferredAlerts?: OverlayEventKind[];
  requestedAction?: OverlayRequestedAction;
} = {}): Promise<OverlayVisibilityApplyResult | null> {
  const mergedTasksResult = await getMergedTasks({ skipInvariant: true });
  if (mergedTasksResult.error) {
    return null;
  }

  const { snapshot } = await refreshOverlaySnapshot(mergedTasksResult.tasks!, {
    alertKinds: getOverlayAlertKinds(mergedTasksResult.tasks!, options.preferredAlerts),
  });

  if (options.requestedAction) {
    return await applyRequestedOverlayAction(options.requestedAction, snapshot);
  }

  return null;
}

async function ensureOverlayFromMergedTasks(options: {
  command: string;
  preferredAlerts?: OverlayEventKind[];
}): Promise<OverlayRuntimeNotice | undefined> {
  const overlayVisibility = await refreshOverlayFromMergedTasks({
    preferredAlerts: options.preferredAlerts,
    requestedAction: 'ensure',
  });

  await appendOverlayEvent({
    command: options.command,
    requestedAction: 'ensure',
    visibility: overlayVisibility,
  });

  return createOverlayRuntimeNotice('ensure', overlayVisibility);
}

function getTaskInvalidError(): TaskErrorResult {
  return {
    ok: false,
    error: {
      code: 'TASK_INVALID',
      message: 'Task is invalid and cannot be executed',
      retryable: false,
    },
  };
}

export function getTaskCommandHelpMessage(options: {
  subcommand?: string;
  requiresTaskId?: boolean;
  requiredArgumentLabel?: string;
}): string {
  const { subcommand, requiresTaskId, requiredArgumentLabel } = options;

  let intro = 'Superplan task command requires a subcommand.';
  if (subcommand && !requiresTaskId) {
    intro = `Unknown task subcommand: ${subcommand}`;
  } else if (subcommand && requiresTaskId) {
    intro = `Task command "${subcommand}" requires a ${requiredArgumentLabel ?? '<task_id>'}.`;
  }

  return [
    intro,
    '',
    'Task lifecycle:',
    '  run -> complete -> approve',
    '  complete moves finished implementation into review; approve is final signoff that marks the task done.',
    '',
    'Available task commands:',
    'Task commands:',
    '  show <task_id>               Show one task and its readiness details',
    '  new <change-slug>            Scaffold one graph-declared task contract',
    '  batch <change-slug> --stdin  Scaffold multiple graph-declared task contracts from JSON stdin',
    '  complete <task_id>           Finish implementation and send the task to review',
    '  approve <task_id>            Approve an in-review task and mark it done',
    '  reopen <task_id>             Move a review or done task back into implementation',
    '  block <task_id> --reason     Pause a task because something external is blocking it',
    '  request-feedback <task_id>   Pause a task because you need user input',
    '  fix                          Repair runtime conflicts deterministically',
    '',
    'For a fast start: superplan run --json',
    'To run a specific task: superplan run <task_id> --json',
    'For tracked authoring: shape changes/<slug>/tasks.md first, validate it, then scaffold task contracts from graph-declared ids.',
    '',
    'Some recovery commands still exist but are intentionally hidden from the default help surface.',
    '',
    'Examples:',
    '  superplan task show T-001 --json',
    '  superplan task --help',
    '  superplan task new improve-task-authoring --task-id T-001 --json',
    '  printf \'{"tasks":[{"task_id":"T-001"},{"task_id":"T-002","priority":"high"}]}\' | superplan task batch improve-task-authoring --stdin --json',
    '  superplan run T-001 --json',
    '  superplan task approve T-001 --json',
    '  superplan task block T-001 --reason "Waiting on review" --json',
  ].join('\n');
}

function getInvalidTaskCommandError(options: {
  subcommand?: string;
  requiresTaskId?: boolean;
  requiredArgumentLabel?: string;
}): TaskErrorResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_TASK_COMMAND',
      message: getTaskCommandHelpMessage(options),
      retryable: true,
    },
  };
}

function getRemovedTaskCommandError(subcommand: string): TaskErrorResult {
  const guidance = REMOVED_TASK_SUBCOMMAND_GUIDANCE[subcommand];

  return {
    ok: false,
    error: {
      code: 'INVALID_TASK_COMMAND',
      message: [
        `Task command "${subcommand}" was removed for the leaner local MVP loop. ${guidance}`,
        '',
        getTaskCommandHelpMessage({}),
      ].join('\n'),
      retryable: true,
    },
  };
}

function getTaskBatchError(code: string, message: string): TaskErrorResult {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue ? normalizedValue : null;
}

function normalizeStringListField(
  value: unknown,
  itemLabel: string,
  fieldName: string,
): { values?: string[]; error?: TaskErrorResult } {
  if (value === undefined) {
    return { values: [] };
  }

  if (!Array.isArray(value)) {
    return {
      error: getTaskBatchError(
        'TASK_BATCH_INVALID_PAYLOAD',
        `${itemLabel} ${fieldName} must be an array of non-empty strings`,
      ),
    };
  }

  const values: string[] = [];

  for (const entry of value) {
    const normalizedEntry = normalizeOptionalString(entry);
    if (!normalizedEntry) {
      return {
        error: getTaskBatchError(
          'TASK_BATCH_INVALID_PAYLOAD',
          `${itemLabel} ${fieldName} must be an array of non-empty strings`,
        ),
      };
    }

    values.push(normalizedEntry);
  }

  return { values };
}

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      chunks.push(String(chunk));
    });
    process.stdin.on('end', () => {
      resolve(chunks.join(''));
    });
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

async function resolveTaskCreationTarget(changeSlug: string): Promise<{ changePaths?: ChangePaths; error?: TaskErrorResult }> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      error: {
        ok: false,
        error: {
          code: 'INVALID_CHANGE_SLUG',
          message: 'Change slug must use lowercase letters, numbers, and hyphens',
          retryable: false,
        },
      },
    };
  }

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changesRoot)) {
    return {
      error: {
        ok: false,
        error: {
          code: 'INIT_REQUIRED',
          message: 'Run superplan init before creating a task',
          retryable: true,
        },
      },
    };
  }

  if (!await pathExists(changePaths.changeRoot)) {
    return {
      error: {
        ok: false,
        error: {
          code: 'CHANGE_NOT_FOUND',
          message: 'Change not found',
          retryable: false,
        },
      },
    };
  }

  return { changePaths };
}

async function loadValidatedChangeGraph(changeSlug: string, changeRoot: string): Promise<{
  graphTasks?: Map<string, { task_id: string; title: string }>;
  error?: TaskErrorResult;
}> {
  const graphResult = await loadChangeGraph(changeRoot);

  if (!graphResult.graph || graphResult.diagnostics.length > 0) {
    return {
      error: {
        ok: false,
        error: {
          code: 'GRAPH_INVALID',
          message: 'Task graph is invalid. Run superplan validate <change-slug> --json and fix graph diagnostics before scaffolding task contracts.',
          retryable: false,
        },
      },
    };
  }

  return {
    graphTasks: new Map(graphResult.graph.tasks.map(task => [task.task_id, task])),
  };
}

function normalizeTaskBatchPayload(rawPayload: unknown): { items?: TaskBatchItem[]; error?: TaskErrorResult } {
  const rawItems = Array.isArray(rawPayload)
    ? rawPayload
    : isRecord(rawPayload) && Array.isArray(rawPayload.tasks)
      ? rawPayload.tasks
      : null;

  if (!rawItems) {
    return {
      error: getTaskBatchError(
        'TASK_BATCH_INVALID_PAYLOAD',
        'Task batch payload must be an array or an object with a "tasks" array',
      ),
    };
  }

  if (rawItems.length === 0) {
    return {
      error: getTaskBatchError(
        'TASK_BATCH_EMPTY',
        'Task batch payload must contain at least one task',
      ),
    };
  }

  const items: TaskBatchItem[] = [];
  const seenTaskIds = new Set<string>();

  for (const [index, rawItem] of rawItems.entries()) {
    const itemLabel = `Task batch item ${index + 1}`;

    if (!isRecord(rawItem)) {
      return {
        error: getTaskBatchError(
          'TASK_BATCH_INVALID_PAYLOAD',
          `${itemLabel} must be an object`,
        ),
      };
    }

    const taskId = normalizeOptionalString(rawItem.task_id);
    if (!taskId) {
      return {
        error: getTaskBatchError(
          'TASK_BATCH_TASK_ID_REQUIRED',
          `${itemLabel} task_id is required and must be a non-empty string`,
        ),
      };
    }

    if (seenTaskIds.has(taskId)) {
      return {
        error: getTaskBatchError(
          'TASK_BATCH_DUPLICATE_TASK_ID',
          `Task batch task_id "${taskId}" is duplicated`,
        ),
      };
    }
    seenTaskIds.add(taskId);

    if (rawItem.priority !== undefined && typeof rawItem.priority !== 'string') {
      return {
        error: getTaskBatchError(
          'TASK_BATCH_INVALID_PAYLOAD',
          `${itemLabel} priority must be a string when provided`,
        ),
      };
    }

    const priority = parsePriority(rawItem.priority as string | undefined);
    if (!priority) {
      return {
        error: getTaskBatchError(
          'INVALID_PRIORITY',
          `${itemLabel} priority must be one of: high, medium, low`,
        ),
      };
    }

    let description: string | undefined;
    if (rawItem.description !== undefined) {
      const normalizedDescription = normalizeOptionalString(rawItem.description);
      if (!normalizedDescription) {
        return {
          error: getTaskBatchError(
            'TASK_BATCH_INVALID_PAYLOAD',
            `${itemLabel} description must be a non-empty string when provided`,
          ),
        };
      }

      description = normalizedDescription;
    }

    const acceptanceCriteriaResult = normalizeStringListField(
      rawItem.acceptance_criteria,
      itemLabel,
      'acceptance_criteria',
    );
    if (acceptanceCriteriaResult.error) {
      return acceptanceCriteriaResult;
    }

    items.push({
      taskId,
      priority,
      ...(description ? { description } : {}),
      acceptanceCriteria: acceptanceCriteriaResult.values!,
    });
  }

  return { items };
}

function parsePriority(rawPriority: string | undefined): ScaffoldPriority | null {
  if (rawPriority === undefined) {
    return 'medium';
  }

  if (rawPriority === 'high' || rawPriority === 'medium' || rawPriority === 'low') {
    return rawPriority;
  }

  return null;
}

function getInvariantError(runtimeState: RuntimeState): TaskErrorResult | undefined {
  const inProgressTasks = Object.values(runtimeState.tasks).filter(taskState => taskState.status === 'in_progress');
  if (inProgressTasks.length > 1) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STATE_MULTIPLE_IN_PROGRESS',
        message: 'Multiple tasks are in progress',
        retryable: false,
      },
    };
  }
}

function getInProgressTaskEntries(runtimeState: RuntimeState): [string, RuntimeTaskState][] {
  return Object.entries(runtimeState.tasks).filter(([, taskState]) => taskState.status === 'in_progress');
}

function getOtherActiveTaskEntry(runtimeState: RuntimeState, taskId: string): [string, RuntimeTaskState] | undefined {
  return getInProgressTaskEntries(runtimeState).find(([activeTaskId]) => activeTaskId !== taskId);
}

function getDependencyState(tasks: ParsedTask[], task: ParsedTask): {
  allDependenciesSatisfied: boolean;
  anyDependenciesSatisfied: boolean;
} {
  const doneTaskIds = new Set(
    tasks
      .filter(taskItem => taskItem.status === 'done')
      .map(taskItem => taskItem.task_id),
  );

  return {
    allDependenciesSatisfied: task.depends_on_all.every(dependsOnTaskId => doneTaskIds.has(dependsOnTaskId)),
    anyDependenciesSatisfied: task.depends_on_any.length === 0
      ? true
      : task.depends_on_any.some(dependsOnTaskId => doneTaskIds.has(dependsOnTaskId)),
  };
}

function getPriorityRank(priority: ParsedTask['priority']): number {
  if (priority === 'high') {
    return 0;
  }

  if (priority === 'medium') {
    return 1;
  }

  return 2;
}

export function sortTasksByPriorityAndId(left: ParsedTask, right: ParsedTask): number {
  const priorityDifference = getPriorityRank(left.priority) - getPriorityRank(right.priority);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return left.task_id.localeCompare(right.task_id);
}

function getStartedAtTimestamp(taskState: RuntimeTaskState): number {
  if (!taskState.started_at) {
    return 0;
  }

  const parsedTimestamp = Date.parse(taskState.started_at);
  return Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp;
}

function applyRuntimeState(task: ParsedTask, runtimeState?: RuntimeTaskState): ParsedTask {
  const runtimeMetadata = runtimeState
    ? {
        ...(runtimeState.started_at ? { started_at: runtimeState.started_at } : {}),
        ...(runtimeState.completed_at ? { completed_at: runtimeState.completed_at } : {}),
        ...(runtimeState.updated_at ? { updated_at: runtimeState.updated_at } : {}),
        ...(runtimeState.reason ? { reason: runtimeState.reason } : {}),
        ...(runtimeState.message ? { message: runtimeState.message } : {}),
      }
    : {};

  if (runtimeState?.status === 'in_progress') {
    return {
      ...task,
      ...runtimeMetadata,
      status: 'in_progress',
      effective_status: 'in_progress',
    };
  }

  if (runtimeState?.status === 'done') {
    return {
      ...task,
      ...runtimeMetadata,
      status: 'done',
      effective_status: 'done',
    };
  }

  if (runtimeState?.status === 'in_review') {
    return {
      ...task,
      ...runtimeMetadata,
      status: 'in_review',
      effective_status: 'in_review',
    };
  }

  if (runtimeState?.status === 'blocked') {
    return {
      ...task,
      ...runtimeMetadata,
      status: 'blocked',
      effective_status: 'blocked',
    };
  }

  if (runtimeState?.status === 'needs_feedback') {
    return {
      ...task,
      ...runtimeMetadata,
      status: 'needs_feedback',
      effective_status: 'needs_feedback',
    };
  }

  if (runtimeState) {
    return {
      ...task,
      ...runtimeMetadata,
      status: runtimeState.status,
    };
  }

  return {
    ...task,
    status: task.effective_status,
  };
}

function mergeTasksWithRuntimeState(parsedTasks: ParsedTask[], runtimeState: RuntimeState): ParsedTask[] {
  const tasksWithRuntimeState = parsedTasks.map(taskItem => applyRuntimeState(taskItem, runtimeState.tasks[taskItem.task_id]));
  return computeMergedTaskReadiness(tasksWithRuntimeState);
}

function computeMergedTaskReadiness(tasks: ParsedTask[]): ParsedTask[] {
  return tasks.map(task => {
    const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(tasks, task);

    return {
      ...task,
      is_ready:
        task.is_valid &&
        task.status !== 'done' &&
        task.status !== 'in_progress' &&
        task.status !== 'in_review' &&
        task.status !== 'blocked' &&
        task.status !== 'needs_feedback' &&
        allDependenciesSatisfied &&
        anyDependenciesSatisfied,
    };
  });
}

export async function loadTasks(options?: { skipInvariant?: boolean }): Promise<TaskListResult> {
  const mergedTasksResult = await getMergedTasks(options);
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  return {
    ok: true,
    data: {
      tasks: mergedTasksResult.tasks!,
    },
  };
}

async function getMergedTasks(options?: { skipInvariant?: boolean }): Promise<{
  tasks?: ParsedTask[];
  runtimeState?: RuntimeState;
  error?: TaskErrorResult;
}> {
  const parsedTasksResult = await getParsedTasks();
  if (parsedTasksResult.error) {
    return { error: parsedTasksResult.error };
  }

  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (!options?.skipInvariant && invariantError) {
    return { error: invariantError };
  }

  const tasks = mergeTasksWithRuntimeState(parsedTasksResult.tasks!, runtimeState);

  return {
    tasks,
    runtimeState,
  };
}

function getActiveTask(tasks: ParsedTask[]): { task?: ParsedTask } {
  const activeTasks = tasks.filter(taskItem => taskItem.status === 'in_progress');

  return { task: activeTasks[0] };
}

function getNextReadyTask(tasks: ParsedTask[]): ParsedTask | undefined {
  return tasks
    .filter(taskItem => taskItem.is_ready)
    .sort(sortTasksByPriorityAndId)[0];
}

function buildTaskSelectionResult(task: ParsedTask | undefined, status: TaskSelectionStatus, reason: string): TaskSelectionResult {
  return {
    ok: true,
    data: {
      task_id: task?.task_id ?? null,
      status,
      task: task ?? null,
      reason,
    },
  };
}

function buildRuntimeTaskSnapshot(task: ParsedTask, runtimeTaskState: RuntimeTaskState): ParsedTask {
  return {
    ...applyRuntimeState(task, runtimeTaskState),
    is_ready: false,
  };
}

function buildTaskReasons(task: ParsedTask, tasks: ParsedTask[], runtimeState: RuntimeState): string[] {
  const reasons = new Set<string>(task.issues);
  const invariantError = getInvariantError(runtimeState);
  const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(tasks, task);

  if (invariantError) {
    reasons.add(invariantError.error.code);
  }

  if (task.status === 'done') {
    reasons.add('TASK_ALREADY_COMPLETED');
  }

  if (task.status === 'in_progress') {
    reasons.add('TASK_ALREADY_IN_PROGRESS');
  }

  if (task.status === 'blocked') {
    reasons.add('TASK_BLOCKED');
  }

  if (task.status === 'in_review') {
    reasons.add('TASK_IN_REVIEW');
  }

  if (task.status === 'needs_feedback') {
    reasons.add('TASK_NEEDS_FEEDBACK');
  }

  if (!allDependenciesSatisfied) {
    reasons.add('DEPENDS_ON_ALL_UNMET');
  }

  if (!anyDependenciesSatisfied) {
    reasons.add('DEPENDS_ON_ANY_UNMET');
  }

  if (getOtherActiveTaskEntry(runtimeState, task.task_id)) {
    reasons.add('ANOTHER_TASK_IN_PROGRESS');
  }

  return [...reasons];
}

export async function selectNextTask(): Promise<TaskSelectionResult> {
  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const activeTaskResult = getActiveTask(mergedTasksResult.tasks!);

  if (activeTaskResult.task) {
    return buildTaskSelectionResult(activeTaskResult.task, 'in_progress', 'Task is currently in progress');
  }

  const nextReadyTask = getNextReadyTask(mergedTasksResult.tasks!);

  if (nextReadyTask) {
    return buildTaskSelectionResult(nextReadyTask, 'ready', 'Highest priority among ready tasks');
  }

  return buildTaskSelectionResult(undefined, null, 'No ready tasks available');
}

async function fixTasks(command = 'task fix'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const parsedTasksResult = await getParsedTasks();
  if (parsedTasksResult.error) {
    return parsedTasksResult.error;
  }

  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const actions: TaskFixAction[] = [];
  const inProgressEntries = getInProgressTaskEntries(runtimeState);

  if (inProgressEntries.length > 1) {
    const sortedInProgressEntries = [...inProgressEntries].sort((left, right) => {
      const timestampDifference = getStartedAtTimestamp(right[1]) - getStartedAtTimestamp(left[1]);
      if (timestampDifference !== 0) {
        return timestampDifference;
      }

      return left[0].localeCompare(right[0]);
    });

    const [keptTaskId] = sortedInProgressEntries[0];
    for (const [taskId] of sortedInProgressEntries) {
      if (taskId === keptTaskId) {
        continue;
      }

      delete runtimeState.tasks[taskId];
      actions.push({
        task_id: taskId,
        action: 'reset',
      });
      await appendEvent(runtimePaths.eventsPath, 'task.reset', taskId, { command });
    }
  }

  const mergedTasks = mergeTasksWithRuntimeState(parsedTasksResult.tasks!, runtimeState);
  const activeTaskEntry = getInProgressTaskEntries(runtimeState)[0];

  if (activeTaskEntry) {
    const [taskId, taskState] = activeTaskEntry;
    const matchedTask = mergedTasks.find(taskItem => taskItem.task_id === taskId);

    if (!matchedTask || !matchedTask.is_valid) {
      runtimeState.tasks[taskId] = {
        ...taskState,
        status: 'blocked',
        reason: 'Task became invalid',
        updated_at: new Date().toISOString(),
      };
      actions.push({
        task_id: taskId,
        action: 'block',
        reason: 'Task became invalid',
      });
      await appendEvent(runtimePaths.eventsPath, 'task.blocked', taskId, { command, workflowPhase: 'runtime', reasonCode: 'Task became invalid' });
    } else {
      const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(mergedTasks, matchedTask);
      if (!allDependenciesSatisfied || !anyDependenciesSatisfied) {
        runtimeState.tasks[taskId] = {
          ...taskState,
          status: 'blocked',
          reason: 'Dependency not satisfied',
          updated_at: new Date().toISOString(),
        };
        actions.push({
          task_id: taskId,
          action: 'block',
          reason: 'Dependency not satisfied',
        });
        await appendEvent(runtimePaths.eventsPath, 'task.blocked', taskId, { command, workflowPhase: 'runtime', reasonCode: 'Dependency not satisfied' });
      }
    }
  }

  if (actions.length > 0) {
    await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
    const overlay = await ensureOverlayFromMergedTasks({ command });

    return {
      ok: true,
      data: {
        fixed: true,
        actions,
        ...(overlay ? { overlay } : {}),
      },
    };
  }

  return {
    ok: true,
    data: {
      fixed: false,
      actions,
    },
  };
}

async function showTask(taskId: string): Promise<TaskCommandResult> {
  const mergedTasksResult = await getMergedTasks({ skipInvariant: true });
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }
  const matchedTask = mergedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId);
  if (!matchedTask) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
        retryable: false,
      },
    };
  }

  const reasons = buildTaskReasons(matchedTask, mergedTasksResult.tasks!, mergedTasksResult.runtimeState!);

  return {
    ok: true,
    data: {
      task: matchedTask,
      reasons,
    },
  };
}

function getActivatedTaskFromResult(
  result: Extract<TaskCommandResult, { ok: true }>,
  fallbackTask: ParsedTask,
): { task: ParsedTask; overlay?: OverlayRuntimeNotice } {
  const task = 'task' in result.data && result.data.task
    ? result.data.task
    : fallbackTask;
  const overlay = 'overlay' in result.data && result.data.overlay
    ? result.data.overlay
    : undefined;

  return { task, overlay };
}

async function startTask(taskId: string, command = 'task start'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    return invariantError;
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }

  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const existingTaskState = runtimeState.tasks[taskId];
  const activeTaskEntry = getOtherActiveTaskEntry(runtimeState, taskId);
  const matchedTask = mergedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId) ?? parsedTask.task!;

  if (existingTaskState?.status === 'done') {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_COMPLETED',
        message: 'Task is already completed',
        retryable: false,
      },
    };
  }

  if (existingTaskState?.status === 'in_progress') {
    return {
      ok: true,
      data: {
        task_id: taskId,
        status: 'in_progress',
        task: matchedTask,
      },
    };
  }

  if (existingTaskState?.status === 'blocked' || existingTaskState?.status === 'needs_feedback') {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_READY',
        message: 'Task is not ready',
        retryable: false,
      },
    };
  }

  if (activeTaskEntry) {
    return {
      ok: false,
      error: {
        code: 'ANOTHER_TASK_IN_PROGRESS',
        message: 'Another task is already in progress',
        retryable: true,
      },
    };
  }

  if (!matchedTask.is_ready) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_READY',
        message: 'Task is not ready',
        retryable: false,
      },
    };
  }

  const timestamp = new Date().toISOString();
  runtimeState.tasks[taskId] = {
    status: 'in_progress',
    started_at: timestamp,
    updated_at: timestamp,
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.started', taskId, { command });
  const overlayVisibility = await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });
  await appendOverlayEvent({
    command,
    requestedAction: 'ensure',
    visibility: overlayVisibility,
  });
  const overlay = createOverlayRuntimeNotice('ensure', overlayVisibility);

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
      task: buildRuntimeTaskSnapshot(matchedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function resumeTask(taskId: string, command = 'task resume'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    return invariantError;
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }

  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const existingTaskState = runtimeState.tasks[taskId];
  const activeTaskEntry = getOtherActiveTaskEntry(runtimeState, taskId);
  const matchedTask = mergedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId) ?? parsedTask.task!;
  const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(mergedTasksResult.tasks!, matchedTask);

  if (existingTaskState?.status === 'done') {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_COMPLETED',
        message: 'Task is already completed',
        retryable: false,
      },
    };
  }

  if (existingTaskState?.status === 'in_progress') {
    return {
      ok: true,
      data: {
        task_id: taskId,
        status: 'in_progress',
        task: matchedTask,
      },
    };
  }

  if (existingTaskState?.status !== 'blocked' && existingTaskState?.status !== 'needs_feedback') {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_PAUSED',
        message: 'Task is not blocked or awaiting feedback',
        retryable: false,
      },
    };
  }

  if (!matchedTask.is_valid) {
    return getTaskInvalidError();
  }

  if (activeTaskEntry) {
    return {
      ok: false,
      error: {
        code: 'ANOTHER_TASK_IN_PROGRESS',
        message: 'Another task is already in progress',
        retryable: true,
      },
    };
  }

  if (!allDependenciesSatisfied || !anyDependenciesSatisfied) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_READY',
        message: 'Task is not ready',
        retryable: false,
      },
    };
  }

  const timestamp = new Date().toISOString();
  runtimeState.tasks[taskId] = {
    ...existingTaskState,
    status: 'in_progress',
    started_at: existingTaskState.started_at ?? timestamp,
    updated_at: timestamp,
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.resumed', taskId, { command });
  const overlayVisibility = await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });
  await appendOverlayEvent({
    command,
    requestedAction: 'ensure',
    visibility: overlayVisibility,
  });
  const overlay = createOverlayRuntimeNotice('ensure', overlayVisibility);

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
      task: buildRuntimeTaskSnapshot(matchedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

export async function activateTask(taskId: string, command = 'run'): Promise<TaskActivationResult> {
  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const matchedTask = mergedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId);
  if (!matchedTask) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
        retryable: false,
      },
    };
  }

  if (matchedTask.status === 'in_progress') {
    const overlayVisibility = await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });
    await appendOverlayEvent({
      command,
      requestedAction: 'ensure',
      visibility: overlayVisibility,
    });
    const overlay = createOverlayRuntimeNotice('ensure', overlayVisibility);

    return {
      ok: true,
      data: {
        task_id: taskId,
        status: 'in_progress',
        task: matchedTask,
        action: 'continue',
        reason: 'Task is already in progress',
        ...(overlay ? { overlay } : {}),
      },
    };
  }

  if (matchedTask.status === 'blocked' || matchedTask.status === 'needs_feedback') {
    const resumeTaskResult = await resumeTask(taskId, command);
    if (!resumeTaskResult.ok) {
      return resumeTaskResult;
    }

    const { task, overlay } = getActivatedTaskFromResult(resumeTaskResult, matchedTask);

    return {
      ok: true,
      data: {
        task_id: taskId,
        status: 'in_progress',
        task,
        action: 'resume',
        reason: 'Task was resumed explicitly',
        ...(overlay ? { overlay } : {}),
      },
    };
  }

  if (matchedTask.status === 'in_review') {
    return {
      ok: false,
      error: {
        code: 'TASK_IN_REVIEW',
        message: 'Task is in review. Use "task reopen <task_id>" to continue implementation.',
        retryable: false,
      },
    };
  }

  if (matchedTask.status === 'done') {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_COMPLETED',
        message: 'Task is already completed. Use "task reopen <task_id>" to work on it again.',
        retryable: false,
      },
    };
  }

  const startTaskResult = await startTask(taskId, command);
  if (!startTaskResult.ok) {
    return startTaskResult;
  }

  const { task, overlay } = getActivatedTaskFromResult(startTaskResult, matchedTask);

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
      task,
      action: 'start',
      reason: 'Task was started explicitly',
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function completeTask(taskId: string, command = 'task complete'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId, { command, outcome: 'error', workflowPhase: 'review', detailCode: invariantError.error.code });
    return invariantError;
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId, { command, outcome: 'error', workflowPhase: 'review', detailCode: parsedTask.error.error.code });
    return parsedTask.error;
  }

  const matchedTask = parsedTask.task!;
  if (!matchedTask.is_valid) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId, { command, outcome: 'error', workflowPhase: 'review', detailCode: 'TASK_INVALID' });
    return getTaskInvalidError();
  }

  const existingTaskState = runtimeState.tasks[taskId];

  if (existingTaskState?.status === 'in_review') {
    return {
      ok: true,
      data: {
        task_id: taskId,
        status: 'in_review',
        task: buildRuntimeTaskSnapshot(matchedTask, existingTaskState),
      },
    };
  }

  if (existingTaskState?.status !== 'in_progress') {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId, { command, outcome: 'error', workflowPhase: 'review', detailCode: 'TASK_NOT_STARTED' });
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_STARTED',
        message: 'Task has not been started',
        retryable: false,
      },
    };
  }

  if (matchedTask.completed_acceptance_criteria !== matchedTask.total_acceptance_criteria) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId, { command, outcome: 'error', workflowPhase: 'review', detailCode: 'TASK_NOT_COMPLETE' });
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_COMPLETE',
        message: 'Task is not complete',
        retryable: false,
      },
    };
  }

  const timestamp = new Date().toISOString();
  runtimeState.tasks[taskId] = {
    ...existingTaskState,
    status: 'in_review',
    updated_at: timestamp,
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.review_requested', taskId, { command, workflowPhase: 'review' });
  const overlay = await ensureOverlayFromMergedTasks({ command });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_review',
      task: buildRuntimeTaskSnapshot(matchedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function approveTask(taskId: string, command = 'task approve'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }

  const matchedTask = parsedTask.task!;
  if (!matchedTask.is_valid) {
    return getTaskInvalidError();
  }

  if (runtimeState.tasks[taskId]?.status !== 'in_review') {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_IN_REVIEW',
        message: 'Task is not in review',
        retryable: false,
      },
    };
  }

  if (matchedTask.completed_acceptance_criteria !== matchedTask.total_acceptance_criteria) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_COMPLETE',
        message: 'Task is not complete',
        retryable: false,
      },
    };
  }

  const timestamp = new Date().toISOString();
  runtimeState.tasks[taskId] = {
    ...runtimeState.tasks[taskId],
    status: 'done',
    completed_at: timestamp,
    updated_at: timestamp,
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.approved', taskId, { command, workflowPhase: 'review' });
  const overlay = await ensureOverlayFromMergedTasks({ command });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'done',
      task: buildRuntimeTaskSnapshot(matchedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function blockTask(taskId: string, reason?: string, command = 'task block'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    return invariantError;
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }
  const matchedTask = parsedTask.task!;

  if (runtimeState.tasks[taskId]?.status !== 'in_progress') {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_IN_PROGRESS',
        message: 'Task is not in progress',
        retryable: false,
      },
    };
  }

  runtimeState.tasks[taskId] = {
    ...runtimeState.tasks[taskId],
    status: 'blocked',
    reason,
    updated_at: new Date().toISOString(),
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.blocked', taskId, {
    command,
    workflowPhase: 'feedback',
    ...(reason ? { reasonCode: reason } : {}),
  });
  const overlay = await ensureOverlayFromMergedTasks({ command });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'blocked',
      task: buildRuntimeTaskSnapshot(matchedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function requestFeedbackTask(taskId: string, message?: string, command = 'task request-feedback'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    return invariantError;
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }
  const matchedTask = parsedTask.task!;

  if (runtimeState.tasks[taskId]?.status !== 'in_progress') {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_IN_PROGRESS',
        message: 'Task is not in progress',
        retryable: false,
      },
    };
  }

  runtimeState.tasks[taskId] = {
    ...runtimeState.tasks[taskId],
    status: 'needs_feedback',
    message,
    updated_at: new Date().toISOString(),
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.feedback_requested', taskId, {
    command,
    workflowPhase: 'feedback',
    ...(message ? { reasonCode: message } : {}),
  });
  const overlay = await ensureOverlayFromMergedTasks({
    command,
    preferredAlerts: ['needs_feedback'],
  });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'needs_feedback',
      task: buildRuntimeTaskSnapshot(matchedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function reopenTask(taskId: string, reason?: string, command = 'task reopen'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }

  const existingTaskState = runtimeState.tasks[taskId];
  if (existingTaskState?.status !== 'in_review' && existingTaskState?.status !== 'done') {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_REVIEWABLE',
        message: 'Task is not in review or done',
        retryable: false,
      },
    };
  }

  const matchedTask = parsedTask.task!;
  if (!matchedTask.is_valid) {
    return getTaskInvalidError();
  }

  const activeTaskEntry = getOtherActiveTaskEntry(runtimeState, taskId);
  if (activeTaskEntry) {
    return {
      ok: false,
      error: {
        code: 'ANOTHER_TASK_IN_PROGRESS',
        message: 'Another task is already in progress',
        retryable: true,
      },
    };
  }

  const mergedTasksResult = await getMergedTasks({ skipInvariant: true });
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const mergedTask = mergedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId) ?? matchedTask;
  const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(mergedTasksResult.tasks!, mergedTask);
  if (!allDependenciesSatisfied || !anyDependenciesSatisfied) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_READY',
        message: 'Task is not ready',
        retryable: false,
      },
    };
  }

  const timestamp = new Date().toISOString();
  runtimeState.tasks[taskId] = {
    status: 'in_progress',
    started_at: existingTaskState.started_at ?? timestamp,
    updated_at: timestamp,
    ...(reason ? { reason } : {}),
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.reopened', taskId, {
    command,
    workflowPhase: 'review',
    ...(reason ? { reasonCode: reason } : {}),
  });
  const overlayVisibility = await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });
  await appendOverlayEvent({
    command,
    requestedAction: 'ensure',
    visibility: overlayVisibility,
  });
  const overlay = createOverlayRuntimeNotice('ensure', overlayVisibility);

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
      task: buildRuntimeTaskSnapshot(mergedTask, runtimeState.tasks[taskId]),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function resetTask(taskId: string, command = 'task reset'): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const parsedTasksResult = await getParsedTasks();
  if (parsedTasksResult.error) {
    return parsedTasksResult.error;
  }

  const hasParsedTask = parsedTasksResult.tasks!.some(taskItem => taskItem.task_id === taskId);
  const hasRuntimeTask = taskId in runtimeState.tasks;

  if (!hasParsedTask && !hasRuntimeTask) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
        retryable: false,
      },
    };
  }

  delete runtimeState.tasks[taskId];

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.reset', taskId, { command, workflowPhase: 'runtime' });
  const overlay = await ensureOverlayFromMergedTasks({ command });

  return {
    ok: true,
    data: {
      task_id: taskId,
      reset: true,
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function createTask(changeSlug: string, taskId: string | undefined, rawPriority?: string): Promise<TaskCommandResult> {
  const priority = parsePriority(rawPriority);
  if (!priority) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PRIORITY',
        message: 'Priority must be one of: high, medium, low',
        retryable: false,
      },
    };
  }

  const taskCreationTarget = await resolveTaskCreationTarget(changeSlug);
  if (taskCreationTarget.error) {
    return taskCreationTarget.error;
  }

  const changePaths = taskCreationTarget.changePaths!;
  const graphResult = await loadValidatedChangeGraph(changeSlug, changePaths.changeRoot);
  if (graphResult.error) {
    return graphResult.error;
  }

  if (!taskId) {
    return {
      ok: false,
      error: {
        code: 'TASK_ID_REQUIRED',
        message: 'Task scaffolding requires --task-id <task_id> so the task contract matches a graph-declared entry.',
        retryable: false,
      },
    };
  }

  const graphTask = graphResult.graphTasks!.get(taskId);
  if (!graphTask) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_IN_GRAPH',
        message: `Task ${taskId} is not declared in ${path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath}.`,
        retryable: false,
      },
    };
  }

  await fs.mkdir(changePaths.tasksDir, { recursive: true });
  const taskPath = path.join(changePaths.tasksDir, `${taskId}.md`);
  if (await pathExists(taskPath)) {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_SCAFFOLDED',
        message: `Task contract already exists for ${taskId}.`,
        retryable: false,
      },
    };
  }

  await fs.writeFile(taskPath, buildTaskContract({
    taskId,
    changeId: changeSlug,
    title: graphTask.title,
    priority,
    description: graphTask.title,
  }), 'utf-8');
  const overlayVisibility = await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });
  await appendOverlayEvent({
    command: 'task new',
    requestedAction: 'ensure',
    visibility: overlayVisibility,
  });
  const overlay = createOverlayRuntimeNotice('ensure', overlayVisibility);
  const createdTaskResult = await getParsedTask(taskId);

  return {
    ok: true,
    data: {
      task_id: taskId,
      change_id: changeSlug,
      path: path.relative(process.cwd(), taskPath) || taskPath,
      ...(createdTaskResult.task ? { task: createdTaskResult.task } : {}),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function createTaskBatch(options: {
  changeSlug: string;
  batchFilePath?: string;
  useStdin?: boolean;
}): Promise<TaskCommandResult> {
  const { changeSlug, batchFilePath, useStdin } = options;
  const taskCreationTarget = await resolveTaskCreationTarget(changeSlug);
  if (taskCreationTarget.error) {
    return taskCreationTarget.error;
  }

  const changePaths = taskCreationTarget.changePaths!;

  let rawPayload: unknown;
  try {
    let batchContent = '';

    if (useStdin) {
      batchContent = await readStdin();
      if (!batchContent.trim()) {
        return getTaskBatchError(
          'TASK_BATCH_STDIN_EMPTY',
          'Task batch stdin payload was empty',
        );
      }
    } else if (batchFilePath) {
      const resolvedBatchFilePath = path.resolve(process.cwd(), batchFilePath);
      batchContent = await fs.readFile(resolvedBatchFilePath, 'utf-8');
    } else {
      return getTaskBatchError(
        'TASK_BATCH_INPUT_REQUIRED',
        'Task batch requires JSON input via --stdin (preferred) or --file <path>',
      );
    }

    rawPayload = JSON.parse(batchContent);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const inputLabel = useStdin
        ? 'stdin'
        : batchFilePath
          ? path.relative(process.cwd(), path.resolve(process.cwd(), batchFilePath)) || path.resolve(process.cwd(), batchFilePath)
          : 'batch input';
      return getTaskBatchError(
        'TASK_BATCH_INVALID_JSON',
        `Task batch input is not valid JSON: ${inputLabel}`,
      );
    }

    if (!useStdin && batchFilePath) {
      const resolvedBatchFilePath = path.resolve(process.cwd(), batchFilePath);
      const batchFileLabel = path.relative(process.cwd(), resolvedBatchFilePath) || resolvedBatchFilePath;
      return getTaskBatchError(
        'TASK_BATCH_FILE_READ_FAILED',
        `Could not read task batch file: ${batchFileLabel}`,
      );
    }

    return getTaskBatchError(
      'TASK_BATCH_STDIN_READ_FAILED',
      'Could not read task batch stdin payload',
    );
  }

  return await createTaskBatchFromPayload(changeSlug, changePaths, rawPayload);
}

async function createTaskBatchFromPayload(
  changeSlug: string,
  changePaths: ChangePaths,
  rawPayload: unknown,
): Promise<TaskCommandResult> {
  const normalizedBatch = normalizeTaskBatchPayload(rawPayload);
  if (normalizedBatch.error) {
    return normalizedBatch.error;
  }

  const graphResult = await loadValidatedChangeGraph(changeSlug, changePaths.changeRoot);
  if (graphResult.error) {
    return graphResult.error;
  }

  await fs.mkdir(changePaths.tasksDir, { recursive: true });

  const created: TaskBatchCreatedTask[] = [];

  for (const item of normalizedBatch.items!) {
    const taskId = item.taskId;
    const graphTask = graphResult.graphTasks!.get(taskId);
    if (!graphTask) {
      return {
        ok: false,
        error: {
          code: 'TASK_NOT_IN_GRAPH',
          message: `Task ${taskId} is not declared in ${path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath}.`,
          retryable: false,
        },
      };
    }

    const taskPath = path.join(changePaths.tasksDir, `${taskId}.md`);
    if (await pathExists(taskPath)) {
      return {
        ok: false,
        error: {
          code: 'TASK_ALREADY_SCAFFOLDED',
          message: `Task contract already exists for ${taskId}.`,
          retryable: false,
        },
      };
    }

    await fs.writeFile(taskPath, buildTaskContract({
      taskId,
      changeId: changeSlug,
      title: graphTask.title,
      priority: item.priority,
      description: item.description ?? graphTask.title,
      acceptanceCriteria: item.acceptanceCriteria,
    }), 'utf-8');

    created.push({
      task_id: taskId,
      ref: null,
      title: graphTask.title,
      path: path.relative(process.cwd(), taskPath) || taskPath,
    });
  }

  const parsedTasksResult = await getParsedTasks();
  const createdTasks = parsedTasksResult.tasks
    ? normalizedBatch.items!.map(item => item.taskId)
      .map(taskId => parsedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId))
      .filter((taskItem): taskItem is ParsedTask => Boolean(taskItem))
    : [];
  const overlayVisibility = await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });
  await appendOverlayEvent({
    command: 'task batch',
    requestedAction: 'ensure',
    visibility: overlayVisibility,
  });
  const overlay = createOverlayRuntimeNotice('ensure', overlayVisibility);

  return {
    ok: true,
    data: {
      change_id: changeSlug,
      created,
      tasks: createdTasks,
      ...(overlay ? { overlay } : {}),
    },
  };
}

function getOptionValue(args: string[], optionName: string): string | undefined {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }

  const optionValue = args[optionIndex + 1];
  if (!optionValue || optionValue.startsWith('--')) {
    return undefined;
  }

  return optionValue;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getPositionalArgs(args: string[]): string[] {
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json' || arg === '--quiet' || arg === '--stdin') {
      continue;
    }

    if (arg === '--reason' || arg === '--message' || arg === '--title' || arg === '--priority' || arg === '--file' || arg === '--task-id') {
      index += 1;
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

export async function task(args: string[]): Promise<TaskCommandResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0];
  const subjectId = positionalArgs[1];
  const reason = getOptionValue(args, '--reason');
  const message = getOptionValue(args, '--message');
  const priority = getOptionValue(args, '--priority');
  const filePath = getOptionValue(args, '--file');
  const taskIdOption = getOptionValue(args, '--task-id');
  const useStdin = hasFlag(args, '--stdin');

  if (!subcommand) {
    return getInvalidTaskCommandError({ subcommand });
  }

  if (Object.prototype.hasOwnProperty.call(REMOVED_TASK_SUBCOMMAND_GUIDANCE, subcommand)) {
    return getRemovedTaskCommandError(subcommand);
  }

  if (!TASK_SUBCOMMANDS.has(subcommand)) {
    return getInvalidTaskCommandError({ subcommand });
  }

  if (subcommand === 'show') {
    if (!subjectId) {
      return getInvalidTaskCommandError({
        subcommand,
        requiresTaskId: true,
      });
    }

    return showTask(subjectId);
  }

  if (subcommand === 'new') {
    if (!subjectId) {
      return getInvalidTaskCommandError({
        subcommand,
        requiresTaskId: true,
        requiredArgumentLabel: '<change-slug>',
      });
    }

    return createTask(subjectId, taskIdOption, priority);
  }

  if (subcommand === 'batch') {
    if (!subjectId) {
      return getInvalidTaskCommandError({
        subcommand,
        requiresTaskId: true,
        requiredArgumentLabel: '<change-slug>',
      });
    }

    if (useStdin && filePath) {
      return getTaskBatchError(
        'TASK_BATCH_INPUT_CONFLICT',
        'Task batch accepts one input source at a time. Prefer --stdin for agents, or use --file <path>.',
      );
    }

    if (!useStdin && !filePath) {
      return getTaskBatchError(
        'TASK_BATCH_INPUT_REQUIRED',
        'Task batch requires JSON input via --stdin (preferred) or --file <path>.',
      );
    }

    return createTaskBatch({
      changeSlug: subjectId,
      batchFilePath: filePath,
      useStdin,
    });
  }

  if (subcommand === 'fix') {
    return fixTasks('task fix');
  }

  if (!subjectId) {
    return getInvalidTaskCommandError({
      subcommand,
      requiresTaskId: true,
    });
  }

  if (subcommand === 'approve') {
    return approveTask(subjectId, 'task approve');
  }

  if (subcommand === 'reopen') {
    return reopenTask(subjectId, reason, 'task reopen');
  }

  if (subcommand === 'reset') {
    return resetTask(subjectId, 'task reset');
  }

  if (subcommand === 'block') {
    return blockTask(subjectId, reason, 'task block');
  }

  if (subcommand === 'request-feedback') {
    return requestFeedbackTask(subjectId, message, 'task request-feedback');
  }

  return completeTask(subjectId, 'task complete');
}

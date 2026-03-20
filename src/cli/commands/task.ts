import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from './parse';
import { refreshOverlaySnapshot, setOverlayVisibilityRequest } from '../overlay-runtime';
import { resolveSuperplanRoot } from '../workspace-root';
import type { OverlayEventKind, OverlayRequestedAction } from '../../shared/overlay';
import {
  appendTaskEntryToIndex,
  buildTaskContract,
  getChangePaths,
  getNextTaskId,
  isValidChangeSlug,
  pathExists,
  type ScaffoldPriority,
} from './scaffold';

interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

interface ParsedTask {
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

interface RuntimeEvent {
  ts: number;
  type: string;
  task_id: string;
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

type TaskCommandResult =
  | { ok: true; data: { task: ParsedTask | null } }
  | { ok: true; data: { tasks: ParsedTask[] } }
  | { ok: true; data: { task_id: string; status: 'in_progress' } }
  | { ok: true; data: { task_id: string; status: 'in_review' } }
  | { ok: true; data: { task_id: string; status: 'done' } }
  | { ok: true; data: { task_id: string; status: 'blocked' } }
  | { ok: true; data: { task_id: string; status: 'needs_feedback' } }
  | { ok: true; data: { task_id: string | null; status: 'in_progress' | 'ready' | null } }
  | { ok: true; data: { task_id: string; status: string; is_ready: boolean; reasons: string[] } }
  | { ok: true; data: { task_id: string | null; reason: string } }
  | { ok: true; data: { events: RuntimeEvent[] } }
  | { ok: true; data: { task_id: string; reset: true } }
  | { ok: true; data: { fixed: boolean; actions: TaskFixAction[] } }
  | { ok: true; data: { task_id: string; change_id: string; path: string } }
  | TaskErrorResult;

type TaskErrorResult = { ok: false; error: { code: string; message: string; retryable: boolean } };

const TASK_SUBCOMMANDS = new Set([
  'show',
  'new',
  'list',
  'current',
  'next',
  'why-next',
  'why',
  'events',
  'start',
  'resume',
  'complete',
  'submit-review',
  'approve',
  'reopen',
  'fix',
  'reset',
  'block',
  'request-feedback',
]);

function getRuntimePaths(): RuntimePaths {
  const runtimeDir = path.join(resolveSuperplanRoot(), 'runtime');
  return {
    tasksPath: path.join(runtimeDir, 'tasks.json'),
    eventsPath: path.join(runtimeDir, 'events.ndjson'),
  };
}

async function getParsedTasks(): Promise<{ tasks?: ParsedTask[]; error?: TaskCommandResult }> {
  const parseResult = await parse([], { json: true });
  if (!parseResult.ok) {
    return { error: parseResult };
  }

  return { tasks: parseResult.data.tasks };
}

async function getParsedTask(taskId: string): Promise<{ task?: ParsedTask; error?: TaskCommandResult }> {
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

async function readEvents(eventsPath: string): Promise<RuntimeEvent[]> {
  try {
    const content = await fs.readFile(eventsPath, 'utf-8');

    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try {
          const event = JSON.parse(line) as Partial<RuntimeEvent>;
          if (typeof event.ts !== 'number' || typeof event.type !== 'string' || typeof event.task_id !== 'string') {
            return [];
          }

          return [{
            ts: event.ts,
            type: event.type,
            task_id: event.task_id,
          }];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
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
): Promise<void> {
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${JSON.stringify({
    ts: Date.now(),
    type,
    task_id: taskId,
  })}\n`, 'utf-8');
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
} = {}): Promise<void> {
  const mergedTasksResult = await getMergedTasks({ skipInvariant: true });
  if (mergedTasksResult.error) {
    return;
  }

  const operations: Promise<unknown>[] = [
    refreshOverlaySnapshot(mergedTasksResult.tasks!, {
      alertKinds: getOverlayAlertKinds(mergedTasksResult.tasks!, options.preferredAlerts),
    }),
  ];

  if (options.requestedAction) {
    operations.push(setOverlayVisibilityRequest(options.requestedAction));
  }

  await Promise.all(operations);
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
    'Available task commands:',
    'Task commands:',
    '  next                         Pick the next ready task',
    '  current                      Show the current in-progress task',
    '  show [task_id]               Show one task or all tasks',
    '  new <change-slug>            Create a new task file in a change',
    '  start <task_id>              Start a specific ready task',
    '  complete <task_id>           Finish implementation and send the task to review',
    '  approve <task_id>            Approve an in-review task and mark it done',
    '  reopen <task_id>             Move a review or done task back into implementation',
    '  block <task_id> --reason     Pause a task because something external is blocking it',
    '  request-feedback <task_id>   Pause a task because you need user input',
    '  resume <task_id>             Continue a blocked or feedback task',
    '  list                         List all parsed tasks',
    '  fix                          Repair runtime conflicts deterministically',
    '',
    'For a fast start: superplan run',
    '',
    'Diagnostic commands still exist but are intentionally hidden from the default help surface.',
    '',
    'Examples:',
    '  superplan task next',
    '  superplan task show T-001',
    '  superplan task --help',
    '  superplan task new improve-task-authoring --title "Add task template"',
    '  superplan task start T-001',
    '  superplan task approve T-001',
    '  superplan task block T-001 --reason "Waiting on review"',
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

function sortTasksByPriorityAndId(left: ParsedTask, right: ParsedTask): number {
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

async function showTasks(): Promise<TaskCommandResult> {
  const mergedTasksResult = await getMergedTasks();
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
  error?: TaskCommandResult;
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

async function nextTask(): Promise<TaskCommandResult> {
  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const activeTaskResult = getActiveTask(mergedTasksResult.tasks!);

  if (activeTaskResult.task) {
    return {
      ok: true,
      data: {
        task_id: activeTaskResult.task.task_id,
        status: 'in_progress',
      },
    };
  }

  const nextReadyTask = getNextReadyTask(mergedTasksResult.tasks!);

  return {
    ok: true,
    data: {
      task_id: nextReadyTask?.task_id ?? null,
      status: nextReadyTask ? 'ready' : null,
    },
  };
}

async function whyNextTask(): Promise<TaskCommandResult> {
  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const activeTaskResult = getActiveTask(mergedTasksResult.tasks!);
  if (activeTaskResult.task) {
    return {
      ok: true,
      data: {
        task_id: activeTaskResult.task.task_id,
        reason: 'Task is currently in progress',
      },
    };
  }

  const nextReadyTask = getNextReadyTask(mergedTasksResult.tasks!);
  if (nextReadyTask) {
    return {
      ok: true,
      data: {
        task_id: nextReadyTask.task_id,
        reason: 'Highest priority among ready tasks',
      },
    };
  }

  return {
    ok: true,
    data: {
      task_id: null,
      reason: 'No ready tasks available',
    },
  };
}

async function currentTask(): Promise<TaskCommandResult> {
  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const activeTaskResult = getActiveTask(mergedTasksResult.tasks!);

  return {
    ok: true,
    data: {
      task: activeTaskResult.task ?? null,
    },
  };
}

async function fixTasks(): Promise<TaskCommandResult> {
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
      await appendEvent(runtimePaths.eventsPath, 'task.reset', taskId);
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
      await appendEvent(runtimePaths.eventsPath, 'task.blocked', taskId);
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
        await appendEvent(runtimePaths.eventsPath, 'task.blocked', taskId);
      }
    }
  }

  if (actions.length > 0) {
    await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
    await refreshOverlayFromMergedTasks();
  }

  return {
    ok: true,
    data: {
      fixed: actions.length > 0,
      actions,
    },
  };
}

async function showTask(taskId?: string): Promise<TaskCommandResult> {
  if (!taskId) {
    return showTasks();
  }

  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }
  const taskWithRuntimeState = mergedTasksResult.tasks!.find(taskItem => taskItem.task_id === taskId);
  if (!taskWithRuntimeState) {
    return {
      ok: false,
      error: {
        code: 'TASK_NOT_FOUND',
        message: 'Task not found',
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    data: {
      task: taskWithRuntimeState,
    },
  };
}

async function whyTask(taskId: string): Promise<TaskCommandResult> {
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
      task_id: taskId,
      status: matchedTask.status,
      is_ready: reasons.length === 0,
      reasons,
    },
  };
}

async function startTask(taskId: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.started', taskId);
  await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
    },
  };
}

async function resumeTask(taskId: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.resumed', taskId);
  await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
    },
  };
}

async function completeTask(taskId: string): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId);
    return invariantError;
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId);
    return parsedTask.error;
  }

  const matchedTask = parsedTask.task!;
  if (!matchedTask.is_valid) {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId);
    return getTaskInvalidError();
  }

  const existingTaskState = runtimeState.tasks[taskId];

  if (existingTaskState?.status === 'in_review') {
    return {
      ok: true,
      data: {
        task_id: taskId,
        status: 'in_review',
      },
    };
  }

  if (existingTaskState?.status !== 'in_progress') {
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId);
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
    await appendEvent(runtimePaths.eventsPath, 'task.complete_failed', taskId);
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
  await appendEvent(runtimePaths.eventsPath, 'task.review_requested', taskId);
  await refreshOverlayFromMergedTasks();

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_review',
    },
  };
}

async function approveTask(taskId: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.approved', taskId);
  await refreshOverlayFromMergedTasks();

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'done',
    },
  };
}

async function blockTask(taskId: string, reason?: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.blocked', taskId);
  await refreshOverlayFromMergedTasks();

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'blocked',
    },
  };
}

async function requestFeedbackTask(taskId: string, message?: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.feedback_requested', taskId);
  await refreshOverlayFromMergedTasks({ preferredAlerts: ['needs_feedback'] });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'needs_feedback',
    },
  };
}

async function reopenTask(taskId: string, reason?: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.reopened', taskId);
  await refreshOverlayFromMergedTasks({ requestedAction: 'ensure' });

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
    },
  };
}

async function eventsTask(taskId?: string): Promise<TaskCommandResult> {
  const runtimePaths = getRuntimePaths();
  const events = await readEvents(runtimePaths.eventsPath);

  return {
    ok: true,
    data: {
      events: taskId
        ? events.filter(event => event.task_id === taskId)
        : events,
    },
  };
}

async function resetTask(taskId: string): Promise<TaskCommandResult> {
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
  await appendEvent(runtimePaths.eventsPath, 'task.reset', taskId);
  await refreshOverlayFromMergedTasks();

  return {
    ok: true,
    data: {
      task_id: taskId,
      reset: true,
    },
  };
}

async function createTask(changeSlug: string, title?: string, rawPriority?: string): Promise<TaskCommandResult> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

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

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changesRoot)) {
    return {
      ok: false,
      error: {
        code: 'INIT_REQUIRED',
        message: 'Run superplan init before creating a task',
        retryable: true,
      },
    };
  }

  if (!await pathExists(changePaths.changeRoot)) {
    return {
      ok: false,
      error: {
        code: 'CHANGE_NOT_FOUND',
        message: 'Change not found',
        retryable: false,
      },
    };
  }

  await fs.mkdir(changePaths.tasksDir, { recursive: true });

  const taskId = await getNextTaskId(changePaths.changesRoot);
  const taskPath = path.join(changePaths.tasksDir, `${taskId}.md`);
  const summary = title?.trim() || 'Describe the task.';

  await fs.writeFile(taskPath, buildTaskContract({
    taskId,
    title,
    priority,
  }), 'utf-8');
  await appendTaskEntryToIndex(changePaths.tasksIndexPath, changeSlug, taskId, summary);

  return {
    ok: true,
    data: {
      task_id: taskId,
      change_id: changeSlug,
      path: path.relative(process.cwd(), taskPath) || taskPath,
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

function getPositionalArgs(args: string[]): string[] {
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json' || arg === '--quiet') {
      continue;
    }

    if (arg === '--reason' || arg === '--message' || arg === '--title' || arg === '--priority') {
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
  const taskId = positionalArgs[1];
  const reason = getOptionValue(args, '--reason');
  const message = getOptionValue(args, '--message');
  const title = getOptionValue(args, '--title');
  const priority = getOptionValue(args, '--priority');

  if (!subcommand || !TASK_SUBCOMMANDS.has(subcommand)) {
    return getInvalidTaskCommandError({ subcommand });
  }

  if (subcommand === 'list') {
    return showTasks();
  }

  if (subcommand === 'current') {
    return currentTask();
  }

  if (subcommand === 'next') {
    return nextTask();
  }

  if (subcommand === 'why-next') {
    return whyNextTask();
  }

  if (subcommand === 'show') {
    return showTask(taskId);
  }

  if (subcommand === 'new') {
    if (!taskId) {
      return getInvalidTaskCommandError({
        subcommand,
        requiresTaskId: true,
        requiredArgumentLabel: '<change-slug>',
      });
    }

    return createTask(taskId, title, priority);
  }

  if (subcommand === 'events') {
    return eventsTask(taskId);
  }

  if (subcommand === 'fix') {
    return fixTasks();
  }

  if (!taskId) {
    return getInvalidTaskCommandError({
      subcommand,
      requiresTaskId: true,
    });
  }

  if (subcommand === 'why') {
    return whyTask(taskId);
  }

  if (subcommand === 'start') {
    return startTask(taskId);
  }

  if (subcommand === 'resume') {
    return resumeTask(taskId);
  }

  if (subcommand === 'submit-review') {
    return completeTask(taskId);
  }

  if (subcommand === 'approve') {
    return approveTask(taskId);
  }

  if (subcommand === 'reopen') {
    return reopenTask(taskId, reason);
  }

  if (subcommand === 'reset') {
    return resetTask(taskId);
  }

  if (subcommand === 'block') {
    return blockTask(taskId, reason);
  }

  if (subcommand === 'request-feedback') {
    return requestFeedbackTask(taskId, message);
  }

  return completeTask(taskId);
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from './parse';

interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

interface ParsedTask {
  task_id: string;
  status: string;
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  total_acceptance_criteria: number;
  completed_acceptance_criteria: number;
  progress_percent: number;
  effective_status: 'draft' | 'in_progress' | 'done';
  is_valid: boolean;
  issues: string[];
}

interface RuntimeTaskState {
  status: string;
  started_at?: string;
  completed_at?: string;
}

interface RuntimeState {
  tasks: Record<string, RuntimeTaskState>;
}

interface RuntimePaths {
  tasksPath: string;
  eventsPath: string;
}

type TaskCommandResult =
  | { ok: true; data: { task: ParsedTask } }
  | { ok: true; data: { tasks: ParsedTask[] } }
  | { ok: true; data: { task_id: string; status: 'in_progress' } }
  | { ok: true; data: { task_id: string; status: 'done' } }
  | { ok: true; data: { task_id: string | null; status: 'in_progress' | 'ready' | null } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getRuntimePaths(): RuntimePaths {
  const runtimeDir = path.join(process.cwd(), '.superplan', 'runtime');
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

async function appendEvent(eventsPath: string, type: 'task.started' | 'task.completed' | 'task.complete_failed', taskId: string): Promise<void> {
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${JSON.stringify({
    ts: Date.now(),
    type,
    task_id: taskId,
  })}\n`, 'utf-8');
}

function getTaskInvalidError(): TaskCommandResult {
  return {
    ok: false,
    error: {
      code: 'TASK_INVALID',
      message: 'Task is invalid and cannot be executed',
      retryable: false,
    },
  };
}

function getInvariantError(runtimeState: RuntimeState): TaskCommandResult | undefined {
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

function applyRuntimeState(task: ParsedTask, runtimeState?: RuntimeTaskState): ParsedTask {
  if (runtimeState?.status === 'in_progress') {
    return {
      ...task,
      status: 'in_progress',
      effective_status: 'in_progress',
    };
  }

  if (runtimeState?.status === 'done') {
    return {
      ...task,
      status: 'done',
      effective_status: 'done',
    };
  }

  if (runtimeState) {
    return {
      ...task,
      status: runtimeState.status,
    };
  }

  return {
    ...task,
    status: task.effective_status,
  };
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

async function getMergedTasks(): Promise<{ tasks?: ParsedTask[]; error?: TaskCommandResult }> {
  const parsedTasksResult = await getParsedTasks();
  if (parsedTasksResult.error) {
    return { error: parsedTasksResult.error };
  }

  const runtimePaths = getRuntimePaths();
  const runtimeState = await readRuntimeState(runtimePaths.tasksPath);
  const invariantError = getInvariantError(runtimeState);
  if (invariantError) {
    return { error: invariantError };
  }

  const tasks = parsedTasksResult.tasks!.map(taskItem => applyRuntimeState(taskItem, runtimeState.tasks[taskItem.task_id]));

  return { tasks };
}

function getActiveTask(tasks: ParsedTask[]): { task?: ParsedTask } {
  const activeTasks = tasks.filter(taskItem => taskItem.status === 'in_progress');

  return { task: activeTasks[0] };
}

async function nextTask(): Promise<TaskCommandResult> {
  const mergedTasksResult = await getMergedTasks();
  if (mergedTasksResult.error) {
    return mergedTasksResult.error;
  }

  const activeTaskResult = getActiveTask(mergedTasksResult.tasks!);

  if (activeTaskResult.task) {
    if (!activeTaskResult.task.is_valid) {
      return getTaskInvalidError();
    }

    return {
      ok: true,
      data: {
        task_id: activeTaskResult.task.task_id,
        status: 'in_progress',
      },
    };
  }

  const nextReadyTask = mergedTasksResult.tasks!
    .filter(taskItem => taskItem.status !== 'done' && taskItem.is_valid)
    .sort((left, right) => left.task_id.localeCompare(right.task_id))[0];

  return {
    ok: true,
    data: {
      task_id: nextReadyTask?.task_id ?? null,
      status: nextReadyTask ? 'ready' : null,
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

  const matchedTask = parsedTask.task!;
  if (!matchedTask.is_valid) {
    return getTaskInvalidError();
  }

  const existingTaskState = runtimeState.tasks[taskId];
  const activeTaskEntry = Object.entries(runtimeState.tasks).find(([
    activeTaskId,
    taskState,
  ]) => taskState.status === 'in_progress' && activeTaskId !== taskId);

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

  runtimeState.tasks[taskId] = {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.started', taskId);

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

  runtimeState.tasks[taskId] = {
    ...existingTaskState,
    status: 'done',
    completed_at: new Date().toISOString(),
  };

  await writeRuntimeState(runtimePaths.tasksPath, runtimeState);
  await appendEvent(runtimePaths.eventsPath, 'task.completed', taskId);

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'done',
    },
  };
}

export async function task(args: string[]): Promise<TaskCommandResult> {
  const positionalArgs = args.filter(arg => arg !== '--json');
  const subcommand = positionalArgs[0];
  const taskId = positionalArgs[1];

  if (subcommand !== 'show' && subcommand !== 'list' && subcommand !== 'next' && subcommand !== 'start' && subcommand !== 'complete') {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_COMMAND',
        message: 'Usage: superplan task list | superplan task next | superplan task show [task_id] | superplan task start <task_id> | superplan task complete <task_id>',
        retryable: false,
      },
    };
  }

  if (subcommand === 'list') {
    return showTasks();
  }

  if (subcommand === 'next') {
    return nextTask();
  }

  if (subcommand === 'show') {
    return showTask(taskId);
  }

  if (!taskId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_COMMAND',
        message: 'Usage: superplan task list | superplan task next | superplan task show [task_id] | superplan task start <task_id> | superplan task complete <task_id>',
        retryable: false,
      },
    };
  }

  if (subcommand === 'start') {
    return startTask(taskId);
  }

  return completeTask(taskId);
}

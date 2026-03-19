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
}

interface RuntimeTaskState {
  status: string;
  started_at?: string;
}

interface RuntimeState {
  tasks: Record<string, RuntimeTaskState>;
}

type TaskCommandResult =
  | { ok: true; data: { task: ParsedTask } }
  | { ok: true; data: { tasks: ParsedTask[] } }
  | { ok: true; data: { task_id: string; status: 'in_progress' } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function isTaskInvalid(task: ParsedTask): boolean {
  return !task.description.trim() || task.acceptance_criteria.length === 0;
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

async function showTasks(): Promise<TaskCommandResult> {
  const parsedTasksResult = await getParsedTasks();
  if (parsedTasksResult.error) {
    return parsedTasksResult.error;
  }

  return {
    ok: true,
    data: {
      tasks: parsedTasksResult.tasks!,
    },
  };
}

async function showTask(taskId?: string): Promise<TaskCommandResult> {
  if (!taskId) {
    return showTasks();
  }

  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }

  return {
    ok: true,
    data: {
      task: parsedTask.task!,
    },
  };
}

async function startTask(taskId: string): Promise<TaskCommandResult> {
  const parsedTask = await getParsedTask(taskId);
  if (parsedTask.error) {
    return parsedTask.error;
  }

  const matchedTask = parsedTask.task!;
  if (isTaskInvalid(matchedTask)) {
    return {
      ok: false,
      error: {
        code: 'TASK_INVALID',
        message: 'Task is invalid',
        retryable: false,
      },
    };
  }

  const runtimeFilePath = path.join(process.cwd(), '.superplan', 'runtime', 'tasks.json');
  const runtimeState = await readRuntimeState(runtimeFilePath);
  const existingTaskState = runtimeState.tasks[taskId];

  if (matchedTask.effective_status === 'done' || existingTaskState?.status === 'completed') {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_COMPLETED',
        message: 'Task is already completed',
        retryable: false,
      },
    };
  }

  runtimeState.tasks[taskId] = {
    status: 'in_progress',
    started_at: new Date().toISOString(),
  };

  await writeRuntimeState(runtimeFilePath, runtimeState);

  return {
    ok: true,
    data: {
      task_id: taskId,
      status: 'in_progress',
    },
  };
}

export async function task(args: string[]): Promise<TaskCommandResult> {
  const subcommand = args[0];
  const taskId = args[1];

  if (subcommand !== 'show' && subcommand !== 'start') {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_COMMAND',
        message: 'Usage: superplan task show [task_id] | superplan task start <task_id>',
        retryable: false,
      },
    };
  }

  if (subcommand === 'show') {
    return showTask(taskId);
  }

  if (!taskId) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_COMMAND',
        message: 'Usage: superplan task show [task_id] | superplan task start <task_id>',
        retryable: false,
      },
    };
  }

  return startTask(taskId);
}

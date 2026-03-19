import { task, TaskCommandDeps } from './task';

interface RunDeps {
  taskFn: typeof task;
  taskCommandDeps: TaskCommandDeps;
}

export type RunResult =
  | {
      ok: true;
      data: {
        task_id: string | null;
        action: 'start' | 'continue' | 'idle';
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export async function run(deps: Partial<RunDeps> = {}): Promise<RunResult> {
  const runtimeDeps: RunDeps = {
    taskFn: task,
    taskCommandDeps: {},
    ...deps,
  };

  const nextTaskResult = await runtimeDeps.taskFn(['next'], runtimeDeps.taskCommandDeps);
  if (!nextTaskResult.ok) {
    return nextTaskResult;
  }

  if (!('task_id' in nextTaskResult.data) || !('status' in nextTaskResult.data)) {
    return {
      ok: false,
      error: {
        code: 'RUN_FAILED',
        message: 'Unexpected task next result',
        retryable: false,
      },
    };
  }

  if (nextTaskResult.data.task_id === null) {
    return {
      ok: true,
      data: {
        task_id: null,
        action: 'idle',
      },
    };
  }

  if (nextTaskResult.data.status === 'in_progress') {
    return {
      ok: true,
      data: {
        task_id: nextTaskResult.data.task_id,
        action: 'continue',
      },
    };
  }

  if (nextTaskResult.data.status === 'ready') {
    const startTaskResult = await runtimeDeps.taskFn(['start', nextTaskResult.data.task_id], runtimeDeps.taskCommandDeps);
    if (!startTaskResult.ok) {
      return startTaskResult;
    }

    return {
      ok: true,
      data: {
        task_id: nextTaskResult.data.task_id,
        action: 'start',
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'RUN_FAILED',
      message: 'Unexpected task next status',
      retryable: false,
    },
  };
}

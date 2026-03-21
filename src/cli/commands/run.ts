import { selectNextTask, task, type ParsedTask } from './task';
import { overlay } from './overlay';

interface RunDeps {
  selectNextTaskFn: typeof selectNextTask;
  taskFn: typeof task;
  overlayFn: typeof overlay;
}

export type RunResult =
  | {
      ok: true;
      data: {
        task_id: string | null;
        action: 'start' | 'continue' | 'idle';
        task: ParsedTask | null;
        reason: string;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export async function run(deps: Partial<RunDeps> = {}): Promise<RunResult> {
  const runtimeDeps: RunDeps = {
    selectNextTaskFn: selectNextTask,
    taskFn: task,
    overlayFn: overlay,
    ...deps,
  };

  const nextTaskResult = await runtimeDeps.selectNextTaskFn();
  if (!nextTaskResult.ok) {
    return nextTaskResult;
  }

  if (
    !('task_id' in nextTaskResult.data)
    || !('status' in nextTaskResult.data)
    || !('task' in nextTaskResult.data)
    || !('reason' in nextTaskResult.data)
  ) {
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
        task: null,
        reason: nextTaskResult.data.reason,
      },
    };
  }

  if (nextTaskResult.data.status === 'in_progress') {
    await runtimeDeps.overlayFn(['ensure']);

    return {
      ok: true,
      data: {
        task_id: nextTaskResult.data.task_id,
        action: 'continue',
        task: nextTaskResult.data.task,
        reason: nextTaskResult.data.reason,
      },
    };
  }

  if (nextTaskResult.data.status === 'ready') {
    const startTaskResult = await runtimeDeps.taskFn(['start', nextTaskResult.data.task_id]);
    if (!startTaskResult.ok) {
      return startTaskResult;
    }

    const startedTask = 'task' in startTaskResult.data && startTaskResult.data.task
      ? startTaskResult.data.task
      : nextTaskResult.data.task;

    return {
      ok: true,
      data: {
        task_id: nextTaskResult.data.task_id,
        action: 'start',
        task: startedTask,
        reason: nextTaskResult.data.reason,
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

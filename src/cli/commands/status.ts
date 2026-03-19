import { task } from './task';

interface ParsedTask {
  task_id: string;
  status: string;
  is_ready: boolean;
}

export type StatusResult =
  | {
      ok: true;
      data: {
        active: string | null;
        ready: string[];
        blocked: string[];
        needs_feedback: string[];
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function sortTaskIds(taskIds: string[]): string[] {
  return [...taskIds].sort((left, right) => left.localeCompare(right));
}

export async function status(): Promise<StatusResult> {
  const showTasksResult = await task(['show']);
  if (!showTasksResult.ok) {
    return showTasksResult;
  }

  if (!('tasks' in showTasksResult.data)) {
    return {
      ok: false,
      error: {
        code: 'STATUS_FAILED',
        message: 'Unexpected task status result',
        retryable: false,
      },
    };
  }

  const tasks = showTasksResult.data.tasks as ParsedTask[];
  const activeTask = tasks.find(taskItem => taskItem.status === 'in_progress');
  const readyTasks = tasks.filter(taskItem => taskItem.is_ready).map(taskItem => taskItem.task_id);
  const blockedTasks = tasks.filter(taskItem => taskItem.status === 'blocked').map(taskItem => taskItem.task_id);
  const needsFeedbackTasks = tasks.filter(taskItem => taskItem.status === 'needs_feedback').map(taskItem => taskItem.task_id);

  return {
    ok: true,
    data: {
      active: activeTask?.task_id ?? null,
      ready: sortTaskIds(readyTasks),
      blocked: sortTaskIds(blockedTasks),
      needs_feedback: sortTaskIds(needsFeedbackTasks),
    },
  };
}

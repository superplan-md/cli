import { loadTasks, sortTasksByPriorityAndId, type ParsedTask } from './task';
import { getTaskRef } from '../task-identity';
import { getQueueNextAction, type NextAction } from '../next-action';

export type StatusResult =
  | {
      ok: true;
      data: {
        active: string | null;
        ready: string[];
        in_review: string[];
        blocked: string[];
        needs_feedback: string[];
        counts: {
          ready: number;
          in_review: number;
          blocked: number;
          needs_feedback: number;
        };
        next_action: NextAction;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function sortTaskIds(taskIds: string[]): string[] {
  return [...taskIds].sort((left, right) => left.localeCompare(right));
}

export async function status(): Promise<StatusResult> {
  const tasksResult = await loadTasks();
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const tasks = tasksResult.data.tasks as ParsedTask[];
  const activeTask = tasks.find(taskItem => taskItem.status === 'in_progress');
  const readyTasks = tasks
    .filter(taskItem => taskItem.is_ready)
    .sort(sortTasksByPriorityAndId)
    .map(taskItem => getTaskRef(taskItem));
  const inReviewTasks = tasks.filter(taskItem => taskItem.status === 'in_review').map(taskItem => getTaskRef(taskItem));
  const blockedTasks = tasks.filter(taskItem => taskItem.status === 'blocked').map(taskItem => getTaskRef(taskItem));
  const needsFeedbackTasks = tasks.filter(taskItem => taskItem.status === 'needs_feedback').map(taskItem => getTaskRef(taskItem));
  const sortedInReviewTasks = sortTaskIds(inReviewTasks);
  const sortedBlockedTasks = sortTaskIds(blockedTasks);
  const sortedNeedsFeedbackTasks = sortTaskIds(needsFeedbackTasks);

  const data = {
    active: activeTask ? getTaskRef(activeTask) : null,
    ready: readyTasks,
    in_review: sortedInReviewTasks,
    blocked: sortedBlockedTasks,
    needs_feedback: sortedNeedsFeedbackTasks,
    counts: {
      ready: readyTasks.length,
      in_review: sortedInReviewTasks.length,
      blocked: sortedBlockedTasks.length,
      needs_feedback: sortedNeedsFeedbackTasks.length,
    },
    next_action: getQueueNextAction({
      active: activeTask ? getTaskRef(activeTask) : null,
      ready: readyTasks,
      in_review: sortedInReviewTasks,
      blocked: sortedBlockedTasks,
      needs_feedback: sortedNeedsFeedbackTasks,
    }),
  };

  return {
    ok: true,
    data,
  };
}

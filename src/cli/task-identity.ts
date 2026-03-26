export interface TaskIdentityLike {
  task_id: string;
  change_id?: string;
  task_ref?: string;
}

export function toQualifiedTaskId(changeId: string | undefined, taskId: string): string {
  if (!changeId || taskId.includes('/')) {
    return taskId;
  }

  return `${changeId}/${taskId}`;
}

export function getLocalTaskId(taskId: string): string {
  const parts = taskId.split('/');
  return parts[parts.length - 1] || taskId;
}

export function splitQualifiedTaskId(taskId: string): { change_id: string; task_id: string } | null {
  const separatorIndex = taskId.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === taskId.length - 1) {
    return null;
  }

  return {
    change_id: taskId.slice(0, separatorIndex),
    task_id: taskId.slice(separatorIndex + 1),
  };
}

export function getTaskRef(task: TaskIdentityLike): string {
  return task.task_ref ?? toQualifiedTaskId(task.change_id, task.task_id);
}

export function matchesTaskInput(task: TaskIdentityLike, input: string): boolean {
  return getTaskRef(task) === input || task.task_id === input;
}

export function getCompactFallbackDescription(task, options = {}) {
  const secondaryLabel = typeof options.secondaryLabel === 'string' && options.secondaryLabel.trim()
    ? options.secondaryLabel.trim()
    : 'Active task in progress.';
  const reviewReady = options.reviewReady === true;

  if (!task) {
    return secondaryLabel;
  }

  if (reviewReady) {
    return 'Task complete and waiting for approval.';
  }

  if (task.status === 'backlog') {
    return 'Queued as the next task.';
  }

  const description = typeof task.description === 'string'
    ? task.description.trim()
    : '';

  return description || secondaryLabel;
}

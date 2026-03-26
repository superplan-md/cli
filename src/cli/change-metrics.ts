import * as fs from 'fs/promises';
import * as path from 'path';
import { loadChangeGraph } from './graph';
import { readVisibilityEvents } from './visibility-runtime';
import { resolveSuperplanRoot } from './workspace-root';

interface ChangeMetricsTaskSnapshot {
  task_id: string;
  task_ref: string;
  title: string;
  path: string;
  times_called: number;
}

interface ChangeMetricsSnapshot {
  change_id: string;
  title: string | null;
  generated_at: string;
  created_task_count: number;
  total_call_count: number;
  tasks: ChangeMetricsTaskSnapshot[];
}

const CHANGE_METRICS_FILE_NAME = 'metrics.json';
const TASK_CALL_EVENT_TYPES = new Set([
  'task.started',
  'task.resumed',
  'task.reopened',
]);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getChangesRoot(cwd = process.cwd()): string {
  return path.join(resolveSuperplanRoot(cwd), 'changes');
}

function getChangeRoot(changeId: string, cwd = process.cwd()): string {
  return path.join(getChangesRoot(cwd), changeId);
}

function getMetricsPath(changeId: string, cwd = process.cwd()): string {
  return path.join(getChangeRoot(changeId, cwd), CHANGE_METRICS_FILE_NAME);
}

function getTaskRef(changeId: string, taskId: string): string {
  return `${changeId}/${taskId}`;
}

async function listChangeTaskContracts(changeId: string, cwd = process.cwd()): Promise<Array<{
  task_id: string;
  title: string;
  path: string;
}>> {
  const tasksDir = path.join(getChangeRoot(changeId, cwd), 'tasks');
  let entries: Array<{ isFile(): boolean; name: string }> = [];

  try {
    entries = await fs.readdir(tasksDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const taskFiles = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return await Promise.all(taskFiles.map(async fileName => {
    const absolutePath = path.join(tasksDir, fileName);
    const content = await fs.readFile(absolutePath, 'utf-8').catch(() => '');
    const frontmatterTaskId = /^task_id:\s*(.+)$/m.exec(content)?.[1]?.trim();
    const frontmatterTitle = /^title:\s*(.+)$/m.exec(content)?.[1]?.trim();
    const taskId = frontmatterTaskId || path.basename(fileName, '.md');

    return {
      task_id: taskId,
      title: frontmatterTitle || taskId,
      path: path.relative(process.cwd(), absolutePath) || absolutePath,
    };
  }));
}

async function buildChangeMetricsSnapshot(changeId: string, cwd = process.cwd()): Promise<ChangeMetricsSnapshot | null> {
  const changeRoot = getChangeRoot(changeId, cwd);
  if (!await pathExists(changeRoot)) {
    return null;
  }

  const [graphResult, taskContracts, events] = await Promise.all([
    loadChangeGraph(changeRoot),
    listChangeTaskContracts(changeId, cwd),
    readVisibilityEvents(),
  ]);

  const taskCallCounts = new Map<string, number>();
  for (const event of events) {
    if (!event.task_id || !TASK_CALL_EVENT_TYPES.has(event.type) || !event.task_id.startsWith(`${changeId}/`)) {
      continue;
    }

    taskCallCounts.set(event.task_id, (taskCallCounts.get(event.task_id) ?? 0) + 1);
  }

  const tasks: ChangeMetricsTaskSnapshot[] = taskContracts.map(task => ({
    task_id: task.task_id,
    task_ref: getTaskRef(changeId, task.task_id),
    title: task.title,
    path: task.path,
    times_called: taskCallCounts.get(getTaskRef(changeId, task.task_id)) ?? 0,
  }));

  return {
    change_id: changeId,
    title: graphResult.graph?.title ?? null,
    generated_at: new Date().toISOString(),
    created_task_count: taskContracts.length,
    total_call_count: tasks.reduce((total, task) => total + task.times_called, 0),
    tasks,
  };
}

export async function syncChangeMetrics(changeId: string, cwd = process.cwd()): Promise<string | null> {
  const snapshot = await buildChangeMetricsSnapshot(changeId, cwd);
  if (!snapshot) {
    return null;
  }

  const metricsPath = getMetricsPath(changeId, cwd);
  await fs.mkdir(path.dirname(metricsPath), { recursive: true });
  await fs.writeFile(metricsPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  return metricsPath;
}

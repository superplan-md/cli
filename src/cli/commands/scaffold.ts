import * as fs from 'fs/promises';
import * as path from 'path';

export type ScaffoldPriority = 'high' | 'medium' | 'low';

export interface ChangePaths {
  superplanRoot: string;
  changesRoot: string;
  changeRoot: string;
  tasksDir: string;
  tasksIndexPath: string;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function isValidChangeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

export function getChangePaths(changeSlug: string, cwd = process.cwd()): ChangePaths {
  const superplanRoot = path.join(cwd, '.superplan');
  const changesRoot = path.join(superplanRoot, 'changes');
  const changeRoot = path.join(changesRoot, changeSlug);

  return {
    superplanRoot,
    changesRoot,
    changeRoot,
    tasksDir: path.join(changeRoot, 'tasks'),
    tasksIndexPath: path.join(changeRoot, 'tasks.md'),
  };
}

export function formatTitleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function buildChangeTasksIndex(changeSlug: string, title: string): string {
  return [
    `# ${title}`,
    '',
    `- Change ID: \`${changeSlug}\``,
    '- Goal: Describe the goal for this change.',
    '',
    '## Tasks',
    '',
    '- Add task entries as work is shaped.',
    '',
  ].join('\n');
}

export function buildTaskContract(options: {
  taskId: string;
  title?: string;
  priority: ScaffoldPriority;
}): string {
  const description = options.title?.trim() || 'Describe the task.';

  return [
    '---',
    `task_id: ${options.taskId}`,
    'status: pending',
    `priority: ${options.priority}`,
    'depends_on_all: []',
    'depends_on_any: []',
    '---',
    '',
    '## Description',
    description,
    '',
    '## Acceptance Criteria',
    '- [ ] Define the first acceptance criterion.',
    '',
  ].join('\n');
}

export async function getNextTaskId(changesRoot: string): Promise<string> {
  try {
    const changeEntries = await fs.readdir(changesRoot, { withFileTypes: true });
    let maxTaskNumber = 0;

    for (const changeEntry of changeEntries) {
      if (!changeEntry.isDirectory()) {
        continue;
      }

      const tasksDir = path.join(changesRoot, changeEntry.name, 'tasks');
      let taskEntries: Array<{ isFile(): boolean; name: string }> = [];

      try {
        taskEntries = await fs.readdir(tasksDir, { withFileTypes: true });
      } catch {
        continue;
      }

      const changeMaxTaskNumber = taskEntries
        .filter(entry => entry.isFile())
        .map(entry => /^T-(\d+)\.md$/.exec(entry.name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(match => Number.parseInt(match[1], 10))
        .filter(taskNumber => Number.isInteger(taskNumber))
        .reduce((currentMax, taskNumber) => Math.max(currentMax, taskNumber), 0);

      maxTaskNumber = Math.max(maxTaskNumber, changeMaxTaskNumber);
    }

    return `T-${String(maxTaskNumber + 1).padStart(3, '0')}`;
  } catch {
    return 'T-001';
  }
}

export async function appendTaskEntryToIndex(
  tasksIndexPath: string,
  changeSlug: string,
  taskId: string,
  summary: string,
): Promise<void> {
  const fallbackIndex = buildChangeTasksIndex(changeSlug, formatTitleFromSlug(changeSlug));
  const currentContent = await fs.readFile(tasksIndexPath, 'utf-8').catch(() => fallbackIndex);
  const taskLine = `- \`${taskId}\` ${summary}`;

  if (currentContent.includes(taskLine) || currentContent.includes(`\`${taskId}\``)) {
    return;
  }

  const placeholderLine = '- Add task entries as work is shaped.';
  const nextContent = currentContent.includes(placeholderLine)
    ? currentContent.replace(placeholderLine, taskLine)
    : `${currentContent.trimEnd()}\n${taskLine}\n`;

  await fs.writeFile(tasksIndexPath, nextContent, 'utf-8');
}

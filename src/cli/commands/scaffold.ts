import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveSuperplanRoot } from '../workspace-root';

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
  const superplanRoot = resolveSuperplanRoot(cwd);
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
    '# Task Graph',
    '',
    '## Graph Metadata',
    `- Change ID: \`${changeSlug}\``,
    `- Title: ${title}`,
    '',
    '## Graph Layout',
    '',
    '<!-- Exact graph syntax the current CLI validates (delete this comment block when authoring):',
    '- `T-001` First task title',
    '  - depends_on_all: []',
    '  - depends_on_any: []',
    '- `T-002` Follow-up task title',
    '  - depends_on_all: [T-001]',
    '  - depends_on_any: []',
    '',
    'Do not use subsection-style task entries like:',
    '### T-001: Task title',
    '- **Goal:** ...',
    '- **Depends on:** T-000',
    '-->',
    '',
    '## Notes',
    '- Author task entries in the exact `- `T-xxx` Title` graph format shown above before scaffolding task contracts with the CLI.',
    '',
  ].join('\n');
}

export function buildSingleTaskChangeIndex(changeSlug: string, title: string, taskTitle: string): string {
  return [
    '# Task Graph',
    '',
    '## Graph Metadata',
    `- Change ID: \`${changeSlug}\``,
    `- Title: ${title}`,
    '',
    '## Graph Layout',
    `- \`T-001\` ${taskTitle}`,
    '  - depends_on_all: []',
    '  - depends_on_any: []',
    '',
    '## Notes',
    '- This change was created through the single-task fast path.',
    '',
  ].join('\n');
}

export function buildTaskContract(options: {
  taskId: string;
  changeId: string;
  title?: string;
  priority: ScaffoldPriority;
  description?: string;
  acceptanceCriteria?: string[];
}): string {
  const description = options.description?.trim() || options.title?.trim() || 'Describe the task.';
  const acceptanceCriteria = (options.acceptanceCriteria ?? [])
    .map(criterion => criterion
      .split(/\r?\n/)
      .map(segment => segment.trim())
      .filter(Boolean)
      .join(' '))
    .filter(Boolean);
  const normalizedAcceptanceCriteria = acceptanceCriteria.length > 0
    ? acceptanceCriteria
    : ['Define the first acceptance criterion.'];

  return [
    '---',
    `task_id: ${options.taskId}`,
    `change_id: ${options.changeId}`,
    `title: ${options.title?.trim() || description}`,
    'status: pending',
    `priority: ${options.priority}`,
    '---',
    '',
    '## Description',
    description,
    '',
    '## Acceptance Criteria',
    ...normalizedAcceptanceCriteria.map(criterion => `- [ ] ${criterion}`),
    '',
    '## Execution',
    'Add task-specific repo-native commands here when this task needs an explicit launch or setup path.',
    'Use bullets like `- run: npm start`.',
    '',
    '## Verification',
    'Add the smallest proof commands and reviewer evidence here when this task needs tighter checks than the repo defaults.',
    'Use bullets like `- verify: npm test` and `- evidence: capture the failing command output`.',
    '',
  ].join('\n');
}

async function getHighestTaskNumber(changesRoot: string): Promise<number> {
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

    return maxTaskNumber;
  } catch {
    return 0;
  }
}

export async function getNextTaskIds(changesRoot: string, count: number): Promise<string[]> {
  if (count <= 0) {
    return [];
  }

  const highestTaskNumber = await getHighestTaskNumber(changesRoot);

  return Array.from({ length: count }, (_item, index) => `T-${String(highestTaskNumber + index + 1).padStart(3, '0')}`);
}

export async function getNextTaskId(changesRoot: string): Promise<string> {
  const [taskId] = await getNextTaskIds(changesRoot, 1);
  return taskId;
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

  const sectionMarker = '## Graph Layout';
  const sectionIndex = currentContent.indexOf(sectionMarker);
  if (sectionIndex === -1) {
    await fs.writeFile(tasksIndexPath, `${currentContent.trimEnd()}\n${taskLine}\n`, 'utf-8');
    return;
  }

  const insertionPoint = currentContent.indexOf('## Notes', sectionIndex);
  const graphLayoutBlock = insertionPoint === -1
    ? `${currentContent.trimEnd()}\n${taskLine}\n`
    : `${currentContent.slice(0, insertionPoint).trimEnd()}\n${taskLine}\n\n${currentContent.slice(insertionPoint)}`;

  await fs.writeFile(tasksIndexPath, graphLayoutBlock, 'utf-8');
}

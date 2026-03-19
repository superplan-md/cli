import * as fs from 'fs/promises';
import * as path from 'path';

interface ParseOptions {
  json?: boolean;
}

interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

interface ParseDiagnostic {
  code: string;
  message: string;
  task_id?: string;
}

interface ParsedTask {
  task_id: string;
  status: string;
  priority: 'high' | 'medium' | 'low';
  depends_on_all: string[];
  depends_on_any: string[];
  description: string;
  acceptance_criteria: AcceptanceCriterion[];
  total_acceptance_criteria: number;
  completed_acceptance_criteria: number;
  progress_percent: number;
  effective_status: 'draft' | 'in_progress' | 'done';
  is_valid: boolean;
  is_ready: boolean;
  issues: string[];
}

type ParseResult =
  | { ok: true; data: { tasks: ParsedTask[]; diagnostics: ParseDiagnostic[] } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function parseStringArray(value: string): string[] {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [];
  }

  const normalizedValue = trimmedValue.startsWith('[') && trimmedValue.endsWith(']')
    ? trimmedValue.slice(1, -1)
    : trimmedValue;

  return normalizedValue
    .split(',')
    .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatter(lines: string[]): {
  task_id: string;
  status: string;
  priority: 'high' | 'medium' | 'low';
  depends_on_all: string[];
  depends_on_any: string[];
  contentStartIndex: number;
} {
  let taskId = '';
  let status = '';
  let priority: 'high' | 'medium' | 'low' = 'medium';
  let dependsOnAll: string[] = [];
  let dependsOnAny: string[] = [];

  if (lines[0] !== '---') {
    return {
      task_id: taskId,
      status,
      priority,
      depends_on_all: dependsOnAll,
      depends_on_any: dependsOnAny,
      contentStartIndex: 0,
    };
  }

  let index = 1;
  while (index < lines.length && lines[index] !== '---') {
    const line = lines[index];
    const separatorIndex = line.indexOf(':');

    if (separatorIndex !== -1) {
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (key === 'task_id') {
        taskId = value;
      } else if (key === 'status') {
        status = value;
      } else if (key === 'priority') {
        if (value === 'high' || value === 'medium' || value === 'low') {
          priority = value;
        }
      } else if (key === 'depends_on_all') {
        dependsOnAll = parseStringArray(value);
      } else if (key === 'depends_on_any') {
        dependsOnAny = parseStringArray(value);
      }
    }

    index += 1;
  }

  return {
    task_id: taskId,
    status,
    priority,
    depends_on_all: dependsOnAll,
    depends_on_any: dependsOnAny,
    contentStartIndex: index < lines.length ? index + 1 : lines.length,
  };
}

function parseSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection = '';

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim();
      if (!(currentSection in sections)) {
        sections[currentSection] = [];
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  return sections;
}

function normalizeSectionText(lines: string[] | undefined): string {
  if (!lines) {
    return '';
  }

  return lines.join('\n').trim();
}

function parseAcceptanceCriteria(lines: string[] | undefined): AcceptanceCriterion[] {
  if (!lines) {
    return [];
  }

  const criteria: AcceptanceCriterion[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('- [')) {
      continue;
    }

    const closingBracketIndex = line.indexOf(']');
    if (closingBracketIndex === -1) {
      continue;
    }

    const marker = line.slice(3, closingBracketIndex).trim().toLowerCase();
    const text = line.slice(closingBracketIndex + 1).trim();

    if (!text) {
      continue;
    }

    if (marker === '' || marker === 'x') {
      criteria.push({
        text,
        done: marker === 'x',
      });
    }
  }

  return criteria;
}

function computeEffectiveStatus(criteria: AcceptanceCriterion[]): 'draft' | 'in_progress' | 'done' {
  if (criteria.length === 0) {
    return 'draft';
  }

  const completedCount = criteria.filter(criterion => criterion.done).length;

  if (completedCount === criteria.length) {
    return 'done';
  }

  if (completedCount > 0) {
    return 'in_progress';
  }

  return 'draft';
}

function buildTaskDiagnostics(task: ParsedTask, filePath: string): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  const fileLabel = path.relative(process.cwd(), filePath) || filePath;
  const taskId = task.task_id || undefined;

  if (!task.task_id) {
    diagnostics.push({
      code: 'TASK_ID_MISSING',
      message: `Missing task_id in ${fileLabel}`,
    });
  }

  if (!['pending', 'in_progress', 'done'].includes(task.status)) {
    diagnostics.push({
      code: 'INVALID_STATUS_VALUE',
      message: `Invalid status value in ${fileLabel}`,
      task_id: taskId,
    });
  }

  if (!task.description.trim()) {
    diagnostics.push({
      code: 'TASK_WITH_NO_DESCRIPTION',
      message: `Task has no description in ${fileLabel}`,
      task_id: taskId,
    });
  }

  if (task.acceptance_criteria.length === 0) {
    diagnostics.push({
      code: 'EMPTY_ACCEPTANCE_CRITERIA',
      message: `Task has empty acceptance criteria in ${fileLabel}`,
      task_id: taskId,
    });
  }

  return diagnostics;
}

function buildTask(lines: string[], filePath: string): { task: ParsedTask; diagnostics: ParseDiagnostic[] } {
  const frontmatter = parseFrontmatter(lines);
  const sections = parseSections(lines.slice(frontmatter.contentStartIndex));
  const description = normalizeSectionText(sections.Description);
  const acceptanceCriteria = parseAcceptanceCriteria(sections['Acceptance Criteria']);
  const totalAcceptanceCriteria = acceptanceCriteria.length;
  const completedAcceptanceCriteria = acceptanceCriteria.filter(criterion => criterion.done).length;
  const progressPercent = totalAcceptanceCriteria === 0
    ? 0
    : Math.round((completedAcceptanceCriteria / totalAcceptanceCriteria) * 100);

  const task: ParsedTask = {
    task_id: frontmatter.task_id,
    status: frontmatter.status,
    priority: frontmatter.priority,
    depends_on_all: frontmatter.depends_on_all,
    depends_on_any: frontmatter.depends_on_any,
    description,
    acceptance_criteria: acceptanceCriteria,
    total_acceptance_criteria: totalAcceptanceCriteria,
    completed_acceptance_criteria: completedAcceptanceCriteria,
    progress_percent: progressPercent,
    effective_status: computeEffectiveStatus(acceptanceCriteria),
    is_valid: true,
    is_ready: false,
    issues: [],
  };

  const diagnostics = buildTaskDiagnostics(task, filePath);
  task.issues = diagnostics.map(diagnostic => diagnostic.code);
  task.is_valid = task.issues.length === 0;

  return {
    task,
    diagnostics,
  };
}

function computeTaskReadiness(tasks: ParsedTask[]): void {
  const doneTaskIds = new Set(
    tasks
      .filter(task => task.status === 'done')
      .map(task => task.task_id),
  );

  for (const task of tasks) {
    const allDependenciesSatisfied = task.depends_on_all.every(dependsOnTaskId => doneTaskIds.has(dependsOnTaskId));
    const anyDependenciesSatisfied = task.depends_on_any.length === 0
      ? true
      : task.depends_on_any.some(dependsOnTaskId => doneTaskIds.has(dependsOnTaskId));

    task.is_ready =
      task.is_valid &&
      task.status !== 'done' &&
      task.status !== 'in_progress' &&
      allDependenciesSatisfied &&
      anyDependenciesSatisfied;
  }
}

async function resolveTaskFiles(targetPath: string): Promise<string[]> {
  const stats = await fs.stat(targetPath);

  if (stats.isFile()) {
    return [targetPath];
  }

  const tasksDir = path.join(targetPath, 'tasks');
  const taskEntries = await fs.readdir(tasksDir, { withFileTypes: true });

  return taskEntries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => path.join(tasksDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function parseTaskFile(filePath: string): Promise<{ task: ParsedTask; diagnostics: ParseDiagnostic[] }> {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  return buildTask(lines, filePath);
}

async function resolveDefaultTaskFiles(changesDir: string): Promise<string[]> {
  const entries = await fs.readdir(changesDir, { withFileTypes: true });
  const taskFiles: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const changeDir = path.join(changesDir, entry.name);
    const tasksDir = path.join(changeDir, 'tasks');

    try {
      const tasksDirStat = await fs.stat(tasksDir);
      if (!tasksDirStat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const changeTaskFiles = await resolveTaskFiles(changeDir);
    taskFiles.push(...changeTaskFiles);
  }

  return taskFiles.sort((left, right) => left.localeCompare(right));
}

export async function parse(args: string[], _options: ParseOptions): Promise<ParseResult> {
  const positionalArgs = args.filter(arg => arg !== '--json' && arg !== '--quiet');
  const inputPath = positionalArgs[0] ?? 'changes';
  const resolvedInputPath = path.resolve(process.cwd(), inputPath);

  try {
    await fs.access(resolvedInputPath);
  } catch {
    if (positionalArgs.length === 0) {
      return {
        ok: true,
        data: {
          tasks: [],
          diagnostics: [
            {
              code: 'CHANGES_DIR_MISSING',
              message: 'No changes directory found. Run superplan init.',
            },
          ],
        },
      };
    }
  }

  try {
    const taskFiles = positionalArgs.length === 0
      ? await resolveDefaultTaskFiles(resolvedInputPath)
      : await resolveTaskFiles(resolvedInputPath);
    const tasks: ParsedTask[] = [];
    const diagnostics: ParseDiagnostic[] = [];

    for (const taskFile of taskFiles) {
      try {
        const parsed = await parseTaskFile(taskFile);
        tasks.push(parsed.task);
        diagnostics.push(...parsed.diagnostics);
      } catch {
        diagnostics.push({
          code: 'TASK_READ_FAILED',
          message: `Failed to read task file ${path.relative(process.cwd(), taskFile) || taskFile}`,
        });
      }
    }

    const taskIdCounts = new Map<string, number>();
    for (const task of tasks) {
      if (!task.task_id) {
        continue;
      }

      taskIdCounts.set(task.task_id, (taskIdCounts.get(task.task_id) ?? 0) + 1);
    }

    for (const task of tasks) {
      if (!task.task_id || taskIdCounts.get(task.task_id) === 1) {
        continue;
      }

      diagnostics.push({
        code: 'DUPLICATE_TASK_ID',
        message: `Duplicate task_id found: ${task.task_id}`,
        task_id: task.task_id,
      });

      if (!task.issues.includes('DUPLICATE_TASK_ID')) {
        task.issues.push('DUPLICATE_TASK_ID');
        task.is_valid = false;
      }
    }

    computeTaskReadiness(tasks);

    return {
      ok: true,
      data: {
        tasks,
        diagnostics,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        code: 'TASK_READ_FAILED',
        message: 'Failed to read task file',
        retryable: false,
      },
    };
  }
}

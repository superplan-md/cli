import * as fs from 'fs/promises';
import * as path from 'path';
import { loadChangeGraph } from '../graph';
import { getLocalTaskId, toQualifiedTaskId } from '../task-identity';
import { parseTaskRecipeSections, type TaskRecipeConfig } from '../task-execution';
import { resolveSuperplanRoot, resolveWorkspaceRoot } from '../workspace-root';
import { commandNextAction, stopNextAction, type NextAction } from '../next-action';

interface ParseOptions {
  json?: boolean;
}

interface AcceptanceCriterion {
  text: string;
  done: boolean;
}

export interface ParseDiagnostic {
  code: string;
  message: string;
  task_id?: string;
  severity?: 'critical' | 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  column?: number;
  suggested_fix?: string;
}

export interface ParsedTask {
  task_id: string;
  change_id?: string;
  task_ref?: string;
  task_file_path?: string;
  title: string;
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
  task_recipe: TaskRecipeConfig;
  is_valid: boolean;
  is_ready: boolean;
  issues: string[];
}

type ParseResult =
  | { ok: true; data: { tasks: ParsedTask[]; diagnostics: ParseDiagnostic[]; next_action: NextAction } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const LEGACY_CHANGES_DIR = path.join('.superplan', 'changes');

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getDefaultChangesRoots(cwd = process.cwd()): string[] {
  const globalChangesRoot = path.join(resolveSuperplanRoot(), 'changes');
  const legacyWorkspaceChangesRoot = path.join(resolveWorkspaceRoot(cwd), LEGACY_CHANGES_DIR);
  return [...new Set([globalChangesRoot, legacyWorkspaceChangesRoot])];
}

async function resolveInputPath(cwd: string, inputPath: string): Promise<string | null> {
  const explicitPath = path.resolve(cwd, inputPath);
  if (await pathExists(explicitPath)) {
    return explicitPath;
  }

  for (const changesRoot of getDefaultChangesRoots(cwd)) {
    const candidatePath = path.join(changesRoot, inputPath);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

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
    .map(item => item.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean);
}

function parseIndentedStringList(lines: string[], startIndex: number): { values: string[]; nextIndex: number } {
  const values: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const matchedLine = lines[index].match(/^\s*-\s+(.*)$/);
    if (!matchedLine) {
      break;
    }

    const value = matchedLine[1].trim().replace(/^['"`]|['"`]$/g, '');
    if (value) {
      values.push(value);
    }

    index += 1;
  }

  return {
    values,
    nextIndex: index,
  };
}

function parseFrontmatter(lines: string[]): {
  task_id: string;
  title: string;
  status: string;
  priority: 'high' | 'medium' | 'low';
  depends_on_all: string[];
  depends_on_any: string[];
  contentStartIndex: number;
} {
  let taskId = '';
  let title = '';
  let status = '';
  let priority: 'high' | 'medium' | 'low' = 'medium';
  let dependsOnAll: string[] = [];
  let dependsOnAny: string[] = [];

  if (lines[0] !== '---') {
    return {
      task_id: taskId,
      title,
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
      } else if (key === 'title') {
        title = value;
      } else if (key === 'status') {
        status = value;
      } else if (key === 'priority') {
        if (value === 'high' || value === 'medium' || value === 'low') {
          priority = value;
        }
      } else if (key === 'depends_on_all') {
        if (value) {
          dependsOnAll = parseStringArray(value);
        } else {
          const parsedList = parseIndentedStringList(lines, index + 1);
          dependsOnAll = parsedList.values;
          index = parsedList.nextIndex - 1;
        }
      } else if (key === 'depends_on_any') {
        if (value) {
          dependsOnAny = parseStringArray(value);
        } else {
          const parsedList = parseIndentedStringList(lines, index + 1);
          dependsOnAny = parsedList.values;
          index = parsedList.nextIndex - 1;
        }
      }
    }

    index += 1;
  }

  return {
    task_id: taskId,
    title,
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
  const taskRecipe = parseTaskRecipeSections(sections);
  const totalAcceptanceCriteria = acceptanceCriteria.length;
  const completedAcceptanceCriteria = acceptanceCriteria.filter(criterion => criterion.done).length;
  const progressPercent = totalAcceptanceCriteria === 0
    ? 0
    : Math.round((completedAcceptanceCriteria / totalAcceptanceCriteria) * 100);

  const changeDir = getChangeDirForTaskFile(filePath);
  const changeId = changeDir ? path.basename(changeDir) : undefined;
  const rawTaskId = frontmatter.task_id;
  const localTaskId = rawTaskId ? getLocalTaskId(rawTaskId) : rawTaskId;
  const qualifiedTaskId = localTaskId ? toQualifiedTaskId(changeId, localTaskId) : localTaskId;

  const task: ParsedTask = {
    task_id: localTaskId,
    change_id: changeId,
    task_ref: qualifiedTaskId,
    task_file_path: path.resolve(process.cwd(), filePath),
    title: frontmatter.title || localTaskId,
    status: frontmatter.status,
    priority: frontmatter.priority,
    depends_on_all: frontmatter.depends_on_all.map(getLocalTaskId),
    depends_on_any: frontmatter.depends_on_any.map(getLocalTaskId),
    description,
    acceptance_criteria: acceptanceCriteria,
    total_acceptance_criteria: totalAcceptanceCriteria,
    completed_acceptance_criteria: completedAcceptanceCriteria,
    progress_percent: progressPercent,
    effective_status: computeEffectiveStatus(acceptanceCriteria),
    task_recipe: taskRecipe,
    is_valid: true,
    is_ready: false,
    issues: [],
  };

  const diagnostics = buildTaskDiagnostics(task, filePath);

  return {
    task,
    diagnostics,
  };
}

function computeTaskReadiness(tasks: ParsedTask[]): void {
  const doneTaskIds = new Set(
    tasks
      .filter(task => task.status === 'done')
      .map(task => task.task_ref ?? task.task_id),
  );

  for (const task of tasks) {
    const allDependenciesSatisfied = task.depends_on_all.every(dependsOnTaskId => doneTaskIds.has(toQualifiedTaskId(task.change_id, dependsOnTaskId)));
    const anyDependenciesSatisfied = task.depends_on_any.length === 0
      ? true
      : task.depends_on_any.some(dependsOnTaskId => doneTaskIds.has(toQualifiedTaskId(task.change_id, dependsOnTaskId)));

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

  const tasksDir = path.basename(targetPath) === 'tasks'
    ? targetPath
    : path.join(targetPath, 'tasks');
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

async function resolveChangeDirs(targetPath: string): Promise<string[]> {
  const stats = await fs.stat(targetPath);
  if (stats.isFile()) {
    return [];
  }

  const directTasksDir = path.basename(targetPath) === 'tasks'
    ? targetPath
    : path.join(targetPath, 'tasks');
  if (await pathExists(directTasksDir)) {
    return [path.basename(targetPath) === 'tasks' ? path.dirname(targetPath) : targetPath];
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const changeDirs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const changeDir = path.join(targetPath, entry.name);
    if (await pathExists(path.join(changeDir, 'tasks'))) {
      changeDirs.push(changeDir);
    }
  }

  return changeDirs.sort((left, right) => left.localeCompare(right));
}

function getChangeDirForTaskFile(filePath: string): string | null {
  const tasksDir = path.dirname(filePath);
  if (path.basename(tasksDir) !== 'tasks') {
    return null;
  }

  return path.dirname(tasksDir);
}

function applyDiagnosticsToTask(task: ParsedTask, taskDiagnostics: ParseDiagnostic[]): void {
  task.issues = taskDiagnostics.map(diagnostic => diagnostic.code);
  task.is_valid = task.issues.length === 0;
}

async function parseChangeDir(changeDir: string): Promise<{ tasks: ParsedTask[]; diagnostics: ParseDiagnostic[] }> {
  const taskFiles = await resolveTaskFiles(changeDir).catch(() => []);
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

  const graphResult = await loadChangeGraph(changeDir);
  diagnostics.push(...graphResult.diagnostics);

  const graphTaskById = new Map((graphResult.graph?.tasks ?? []).map(task => [task.task_id, task]));
  const graphInvalid = graphResult.diagnostics.length > 0;

  for (const task of tasks) {
    const graphTask = graphTaskById.get(task.task_id);
    if (graphTask) {
      task.depends_on_all = graphTask.depends_on_all;
      task.depends_on_any = graphTask.depends_on_any;
    } else {
      diagnostics.push({
        code: 'TASK_FILE_UNREFERENCED',
        message: `Task contract ${task.task_id} is not declared in the task graph.`,
        task_id: task.task_id || undefined,
      });
    }

    if (graphInvalid) {
      diagnostics.push({
        code: 'TASK_GRAPH_CONTRACT_CONFLICT',
        message: `Task ${task.task_id} cannot be trusted until the task graph is valid.`,
        task_id: task.task_id,
      });
    }

    applyDiagnosticsToTask(task, diagnostics.filter(diagnostic => diagnostic.task_id === task.task_id));
  }

  const taskIdCounts = new Map<string, number>();
  for (const task of tasks) {
    if (!task.task_id) {
      continue;
    }

    const taskRef = task.task_ref ?? task.task_id;
    taskIdCounts.set(taskRef, (taskIdCounts.get(taskRef) ?? 0) + 1);
  }

  for (const task of tasks) {
    const taskRef = task.task_ref ?? task.task_id;
    if (!task.task_id || taskIdCounts.get(taskRef) === 1) {
      continue;
    }

    diagnostics.push({
      code: 'DUPLICATE_TASK_ID',
      message: `Duplicate task_id found: ${taskRef}`,
      task_id: task.task_id,
    });
  }

  for (const task of tasks) {
    applyDiagnosticsToTask(
      task,
      diagnostics.filter(diagnostic => diagnostic.task_id === task.task_id),
    );
  }

  computeTaskReadiness(tasks);

  return {
    tasks,
    diagnostics,
  };
}

async function parseSingleTaskFile(filePath: string): Promise<{ tasks: ParsedTask[]; diagnostics: ParseDiagnostic[] }> {
  const parsed = await parseTaskFile(filePath);
  const diagnostics = [...parsed.diagnostics];
  const changeDir = getChangeDirForTaskFile(filePath);
  const tasks = [parsed.task];

  if (changeDir) {
    const graphResult = await loadChangeGraph(changeDir);
    diagnostics.push(...graphResult.diagnostics);

    const graphTask = graphResult.graph?.tasks.find(task => task.task_id === parsed.task.task_id);
    if (graphTask) {
      parsed.task.depends_on_all = graphTask.depends_on_all;
      parsed.task.depends_on_any = graphTask.depends_on_any;
    } else {
      diagnostics.push({
        code: 'TASK_FILE_UNREFERENCED',
        message: `Task contract ${parsed.task.task_id} is not declared in the task graph.`,
        task_id: parsed.task.task_id || undefined,
      });
    }

    if (graphResult.diagnostics.length > 0) {
      diagnostics.push({
        code: 'TASK_GRAPH_CONTRACT_CONFLICT',
        message: `Task ${parsed.task.task_id} cannot be trusted until the task graph is valid.`,
        task_id: parsed.task.task_id,
      });
    }
  }

  applyDiagnosticsToTask(
    parsed.task,
    diagnostics.filter(diagnostic => diagnostic.task_id === parsed.task.task_id),
  );
  computeTaskReadiness(tasks);

  return {
    tasks,
    diagnostics,
  };
}

export async function parse(args: string[], _options: ParseOptions): Promise<ParseResult> {
  const positionalArgs = args.filter(arg => arg !== '--json' && arg !== '--quiet');
  const cwd = process.cwd();
  const inputPath = positionalArgs[0];
  const resolvedInputPath = inputPath ? await resolveInputPath(cwd, inputPath) : null;
  const changesRoots = inputPath
    ? []
    : (await Promise.all(
      getDefaultChangesRoots(cwd).map(async changesRoot => (await pathExists(changesRoot) ? changesRoot : null)),
    )).filter((changesRoot): changesRoot is string => changesRoot !== null);

  if (inputPath && !resolvedInputPath) {
    return {
      ok: false,
      error: {
        code: 'TASK_READ_FAILED',
        message: 'Failed to read task file',
        retryable: false,
      },
    };
  }

  if (!inputPath && changesRoots.length === 0) {
    return {
      ok: true,
      data: {
        tasks: [],
        diagnostics: [
          {
            code: 'CHANGES_DIR_MISSING',
            message: 'No Superplan changes directory found. Run superplan init.',
          },
        ],
        next_action: commandNextAction(
          'superplan init --yes --json',
          'Parsing cannot proceed until Superplan has created a tracked changes root.',
        ),
      },
    };
  }

  try {
    if (resolvedInputPath) {
      const stats = await fs.stat(resolvedInputPath);
      if (stats.isFile()) {
        const parsedSingleFile = await parseSingleTaskFile(resolvedInputPath);
        return {
          ok: true,
          data: {
            ...parsedSingleFile,
            next_action: parsedSingleFile.diagnostics.length > 0
              ? stopNextAction(
                'Fix the reported task-file diagnostics before relying on this task.',
                'The parsed task file still has diagnostics that need resolution.',
              )
              : commandNextAction(
                'superplan status --json',
                'The task file parsed cleanly, so the next useful control-plane step is checking the frontier.',
              ),
          },
        };
      }

      const changeDirs = await resolveChangeDirs(resolvedInputPath);
      const tasks: ParsedTask[] = [];
      const diagnostics: ParseDiagnostic[] = [];

      for (const changeDir of changeDirs) {
        const parsedChange = await parseChangeDir(changeDir);
        tasks.push(...parsedChange.tasks);
        diagnostics.push(...parsedChange.diagnostics);
      }

      return {
        ok: true,
        data: {
          tasks,
          diagnostics,
          next_action: diagnostics.length > 0
            ? stopNextAction(
              'Fix the reported task-file or graph diagnostics before relying on the runtime loop.',
              'The parsed task set is not clean, so execution should not continue blindly.',
            )
            : commandNextAction(
              'superplan status --json',
              'The task files parsed cleanly, so the next useful control-plane step is checking the frontier.',
            ),
        },
      };
    }

    const tasks: ParsedTask[] = [];
    const diagnostics: ParseDiagnostic[] = [];
    const seenChangeDirs = new Set<string>();

    for (const changesRoot of changesRoots) {
      const changeDirs = await resolveChangeDirs(changesRoot);
      for (const changeDir of changeDirs) {
        if (seenChangeDirs.has(changeDir)) {
          continue;
        }

        seenChangeDirs.add(changeDir);
        const parsedChange = await parseChangeDir(changeDir);
        tasks.push(...parsedChange.tasks);
        diagnostics.push(...parsedChange.diagnostics);
      }
    }

    return {
      ok: true,
      data: {
        tasks,
        diagnostics,
        next_action: diagnostics.length > 0
          ? stopNextAction(
            'Fix the reported task-file or graph diagnostics before relying on the runtime loop.',
            'The parsed task set is not clean, so execution should not continue blindly.',
          )
          : commandNextAction(
            'superplan status --json',
            'The task files parsed cleanly, so the next useful control-plane step is checking the frontier.',
          ),
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

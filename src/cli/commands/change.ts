import * as fs from 'fs/promises';
import * as path from 'path';
import { loadChangeGraph } from '../graph';
import { loadTasks, type TaskListResult } from './task';
import { refreshOverlaySnapshot } from '../overlay-runtime';
import {
  applyRequestedOverlayAction,
  createOverlayRuntimeNotice,
  type OverlayRuntimeNotice,
} from '../overlay-visibility';
import {
  appendTaskEntryToIndex,
  buildChangeTasksIndex,
  buildSingleTaskChangeIndex,
  buildTaskContract,
  formatTitleFromSlug,
  getChangePaths,
  isValidChangeSlug,
  isValidTaskId,
  pathExists,
  type ScaffoldPriority,
} from './scaffold';
import { ensureChangeArtifacts } from '../workspace-artifacts';
import { syncChangeMetrics } from '../change-metrics';
import { commandNextAction, stopNextAction, type NextAction } from '../next-action';

export type ChangeResult =
  | {
      ok: true;
      data: {
        change_id: string;
        root: string;
        files: string[];
        next_action: NextAction;
        overlay?: OverlayRuntimeNotice;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const CHANGE_SUBCOMMANDS = new Set([
  'new',
  'plan',
  'spec',
  'task',
]);

function parsePriority(rawPriority: string | undefined): ScaffoldPriority | null {
  if (rawPriority === undefined) {
    return 'medium';
  }

  if (rawPriority === 'high' || rawPriority === 'medium' || rawPriority === 'low') {
    return rawPriority;
  }

  return null;
}

function getOptionValue(args: string[], optionName: string): string | undefined {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }

  const optionValue = args[optionIndex + 1];
  if (!optionValue || optionValue.startsWith('--')) {
    return undefined;
  }

  return optionValue;
}

function getOptionValues(args: string[], optionName: string): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== optionName) {
      continue;
    }

    const value = args[index + 1];
    if (value && !value.startsWith('--')) {
      values.push(value);
      index += 1;
    }
  }

  return values;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      chunks.push(String(chunk));
    });
    process.stdin.on('end', () => {
      resolve(chunks.join(''));
    });
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

function normalizeDocSlug(input: string): string | null {
  const normalized = input.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  if (!segments.every(segment => /^[A-Za-z0-9][A-Za-z0-9-_]*$/.test(segment))) {
    return null;
  }

  return segments.join('/');
}

function splitTaskIdList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
}

function getPositionalArgs(args: string[]): string[] {
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json' || arg === '--quiet' || arg === '--stdin') {
      continue;
    }

    if (
      arg === '--title' ||
      arg === '--single-task' ||
      arg === '--priority' ||
      arg === '--content' ||
      arg === '--file' ||
      arg === '--name' ||
      arg === '--task-id' ||
      arg === '--description' ||
      arg === '--depends-on-all' ||
      arg === '--depends-on-any' ||
      arg === '--acceptance-criterion'
    ) {
      index += 1;
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

async function readContentInput(args: string[], options: {
  requiredLabel: string;
}): Promise<{ content?: string; error?: ChangeResult }> {
  const inlineContent = getOptionValue(args, '--content');
  const filePath = getOptionValue(args, '--file');
  const useStdin = hasFlag(args, '--stdin');
  const sources = [inlineContent !== undefined, filePath !== undefined, useStdin].filter(Boolean).length;

  if (sources > 1) {
    return {
      error: {
        ok: false,
        error: {
          code: 'CHANGE_CONTENT_INPUT_CONFLICT',
          message: `Provide ${options.requiredLabel} using exactly one of --content, --file <path>, or --stdin.`,
          retryable: false,
        },
      },
    };
  }

  if (sources === 0) {
    return {
      error: {
        ok: false,
        error: {
          code: 'CHANGE_CONTENT_INPUT_REQUIRED',
          message: `Provide ${options.requiredLabel} using --content, --file <path>, or --stdin.`,
          retryable: false,
        },
      },
    };
  }

  if (inlineContent !== undefined) {
    return { content: inlineContent };
  }

  if (filePath !== undefined) {
    const resolvedFilePath = path.resolve(process.cwd(), filePath);
    try {
      return { content: await fs.readFile(resolvedFilePath, 'utf-8') };
    } catch {
      return {
        error: {
          ok: false,
          error: {
            code: 'CHANGE_CONTENT_FILE_READ_FAILED',
            message: `Could not read content from ${path.relative(process.cwd(), resolvedFilePath) || resolvedFilePath}.`,
            retryable: false,
          },
        },
      };
    }
  }

  try {
    const content = await readStdin();
    if (!content.trim()) {
      return {
        error: {
          ok: false,
          error: {
            code: 'CHANGE_CONTENT_STDIN_EMPTY',
            message: `${options.requiredLabel} stdin payload was empty.`,
            retryable: false,
          },
        },
      };
    }
    return { content };
  } catch {
    return {
      error: {
        ok: false,
        error: {
          code: 'CHANGE_CONTENT_STDIN_READ_FAILED',
          message: `Could not read ${options.requiredLabel} from stdin.`,
          retryable: false,
        },
      },
    };
  }
}

export function getChangeCommandHelpMessage(options: {
  subcommand?: string;
  requiresSlug?: boolean;
}): string {
  const { subcommand, requiresSlug } = options;

  let intro = 'Superplan change command requires a subcommand.';
  if (subcommand && !requiresSlug) {
    intro = `Unknown change subcommand: ${subcommand}`;
  } else if (subcommand && requiresSlug) {
    intro = `Change command "${subcommand}" requires a <slug>.`;
  }

  return [
    intro,
    '',
    'Change commands:',
    '  new <slug>                           Create a new tracked change',
    '  plan set <change-slug>               Write change-scoped plan content through the CLI',
    '  spec set <change-slug>               Write change-scoped spec content through the CLI',
    '  task add <change-slug>               Add one tracked task and scaffold its contract through the CLI',
    '',
    'Options:',
    '  --title <title>                      Set the tracked change title or task title',
    '  --single-task <title>                Create a one-task change and scaffold T-001 immediately',
    '  --priority <level>                   Set task priority (high, medium, low)',
    '  --content <markdown>                 Provide markdown content inline',
    '  --file <path>                        Read markdown content from a file',
    '  --stdin                              Read markdown content from stdin',
    '  --name <slug>                        Set the change-spec document name',
    '  --task-id <task_id>                  Set the graph task id explicitly',
    '  --description <text>                 Set the task description',
    '  --depends-on-all <ids>               Comma-separated hard dependencies',
    '  --depends-on-any <ids>               Comma-separated soft dependencies',
    '  --acceptance-criterion <text>        Add one task acceptance criterion (repeatable)',
    '',
    'Examples:',
    '  superplan change new improve-task-authoring --json',
    '  superplan change new improve-task-authoring --title "Improve Task Authoring" --json',
    '  superplan change new fix-status --title "Fix Status" --single-task "Add status counts" --priority high --json',
    '  superplan change plan set improve-task-authoring --file plan.md --json',
    '  superplan change spec set improve-task-authoring --name design --stdin --json',
    '  superplan change task add improve-task-authoring --title "Add CLI plan writer" --depends-on-all T-001 --acceptance-criterion "CLI can write change plans" --json',
    '',
    'Use `change task add` for the normal one-task path.',
    'Use `task scaffold new` or `task scaffold batch` only when task ids are already declared in the graph and you need to scaffold contracts from that pre-shaped graph.',
  ].join('\n');
}

function getInvalidChangeCommandError(options: {
  subcommand?: string;
  requiresSlug?: boolean;
}): ChangeResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_CHANGE_COMMAND',
      message: getChangeCommandHelpMessage(options),
      retryable: true,
    },
  };
}

async function createChange(changeSlug: string, options: {
  title?: string;
  singleTaskTitle?: string;
  priority?: string;
}): Promise<ChangeResult> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changesRoot)) {
    return {
      ok: false,
      error: {
        code: 'INIT_REQUIRED',
        message: 'Run superplan init before creating a change',
        retryable: true,
      },
    };
  }

  if (await pathExists(changePaths.changeRoot)) {
    return {
      ok: false,
      error: {
        code: 'CHANGE_EXISTS',
        message: 'Change already exists',
        retryable: false,
      },
    };
  }

  await fs.mkdir(changePaths.tasksDir, { recursive: true });
  const normalizedTitle = options.title?.trim() || formatTitleFromSlug(changeSlug);
  const normalizedSingleTaskTitle = options.singleTaskTitle?.trim();
  const singleTaskPriority = parsePriority(options.priority);
  if (options.priority !== undefined && !singleTaskPriority) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PRIORITY',
        message: 'Priority must be one of: high, medium, low',
        retryable: false,
      },
    };
  }
  await fs.writeFile(
    changePaths.tasksIndexPath,
    normalizedSingleTaskTitle
      ? buildSingleTaskChangeIndex(changeSlug, normalizedTitle, normalizedSingleTaskTitle)
      : buildChangeTasksIndex(changeSlug, normalizedTitle),
    'utf-8',
  );
  let taskFilePath: string | null = null;
  if (normalizedSingleTaskTitle) {
    taskFilePath = path.join(changePaths.tasksDir, 'T-001.md');
    await fs.writeFile(taskFilePath, buildTaskContract({
      taskId: 'T-001',
      changeId: changeSlug,
      title: normalizedSingleTaskTitle,
      priority: singleTaskPriority ?? 'medium',
      description: normalizedSingleTaskTitle,
    }), 'utf-8');
  }
  const extraFiles = await ensureChangeArtifacts(changePaths.changeRoot, changeSlug, normalizedTitle);
  const metricsPath = await syncChangeMetrics(changeSlug);
  const overlay = await refreshChangeOverlay();

  return {
    ok: true,
      data: {
        change_id: changeSlug,
        root: path.relative(process.cwd(), changePaths.changeRoot) || changePaths.changeRoot,
        files: [
          path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath,
          path.relative(process.cwd(), changePaths.tasksDir) || changePaths.tasksDir,
          ...extraFiles.map(filePath => path.relative(process.cwd(), filePath) || filePath),
          ...(taskFilePath ? [path.relative(process.cwd(), taskFilePath) || taskFilePath] : []),
          ...(metricsPath ? [path.relative(process.cwd(), metricsPath) || metricsPath] : []),
        ],
        next_action: normalizedSingleTaskTitle
          ? commandNextAction(
              `superplan run ${changeSlug}/T-001 --json`,
              'The single-task change is scaffolded and ready to start immediately.',
            )
          : stopNextAction(
              `The change scaffold exists. For most new work, use \`superplan change task add ${changeSlug} --title "..." --json\`. Edit ${path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath} directly only when you are shaping a larger graph up front.`,
              'The default next step is CLI-owned task creation; manual graph editing is only needed for pre-shaped or multi-task authoring.',
            ),
        ...(overlay ? { overlay } : {}),
      },
    };
}

async function writeChangePlan(changeSlug: string, args: string[]): Promise<ChangeResult> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changeRoot)) {
    return {
      ok: false,
      error: {
        code: 'CHANGE_NOT_FOUND',
        message: 'Change does not exist',
        retryable: false,
      },
    };
  }

  const contentResult = await readContentInput(args, { requiredLabel: 'change plan content' });
  if (contentResult.error) {
    return contentResult.error;
  }

  const artifactPaths = await ensureChangeArtifacts(changePaths.changeRoot, changeSlug, formatTitleFromSlug(changeSlug));
  const planPath = path.join(changePaths.changeRoot, 'plan.md');
  await fs.writeFile(planPath, `${contentResult.content!.trimEnd()}\n`, 'utf-8');

  return {
    ok: true,
    data: {
      change_id: changeSlug,
      root: path.relative(process.cwd(), changePaths.changeRoot) || changePaths.changeRoot,
      files: [
        ...artifactPaths.map(filePath => path.relative(process.cwd(), filePath) || filePath),
        path.relative(process.cwd(), planPath) || planPath,
      ],
      next_action: commandNextAction(
        `superplan status --json`,
        'The change plan is now written through the CLI; continue from the tracked frontier.',
      ),
    },
  };
}

async function writeChangeSpec(changeSlug: string, args: string[]): Promise<ChangeResult> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const specName = getOptionValue(args, '--name');
  const normalizedSpecName = specName ? normalizeDocSlug(specName) : null;
  if (!normalizedSpecName) {
    return {
      ok: false,
      error: {
        code: 'INVALID_SPEC_NAME',
        message: 'Change spec writes require --name <slug> using letters, numbers, hyphens, underscores, and optional nested paths.',
        retryable: false,
      },
    };
  }

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changeRoot)) {
    return {
      ok: false,
      error: {
        code: 'CHANGE_NOT_FOUND',
        message: 'Change does not exist',
        retryable: false,
      },
    };
  }

  const contentResult = await readContentInput(args, { requiredLabel: 'change spec content' });
  if (contentResult.error) {
    return contentResult.error;
  }

  const artifactPaths = await ensureChangeArtifacts(changePaths.changeRoot, changeSlug, formatTitleFromSlug(changeSlug));
  const specPath = path.join(changePaths.changeRoot, 'specs', `${normalizedSpecName}.md`);
  await fs.mkdir(path.dirname(specPath), { recursive: true });
  await fs.writeFile(specPath, `${contentResult.content!.trimEnd()}\n`, 'utf-8');

  return {
    ok: true,
    data: {
      change_id: changeSlug,
      root: path.relative(process.cwd(), changePaths.changeRoot) || changePaths.changeRoot,
      files: [
        ...artifactPaths.map(filePath => path.relative(process.cwd(), filePath) || filePath),
        path.relative(process.cwd(), specPath) || specPath,
      ],
      next_action: commandNextAction(
        `superplan status --json`,
        'The change spec is now written through the CLI; continue from the tracked frontier.',
      ),
    },
  };
}

async function addChangeTask(changeSlug: string, args: string[]): Promise<ChangeResult> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changeRoot)) {
    return {
      ok: false,
      error: {
        code: 'CHANGE_NOT_FOUND',
        message: 'Change does not exist',
        retryable: false,
      },
    };
  }

  const title = getOptionValue(args, '--title')?.trim();
  if (!title) {
    return {
      ok: false,
      error: {
        code: 'TASK_TITLE_REQUIRED',
        message: 'Change task add requires --title <title>.',
        retryable: false,
      },
    };
  }

  const explicitTaskId = getOptionValue(args, '--task-id');
  if (explicitTaskId && !isValidTaskId(explicitTaskId)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_ID',
        message: 'Task ids must match the canonical T-xxx style, such as T-001 or T-010A.',
        retryable: false,
      },
    };
  }

  const dependsOnAll = splitTaskIdList(getOptionValue(args, '--depends-on-all'));
  const dependsOnAny = splitTaskIdList(getOptionValue(args, '--depends-on-any'));
  const invalidDependency = [...dependsOnAll, ...dependsOnAny].find(dependencyId => !isValidTaskId(dependencyId));
  if (invalidDependency) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TASK_DEPENDENCY',
        message: `Dependency task id "${invalidDependency}" is invalid.`,
        retryable: false,
      },
    };
  }

  const priority = parsePriority(getOptionValue(args, '--priority'));
  if (!priority) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PRIORITY',
        message: 'Priority must be one of: high, medium, low',
        retryable: false,
      },
    };
  }

  const graphResult = await loadChangeGraph(changePaths.changeRoot);
  const graphTaskIds = new Set((graphResult.graph?.tasks ?? []).map(task => task.task_id));
  const existingTaskFiles = await fs.readdir(changePaths.tasksDir, { withFileTypes: true }).catch(() => []);
  const takenTaskIds = new Set([
    ...graphTaskIds,
    ...existingTaskFiles
      .filter(entry => entry.isFile())
      .map(entry => /^(.+)\.md$/.exec(entry.name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => match[1]),
  ]);
  const taskId = explicitTaskId ?? (() => {
    let nextNumber = 1;
    while (takenTaskIds.has(`T-${String(nextNumber).padStart(3, '0')}`)) {
      nextNumber += 1;
    }

    return `T-${String(nextNumber).padStart(3, '0')}`;
  })();
  const taskPath = path.join(changePaths.tasksDir, `${taskId}.md`);
  if (graphTaskIds.has(taskId)) {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_IN_GRAPH',
        message: `Task ${taskId} is already declared in ${path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath}.`,
        retryable: false,
      },
    };
  }
  if (await pathExists(taskPath)) {
    return {
      ok: false,
      error: {
        code: 'TASK_ALREADY_EXISTS',
        message: `Task contract already exists for ${taskId}.`,
        retryable: false,
      },
    };
  }

  await appendTaskEntryToIndex(changePaths.tasksIndexPath, changeSlug, taskId, title, dependsOnAll, dependsOnAny);
  await fs.mkdir(changePaths.tasksDir, { recursive: true });
  await fs.writeFile(taskPath, buildTaskContract({
    taskId,
    changeId: changeSlug,
    title,
    priority,
    description: getOptionValue(args, '--description')?.trim() || title,
    acceptanceCriteria: getOptionValues(args, '--acceptance-criterion'),
  }), 'utf-8');
  const metricsPath = await syncChangeMetrics(changeSlug);
  const overlay = await refreshChangeOverlay();

  return {
    ok: true,
    data: {
      change_id: changeSlug,
      root: path.relative(process.cwd(), changePaths.changeRoot) || changePaths.changeRoot,
      files: [
        path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath,
        path.relative(process.cwd(), taskPath) || taskPath,
        ...(metricsPath ? [path.relative(process.cwd(), metricsPath) || metricsPath] : []),
      ],
      next_action: commandNextAction(
        'superplan status --json',
        'The graph task and task contract were both created through the CLI; check the frontier before execution.',
      ),
      ...(overlay ? { overlay } : {}),
    },
  };
}

async function refreshChangeOverlay(): Promise<OverlayRuntimeNotice | undefined> {
  const tasksResult: TaskListResult = await loadTasks({ skipInvariant: true });
  if (!tasksResult.ok) {
    return undefined;
  }

  const { snapshot } = await refreshOverlaySnapshot(tasksResult.data.tasks);
  const visibility = await applyRequestedOverlayAction('ensure', snapshot);
  return createOverlayRuntimeNotice('ensure', visibility);
}

export async function change(args: string[]): Promise<ChangeResult> {
  const positionalArgs = getPositionalArgs(args);
  const namespace = positionalArgs[0];
  const action = positionalArgs[1];
  const title = getOptionValue(args, '--title');
  const singleTaskTitle = getOptionValue(args, '--single-task');
  const priority = getOptionValue(args, '--priority');

  if (!namespace || !CHANGE_SUBCOMMANDS.has(namespace)) {
    return getInvalidChangeCommandError({ subcommand: namespace });
  }

  if (namespace === 'new') {
    const changeSlug = positionalArgs[1];
    if (!changeSlug) {
      return getInvalidChangeCommandError({
        subcommand: namespace,
        requiresSlug: true,
      });
    }

    return createChange(changeSlug, {
      title,
      singleTaskTitle,
      priority,
    });
  }

  if (!action || action !== 'set' && !(namespace === 'task' && action === 'add')) {
    return getInvalidChangeCommandError({ subcommand: `${namespace} ${action ?? ''}`.trim() });
  }

  const changeSlug = positionalArgs[2];
  if (!changeSlug) {
    return getInvalidChangeCommandError({
      subcommand: `${namespace} ${action}`,
      requiresSlug: true,
    });
  }

  if (namespace === 'plan' && action === 'set') {
    return await writeChangePlan(changeSlug, args);
  }

  if (namespace === 'spec' && action === 'set') {
    return await writeChangeSpec(changeSlug, args);
  }

  if (namespace === 'task' && action === 'add') {
    return await addChangeTask(changeSlug, args);
  }

  return getInvalidChangeCommandError({ subcommand: `${namespace} ${action}` });
}

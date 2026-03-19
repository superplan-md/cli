import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse } from './parse';

interface DoctorIssue {
  code: string;
  message: string;
  fix: string;
  task_id?: string;
}

interface ParsedTask {
  task_id: string;
  status: string;
  depends_on_all: string[];
  depends_on_any: string[];
  is_valid: boolean;
  issues: string[];
}

interface RuntimeTaskState {
  status: string;
}

interface RuntimeState {
  tasks: Record<string, RuntimeTaskState>;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasAtLeastOneFile(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && await directoryHasAtLeastOneFile(entryPath)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

async function readRuntimeState(runtimeFilePath: string): Promise<RuntimeState> {
  try {
    const content = await fs.readFile(runtimeFilePath, 'utf-8');
    const parsedContent = JSON.parse(content) as Partial<RuntimeState>;

    return {
      tasks: parsedContent.tasks ?? {},
    };
  } catch {
    return { tasks: {} };
  }
}

function getProjectAgents(baseDir: string): { name: string; path: string; skillsPath: string }[] {
  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      skillsPath: path.join(baseDir, '.claude', 'skills', 'using-superplan'),
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      skillsPath: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      skillsPath: path.join(baseDir, '.cursor', 'skills', 'using-superplan'),
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      skillsPath: path.join(baseDir, '.codex', 'skills', 'using-superplan'),
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.opencode'),
      skillsPath: path.join(baseDir, '.opencode', 'skills', 'using-superplan'),
    },
  ];
}

function getGlobalAgents(baseDir: string): { name: string; path: string; skillsPath: string }[] {
  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      skillsPath: path.join(baseDir, '.claude', 'skills', 'using-superplan', 'SKILL.md'),
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      skillsPath: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      skillsPath: path.join(baseDir, '.cursor', 'skills', 'using-superplan', 'SKILL.md'),
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      skillsPath: path.join(baseDir, '.codex', 'skills', 'using-superplan', 'SKILL.md'),
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      skillsPath: path.join(baseDir, '.config', 'opencode', 'skills', 'using-superplan', 'SKILL.md'),
    },
  ];
}

function applyRuntimeStatus(task: ParsedTask, runtimeTask?: RuntimeTaskState): ParsedTask {
  if (!runtimeTask) {
    return task;
  }

  return {
    ...task,
    status: runtimeTask.status,
  };
}

function getDependencyState(tasks: ParsedTask[], task: ParsedTask): {
  allDependenciesSatisfied: boolean;
  anyDependenciesSatisfied: boolean;
} {
  const doneTaskIds = new Set(
    tasks
      .filter(taskItem => taskItem.status === 'done')
      .map(taskItem => taskItem.task_id),
  );

  return {
    allDependenciesSatisfied: task.depends_on_all.every(dependsOnTaskId => doneTaskIds.has(dependsOnTaskId)),
    anyDependenciesSatisfied: task.depends_on_any.length === 0
      ? true
      : task.depends_on_any.some(dependsOnTaskId => doneTaskIds.has(dependsOnTaskId)),
  };
}

function getInProgressEntries(runtimeState: RuntimeState): [string, RuntimeTaskState][] {
  return Object.entries(runtimeState.tasks).filter(([, taskState]) => taskState.status === 'in_progress');
}

function getMissingDependencyIds(tasks: ParsedTask[], task: ParsedTask): string[] {
  const knownTaskIds = new Set(tasks.map(taskItem => taskItem.task_id).filter(Boolean));
  return [...task.depends_on_all, ...task.depends_on_any].filter(dependencyTaskId => !knownTaskIds.has(dependencyTaskId));
}

async function collectDeepIssues(cwd: string): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const parseResult = await parse([], { json: true });

  if (!parseResult.ok) {
    issues.push({
      code: 'DEEP_PARSE_FAILED',
      message: 'Unable to inspect task graph for deep doctor checks',
      fix: 'Run superplan parse --json and fix parse errors',
    });
    return issues;
  }

  const tasks = parseResult.data.tasks as ParsedTask[];
  const runtimePath = path.join(cwd, '.superplan', 'runtime', 'tasks.json');
  const runtimeState = await readRuntimeState(runtimePath);
  const mergedTasks = tasks.map(task => applyRuntimeStatus(task, runtimeState.tasks[task.task_id]));
  const taskMap = new Map(tasks.map(task => [task.task_id, task]));

  for (const task of tasks) {
    if (!task.is_valid) {
      issues.push({
        code: 'TASK_INVALID',
        message: `Task ${task.task_id || '(missing task_id)'} is invalid: ${task.issues.join(', ')}`,
        fix: 'Fix the task markdown before executing it',
        task_id: task.task_id || undefined,
      });
    }

    const missingDependencyIds = getMissingDependencyIds(tasks, task);
    if (missingDependencyIds.length > 0) {
      issues.push({
        code: 'BROKEN_DEPENDENCY',
        message: `Task ${task.task_id} references missing dependencies: ${missingDependencyIds.join(', ')}`,
        fix: 'Update the dependency list to reference valid tasks',
        task_id: task.task_id,
      });
    }
  }

  const inProgressEntries = getInProgressEntries(runtimeState);
  if (inProgressEntries.length > 1) {
    issues.push({
      code: 'RUNTIME_CONFLICT_MULTIPLE_IN_PROGRESS',
      message: 'Multiple tasks are currently in progress',
      fix: 'Run superplan task fix',
    });
  }

  for (const [taskId] of Object.entries(runtimeState.tasks)) {
    if (taskMap.has(taskId)) {
      continue;
    }

    issues.push({
      code: 'RUNTIME_CONFLICT_UNKNOWN_TASK',
      message: `Runtime state exists for unknown task ${taskId}`,
      fix: `Run superplan task reset ${taskId}`,
      task_id: taskId,
    });
  }

  for (const [taskId] of inProgressEntries) {
    const matchedTask = mergedTasks.find(task => task.task_id === taskId);

    if (!matchedTask || !matchedTask.is_valid) {
      issues.push({
        code: 'RUNTIME_CONFLICT_INVALID_IN_PROGRESS',
        message: `In-progress task ${taskId} is invalid`,
        fix: 'Run superplan task fix',
        task_id: taskId,
      });
      continue;
    }

    const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(mergedTasks, matchedTask);
    if (!allDependenciesSatisfied || !anyDependenciesSatisfied) {
      issues.push({
        code: 'RUNTIME_CONFLICT_DEPENDENCY_NOT_SATISFIED',
        message: `In-progress task ${taskId} has unsatisfied dependencies`,
        fix: 'Run superplan task fix',
        task_id: taskId,
      });
    }
  }

  return issues;
}

export async function doctor(args: string[] = []) {
  const issues: DoctorIssue[] = [];
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.config', 'superplan', 'config.toml');
  const skillsPath = path.join(homeDir, '.config', 'superplan', 'skills');
  const deep = args.includes('--deep');

  if (!await pathExists(configPath)) {
    issues.push({
      code: 'CONFIG_MISSING',
      message: 'Global config not found',
      fix: 'Run superplan setup',
    });
  }

  const skillsInstalled = await pathExists(skillsPath) && await directoryHasAtLeastOneFile(skillsPath);
  if (!skillsInstalled) {
    issues.push({
      code: 'SKILLS_MISSING',
      message: 'Global skills not installed',
      fix: 'Run superplan setup',
    });
  }

  const agents = [
    ...getGlobalAgents(homeDir),
    ...getProjectAgents(cwd),
  ];
  for (const agent of agents) {
    if (await pathExists(agent.path) && !await pathExists(agent.skillsPath)) {
      issues.push({
        code: 'AGENT_SKILLS_MISSING',
        message: `Superplan skills not installed for ${agent.name} agent`,
        fix: 'Run superplan setup in this repo',
      });
    }
  }

  if (deep) {
    issues.push(...await collectDeepIssues(cwd));
  }

  return {
    ok: true,
    data: {
      valid: issues.length === 0,
      issues,
    },
  };
}

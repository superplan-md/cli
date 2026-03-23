import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  AgentEnvironment,
  getSkillsFileCandidates,
  getSkillsNamespaceCandidates,
} from '../agent-integrations';
import { parse } from './parse';
import { inspectOverlayCompanionInstall } from '../overlay-companion';
import { readOverlayPreferences } from '../overlay-preferences';
import { resolveWorkspaceRoot } from '../workspace-root';
import { collectWorkspaceHealthIssues } from '../workspace-health';
import { commandNextAction, stopNextAction, type NextAction } from '../next-action';

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

function getProjectAgents(baseDir: string): (AgentEnvironment & { skillsPaths: string[] })[] {
  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      skillsPaths: getSkillsNamespaceCandidates(baseDir, '.claude', 'skills'),
      install_path: path.join(baseDir, '.claude', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      skillsPaths: [path.join(baseDir, '.gemini', 'commands', 'superplan.toml')],
      install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
      install_kind: 'toml_command',
      bootstrap_strength: 'context_bootstrap',
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      skillsPaths: getSkillsNamespaceCandidates(baseDir, '.cursor', 'skills'),
      install_path: path.join(baseDir, '.cursor', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      skillsPaths: getSkillsNamespaceCandidates(baseDir, '.codex', 'skills'),
      install_path: path.join(baseDir, '.codex', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.opencode'),
      skillsPaths: getSkillsNamespaceCandidates(baseDir, '.opencode', 'skills'),
      install_path: path.join(baseDir, '.opencode', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'amazonq',
      path: path.join(baseDir, '.amazonq'),
      skillsPaths: [
        path.join(baseDir, '.amazonq', 'rules', 'superplan-entry.md'),
        path.join(baseDir, '.amazonq', 'rules', 'memory-bank', 'guidelines.md'),
      ],
      install_path: path.join(baseDir, '.amazonq', 'rules'),
      install_kind: 'amazonq_rules',
      bootstrap_strength: 'rule_bootstrap',
    },
    {
      name: 'antigravity',
      path: path.join(baseDir, '.agents'),
      skillsPaths: [path.join(baseDir, '.agents', 'rules', 'superplan-entry.md')],
      install_path: path.join(baseDir, '.agents', 'rules', 'superplan-entry.md'),
      install_kind: 'markdown_rule',
      bootstrap_strength: 'rule_bootstrap',
    },
  ];
}

function getGlobalAgents(baseDir: string): (AgentEnvironment & { skillsPaths: string[] })[] {
  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      skillsPaths: getSkillsFileCandidates(baseDir, '.claude', 'skills'),
      install_path: path.join(baseDir, '.claude', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      skillsPaths: [path.join(baseDir, '.gemini', 'commands', 'superplan.toml')],
      install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
      install_kind: 'toml_command',
      bootstrap_strength: 'context_bootstrap',
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      skillsPaths: getSkillsFileCandidates(baseDir, '.cursor', 'skills'),
      install_path: path.join(baseDir, '.cursor', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      skillsPaths: getSkillsFileCandidates(baseDir, '.codex', 'skills'),
      install_path: path.join(baseDir, '.codex', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      skillsPaths: getSkillsFileCandidates(baseDir, '.config', 'opencode', 'skills'),
      install_path: path.join(baseDir, '.config', 'opencode', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
    },
    {
      name: 'antigravity',
      path: path.join(baseDir, '.gemini'),
      skillsPaths: [path.join(baseDir, '.gemini', 'GEMINI.md')],
      install_path: path.join(baseDir, '.gemini', 'GEMINI.md'),
      install_kind: 'managed_global_rule',
      bootstrap_strength: 'rule_bootstrap',
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
      fix: 'superplan task repair fix --json',
    });
  }

  for (const [taskId] of Object.entries(runtimeState.tasks)) {
    if (taskMap.has(taskId)) {
      continue;
    }

    issues.push({
      code: 'RUNTIME_CONFLICT_UNKNOWN_TASK',
      message: `Runtime state exists for unknown task ${taskId}`,
      fix: `superplan task repair reset ${taskId} --json`,
      task_id: taskId,
    });
  }

  for (const [taskId] of inProgressEntries) {
    const matchedTask = mergedTasks.find(task => task.task_id === taskId);

    if (!matchedTask || !matchedTask.is_valid) {
      issues.push({
        code: 'RUNTIME_CONFLICT_INVALID_IN_PROGRESS',
        message: `In-progress task ${taskId} is invalid`,
        fix: 'superplan task repair fix --json',
        task_id: taskId,
      });
      continue;
    }

    const { allDependenciesSatisfied, anyDependenciesSatisfied } = getDependencyState(mergedTasks, matchedTask);
    if (!allDependenciesSatisfied || !anyDependenciesSatisfied) {
      issues.push({
        code: 'RUNTIME_CONFLICT_DEPENDENCY_NOT_SATISFIED',
        message: `In-progress task ${taskId} has unsatisfied dependencies`,
        fix: 'superplan task repair fix --json',
        task_id: taskId,
      });
    }
  }

  return issues;
}

export async function doctor(args: string[] = []) {
  const issues: DoctorIssue[] = [];
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const homeDir = os.homedir();
  const configPath = path.join(homeDir, '.config', 'superplan', 'config.toml');
  const skillsPath = path.join(homeDir, '.config', 'superplan', 'skills');
  const deep = args.includes('--deep');
  const overlayPreferences = await readOverlayPreferences(workspaceRoot);
  const overlayCompanion = await inspectOverlayCompanionInstall();

  if (!await pathExists(configPath)) {
    issues.push({
      code: 'CONFIG_MISSING',
      message: 'Global config not found',
      fix: 'Run superplan install --quiet --json',
    });
  }

  const skillsInstalled = await pathExists(skillsPath) && await directoryHasAtLeastOneFile(skillsPath);
  if (!skillsInstalled) {
    issues.push({
      code: 'SKILLS_MISSING',
      message: 'Global skills not installed',
      fix: 'Run superplan install --quiet --json',
    });
  }

  const agents = [
    ...getGlobalAgents(homeDir),
    ...getProjectAgents(workspaceRoot),
  ];
  for (const agent of agents) {
    const hasInstalledSkills = (await Promise.all(agent.skillsPaths.map(candidatePath => pathExists(candidatePath)))).some(Boolean);
    if (await pathExists(agent.path) && !hasInstalledSkills) {
      issues.push({
        code: 'AGENT_SKILLS_MISSING',
        message: `Superplan skills not installed for ${agent.name} agent`,
        fix: 'Run superplan install --quiet --json',
      });
      continue;
    }

  }

  if (overlayPreferences.effective_enabled && !overlayCompanion.launchable) {
    issues.push({
      code: 'OVERLAY_COMPANION_UNAVAILABLE',
      message: overlayCompanion.message || 'Overlay companion is enabled but no launchable install was found.',
      fix: 'Reinstall Superplan with the bundled overlay companion',
    });
  } else if (overlayCompanion.configured && !overlayCompanion.launchable) {
    issues.push({
      code: 'OVERLAY_COMPANION_BROKEN',
      message: overlayCompanion.message || 'Overlay companion install is present but not launchable.',
      fix: 'Reinstall Superplan to restore the overlay companion',
    });
  }

  issues.push(...await collectWorkspaceHealthIssues(workspaceRoot));

  if (deep) {
    issues.push(...await collectDeepIssues(workspaceRoot));
  }

  return {
    ok: true,
    data: {
      valid: issues.length === 0,
      issues,
      message: issues.length === 0 ? 'System is healthy.' : `Found ${issues.length} health issues.`,
      next_action: issues.length === 0
        ? commandNextAction(
          'superplan status --json',
          'Install and workspace health checks passed, so the next useful step is continuing tracked work.',
        )
        : (
          issues[0]?.fix
            ? commandNextAction(
              issues[0].fix,
              `The first blocking health issue is ${issues[0].code}, so apply its recommended fix before continuing.`,
            )
            : stopNextAction(
              'Resolve the reported health issues before relying on Superplan state.',
              'Health checks found blocking issues and no single automated fix was available.',
            )
        ),
    },
  };
}

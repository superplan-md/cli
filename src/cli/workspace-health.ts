import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, type ParseDiagnostic, type ParsedTask } from './commands/parse';
import { getTaskRef } from './task-identity';
import { getWorkspaceArtifactPaths } from './workspace-artifacts';

const execFile = promisify(execFileCallback);

export interface WorkspaceHealthIssue {
  code: string;
  message: string;
  fix: string;
  task_id?: string;
}

interface RuntimeTaskState {
  status: string;
}

interface RuntimeChangeState {
  active_task_ref?: string | null;
  tasks?: Record<string, RuntimeTaskState>;
}

interface RuntimeState {
  changes?: Record<string, RuntimeChangeState>;
  tasks?: Record<string, RuntimeTaskState>;
}

interface NormalizedRuntimeState {
  tasksByRef: Map<string, RuntimeTaskState>;
  activeTaskRef: string | null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readRuntimeState(runtimeFilePath: string): Promise<RuntimeState> {
  try {
    const content = await fs.readFile(runtimeFilePath, 'utf-8');
    return JSON.parse(content) as RuntimeState;
  } catch {
    return {};
  }
}

async function getChangeDirs(changesRoot: string): Promise<string[]> {
  if (!await pathExists(changesRoot)) {
    return [];
  }

  const entries = await fs.readdir(changesRoot, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(changesRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeRuntimeState(rawState: RuntimeState, tasks: ParsedTask[]): NormalizedRuntimeState {
  const tasksByRef = new Map<string, RuntimeTaskState>();
  const taskRefsByLocalId = new Map<string, string[]>();

  for (const task of tasks) {
    const taskRef = getTaskRef(task);
    const matches = taskRefsByLocalId.get(task.task_id) ?? [];
    matches.push(taskRef);
    taskRefsByLocalId.set(task.task_id, matches);
  }

  let activeTaskRef: string | null = null;

  if (rawState.changes) {
    for (const [changeId, changeState] of Object.entries(rawState.changes)) {
      for (const [taskId, runtimeTask] of Object.entries(changeState.tasks ?? {})) {
        const taskRef = `${changeId}/${taskId}`;
        tasksByRef.set(taskRef, runtimeTask);
        if (runtimeTask.status === 'in_progress' && !activeTaskRef) {
          activeTaskRef = changeState.active_task_ref === taskRef ? taskRef : taskRef;
        }
      }
    }

    return { tasksByRef, activeTaskRef };
  }

  for (const [rawTaskId, runtimeTask] of Object.entries(rawState.tasks ?? {})) {
    let taskRef = rawTaskId;

    if (!rawTaskId.includes('/')) {
      const matches = taskRefsByLocalId.get(rawTaskId) ?? [];
      if (matches.length !== 1) {
        continue;
      }
      [taskRef] = matches;
    }

    tasksByRef.set(taskRef, runtimeTask);
    if (runtimeTask.status === 'in_progress' && !activeTaskRef) {
      activeTaskRef = taskRef;
    }
  }

  return { tasksByRef, activeTaskRef };
}

function taskStateIssues(task: ParsedTask, runtimeTask: RuntimeTaskState | undefined): WorkspaceHealthIssue[] {
  const issues: WorkspaceHealthIssue[] = [];
  const allCriteriaDone = task.total_acceptance_criteria > 0
    && task.completed_acceptance_criteria === task.total_acceptance_criteria;
  const acceptanceIncomplete = task.total_acceptance_criteria > 0
    && task.completed_acceptance_criteria < task.total_acceptance_criteria;
  const runtimeStatus = runtimeTask?.status;

  if (allCriteriaDone && task.status === 'pending') {
    const taskRef = getTaskRef(task);
    issues.push({
      code: 'TASK_STATE_DRIFT_PENDING_WITH_COMPLETED_ACCEPTANCE',
      message: `Task ${task.task_id} still says pending even though all acceptance criteria are checked.`,
      fix: `Run superplan task review complete ${taskRef} --json or update the task contract status intentionally.`,
      task_id: task.task_id,
    });
  }

  if (runtimeStatus === 'done' && acceptanceIncomplete) {
    issues.push({
      code: 'TASK_STATE_DRIFT_RUNTIME_DONE_WITH_INCOMPLETE_ACCEPTANCE',
      message: `Runtime state marks ${task.task_id} done while its acceptance criteria are still incomplete.`,
      fix: `Update ${task.task_id} acceptance criteria or reset its runtime state before continuing.`,
      task_id: task.task_id,
    });
  }

  if (task.status === 'done' && acceptanceIncomplete) {
    issues.push({
      code: 'TASK_STATE_DRIFT_MARKDOWN_DONE_WITH_INCOMPLETE_ACCEPTANCE',
      message: `Task ${task.task_id} says done in markdown while its acceptance criteria are incomplete.`,
      fix: `Finish the acceptance criteria or change the task status before treating it as done.`,
      task_id: task.task_id,
    });
  }

  return issues;
}

async function getGitChangedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFile('git', ['-C', workspaceRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: workspaceRoot,
    });

    return stdout
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => {
        const rawPath = line.slice(3);
        const renameSeparator = rawPath.indexOf(' -> ');
        return renameSeparator === -1 ? rawPath : rawPath.slice(renameSeparator + 4);
      })
      .map(filePath => filePath.replace(/\\/g, '/'))
      .filter(filePath => filePath && !filePath.startsWith('.superplan/runtime/'));
  } catch {
    return [];
  }
}

function normalizeScopePath(workspaceRoot: string, scopePath: string): string {
  const absolutePath = path.isAbsolute(scopePath)
    ? scopePath
    : path.resolve(workspaceRoot, scopePath);
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/').replace(/\/+$/, '');
}

function fileMatchesScope(filePath: string, scopePath: string): boolean {
  return filePath === scopePath || filePath.startsWith(`${scopePath}/`);
}

function buildEditDriftIssues(
  workspaceRoot: string,
  tasks: ParsedTask[],
  runtimeState: NormalizedRuntimeState,
  changedFiles: string[],
): WorkspaceHealthIssue[] {
  if (changedFiles.length === 0) {
    return [];
  }

  const activeTask = runtimeState.activeTaskRef
    ? tasks.find(task => getTaskRef(task) === runtimeState.activeTaskRef)
    : undefined;

  if (!activeTask) {
    return [{
      code: 'WORKSPACE_EDITS_WITHOUT_ACTIVE_TASK',
      message: `Workspace has ${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'} but no active claimed task.`,
      fix: 'Run superplan run --json to claim work before editing, or clean up the existing diff intentionally.',
    }];
  }

  const scopePaths = activeTask.task_recipe.scope_paths
    .map(scopePath => normalizeScopePath(workspaceRoot, scopePath))
    .filter(Boolean);

  if (scopePaths.length === 0) {
    return [];
  }

  const allowedPaths = new Set<string>();
  if (activeTask.task_file_path) {
    allowedPaths.add(normalizeScopePath(workspaceRoot, activeTask.task_file_path));
  }
  for (const scopePath of scopePaths) {
    allowedPaths.add(scopePath);
  }

  const outOfScopeFiles = changedFiles.filter(filePath => {
    if (filePath.startsWith('.superplan/changes/')) {
      return false;
    }

    for (const allowedPath of allowedPaths) {
      if (fileMatchesScope(filePath, allowedPath)) {
        return false;
      }
    }

    return true;
  });

  if (outOfScopeFiles.length === 0) {
    return [];
  }

  return [{
    code: 'WORKSPACE_EDIT_SCOPE_DRIFT',
    message: `Active task ${activeTask.task_id} has scoped edits, but changed files fall outside that scope: ${outOfScopeFiles.join(', ')}`,
    fix: `Update ${activeTask.task_id} scope bullets or move the drifted edits into the correct tracked task before continuing.`,
    task_id: activeTask.task_id,
  }];
}

export async function collectWorkspaceHealthIssues(workspaceRoot: string): Promise<WorkspaceHealthIssue[]> {
  const superplanRoot = path.join(workspaceRoot, '.superplan');
  if (!await pathExists(superplanRoot)) {
    return [];
  }

  const artifactPaths = getWorkspaceArtifactPaths(superplanRoot);
  const issues: WorkspaceHealthIssue[] = [];
  const requiredArtifacts = [
    { code: 'WORKSPACE_CONTEXT_README_MISSING', filePath: artifactPaths.contextReadmePath, fix: 'Run superplan context bootstrap --json' },
    { code: 'WORKSPACE_CONTEXT_INDEX_MISSING', filePath: artifactPaths.contextIndexPath, fix: 'Run superplan context bootstrap --json' },
    { code: 'WORKSPACE_DECISIONS_LOG_MISSING', filePath: artifactPaths.decisionsPath, fix: 'Run superplan context bootstrap --json' },
    { code: 'WORKSPACE_GOTCHAS_LOG_MISSING', filePath: artifactPaths.gotchasPath, fix: 'Run superplan context bootstrap --json' },
  ];

  for (const artifact of requiredArtifacts) {
    if (await pathExists(artifact.filePath)) {
      continue;
    }

    issues.push({
      code: artifact.code,
      message: `Missing workspace artifact: ${path.relative(workspaceRoot, artifact.filePath) || artifact.filePath}`,
      fix: artifact.fix,
    });
  }

  const changeDirs = await getChangeDirs(path.join(superplanRoot, 'changes'));
  const parsedTasks: ParsedTask[] = [];

  for (const changeDir of changeDirs) {
    const parsedResult = await parse([changeDir], { json: true });
    if (!parsedResult.ok) {
      issues.push({
        code: 'WORKSPACE_PARSE_FAILED',
        message: `Unable to inspect ${path.basename(changeDir)} for workspace health.`,
        fix: `Run superplan validate ${path.basename(changeDir)} --json and fix parse errors.`,
      });
      continue;
    }

    for (const diagnostic of parsedResult.data.diagnostics) {
      issues.push({
        code: diagnostic.code,
        message: diagnostic.message,
        fix: 'Fix the reported task contract issue.',
        ...(diagnostic.task_id ? { task_id: diagnostic.task_id } : {}),
      });
    }

    parsedTasks.push(...parsedResult.data.tasks);
  }

  const runtimeState = normalizeRuntimeState(
    await readRuntimeState(path.join(superplanRoot, 'runtime', 'tasks.json')),
    parsedTasks,
  );

  for (const task of parsedTasks) {
    issues.push(...taskStateIssues(task, runtimeState.tasksByRef.get(getTaskRef(task))));
  }

  issues.push(...buildEditDriftIssues(
    workspaceRoot,
    parsedTasks,
    runtimeState,
    await getGitChangedFiles(workspaceRoot),
  ));

  return issues;
}

export function workspaceIssuesToDiagnostics(issues: WorkspaceHealthIssue[]): ParseDiagnostic[] {
  return issues.map(issue => ({
    code: issue.code,
    message: issue.message,
    ...(issue.task_id ? { task_id: issue.task_id } : {}),
  }));
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { parse, type ParseDiagnostic, type ParsedTask } from './commands/parse';
import { getWorkspaceArtifactPaths } from './workspace-artifacts';

export interface WorkspaceHealthIssue {
  code: string;
  message: string;
  fix: string;
  task_id?: string;
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

function taskStateIssues(task: ParsedTask, runtimeTask: RuntimeTaskState | undefined): WorkspaceHealthIssue[] {
  const issues: WorkspaceHealthIssue[] = [];
  const allCriteriaDone = task.total_acceptance_criteria > 0
    && task.completed_acceptance_criteria === task.total_acceptance_criteria;
  const acceptanceIncomplete = task.total_acceptance_criteria > 0
    && task.completed_acceptance_criteria < task.total_acceptance_criteria;
  const runtimeStatus = runtimeTask?.status;

  if (allCriteriaDone && task.status === 'pending') {
    issues.push({
      code: 'TASK_STATE_DRIFT_PENDING_WITH_COMPLETED_ACCEPTANCE',
      message: `Task ${task.task_id} still says pending even though all acceptance criteria are checked.`,
      fix: `Run superplan task complete ${task.task_id} --json or update the task contract status intentionally.`,
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
    { code: 'WORKSPACE_PLAN_MISSING', filePath: artifactPaths.planPath, fix: 'Run superplan context bootstrap --json' },
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

  const runtimeState = await readRuntimeState(path.join(superplanRoot, 'runtime', 'tasks.json'));
  const changeDirs = await getChangeDirs(path.join(superplanRoot, 'changes'));

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

    for (const task of parsedResult.data.tasks) {
      issues.push(...taskStateIssues(task, runtimeState.tasks[task.task_id]));
    }
  }

  return issues;
}

export function workspaceIssuesToDiagnostics(issues: WorkspaceHealthIssue[]): ParseDiagnostic[] {
  return issues.map(issue => ({
    code: issue.code,
    message: issue.message,
    ...(issue.task_id ? { task_id: issue.task_id } : {}),
  }));
}

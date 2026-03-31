import { activateTask, selectNextTask, type ParsedTask, loadTasks } from './task';
import { findExecutionRootForChange, getCurrentExecutionRootRecord } from '../execution-roots';
import type { OverlayRuntimeNotice } from '../overlay-visibility';
import { getQueueNextAction, stopNextAction, type NextAction } from '../next-action';
import { getTaskRef } from '../task-identity';
import { detectWorkflowSurfaces, type WorkflowSurfaceSummary } from '../workflow-surfaces';

interface RunDeps {
  selectNextTaskFn: typeof selectNextTask;
  activateTaskFn: typeof activateTask;
}

interface ActiveTaskContext {
  task_ref: string;
  task_id: string;
  change_id: string | null;
  task_file_path: string | null;
  task_contract_present: boolean;
  execution_root: {
    path: string | null;
    kind: 'primary' | 'worktree' | null;
    attached_change_id: string | null;
    current: boolean;
  };
  environment: Record<string, string>;
  edit_gate: {
    claimed: true;
    can_edit: boolean;
    requires_task_contract: true;
  };
  execution_handoff: {
    planning_authority: 'repo_harness_first' | 'superplan';
    execution_authority: 'superplan';
    verification_authority: 'repo_harness_first' | 'superplan_defaults';
    workflow_surfaces: WorkflowSurfaceSummary;
    guidance: string[];
  };
}

export type RunResult =
  | {
      ok: true;
      data: {
        task_id: string | null;
        action: 'activated' | 'idle' | 'batch_activated' | 'start' | 'resume' | 'continue';
        status: string | null;
        task: ParsedTask | null;
        active_task_context?: ActiveTaskContext | null;
        reason: string;
        next_action: NextAction;
        overlay?: OverlayRuntimeNotice;
        // Batch activation results
        batch_results?: Array<{
          task_id: string;
          status: string;
          task: ParsedTask;
          active_task_context: ActiveTaskContext | null;
        }>;
        batch_count?: number;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--json' && arg !== '--quiet' && arg !== '--all-ready' && arg !== '--fresh');
}

function hasAllReadyFlag(args: string[]): boolean {
  return args.includes('--all-ready');
}

function hasFreshFlag(args: string[]): boolean {
  return args.includes('--fresh');
}

function getInvalidRunCommandError(): RunResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_RUN_COMMAND',
      message: [
        'Run accepts at most one optional <task_ref>, or one selector flag: --fresh or --all-ready.',
        '',
        'Usage:',
        '  superplan run',
        '  superplan run --fresh',
        '  superplan run <task_ref>',
        '  superplan run --all-ready',
      ].join('\n'),
      retryable: true,
    },
  };
}

async function buildActiveTaskContext(task: ParsedTask, workflowSurfaces: WorkflowSurfaceSummary): Promise<ActiveTaskContext> {
  const taskRef = getTaskRef(task);
  const currentExecutionRoot = await getCurrentExecutionRootRecord();
  const attachedExecutionRoot = task.change_id
    ? await findExecutionRootForChange(task.change_id)
    : null;
  const effectiveExecutionRoot = attachedExecutionRoot ?? currentExecutionRoot;
  const environment: Record<string, string> = {
    SUPERPLAN_ACTIVE_TASK: taskRef,
    SUPERPLAN_ACTIVE_TASK_ID: task.task_id,
  };

  if (task.change_id) {
    environment.SUPERPLAN_ACTIVE_CHANGE = task.change_id;
  }

  if (task.task_file_path) {
    environment.SUPERPLAN_ACTIVE_TASK_FILE = task.task_file_path;
  }

  if (effectiveExecutionRoot?.path) {
    environment.SUPERPLAN_EXECUTION_ROOT = effectiveExecutionRoot.path;
  }

  if (effectiveExecutionRoot?.kind) {
    environment.SUPERPLAN_EXECUTION_ROOT_KIND = effectiveExecutionRoot.kind;
  }

  return {
    task_ref: taskRef,
    task_id: task.task_id,
    change_id: task.change_id ?? null,
    task_file_path: task.task_file_path ?? null,
    task_contract_present: Boolean(task.task_file_path),
    execution_root: {
      path: effectiveExecutionRoot?.path ?? null,
      kind: effectiveExecutionRoot?.kind ?? null,
      attached_change_id: effectiveExecutionRoot?.attached_change_id ?? null,
      current: Boolean(effectiveExecutionRoot?.path && currentExecutionRoot?.path === effectiveExecutionRoot.path),
    },
    environment,
    edit_gate: {
      claimed: true,
      can_edit: Boolean(task.task_file_path),
      requires_task_contract: true,
    },
    execution_handoff: {
      planning_authority: workflowSurfaces.planning_surfaces.length > 0 ? 'repo_harness_first' : 'superplan',
      execution_authority: 'superplan',
      verification_authority: workflowSurfaces.verification_surfaces.length > 0 ? 'repo_harness_first' : 'superplan_defaults',
      workflow_surfaces: workflowSurfaces,
      guidance: [
        'Use detected repo-native planning surfaces before execution when they exist.',
        'After planning is settled, Superplan owns task execution, lifecycle, and completion state.',
        'Use repo-native verification surfaces before generic defaults when proving acceptance criteria.',
      ],
    },
  };
}

async function buildRunResultFromActivation(
  activationResult: Awaited<ReturnType<typeof activateTask>>,
  workflowSurfaces: WorkflowSurfaceSummary,
): Promise<RunResult> {
  if (!activationResult.ok) {
    return activationResult;
  }

  return {
    ok: true,
    data: {
        task_id: activationResult.data.task_id,
        action: activationResult.data.action,
        status: activationResult.data.status,
        task: activationResult.data.task,
        active_task_context: await buildActiveTaskContext(activationResult.data.task, workflowSurfaces),
        reason: activationResult.data.reason,
        next_action: stopNextAction(
          `Task ${activationResult.data.task_id} is active. Continue implementation until it is completed, blocked, or waiting for feedback.`,
        'The task is active now, so the next step is execution rather than another control-plane command.',
      ),
      ...('overlay' in activationResult.data && activationResult.data.overlay
        ? { overlay: activationResult.data.overlay }
        : {}),
    },
  };
}

async function runAllReady(runtimeDeps: RunDeps, workflowSurfaces: WorkflowSurfaceSummary): Promise<RunResult> {
  const tasksResult = await loadTasks();
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const tasks = tasksResult.data.tasks as ParsedTask[];
  const readyTasks = tasks.filter(taskItem => taskItem.is_ready);

  if (readyTasks.length === 0) {
    return {
      ok: true,
      data: {
        task_id: null,
        action: 'idle',
        status: null,
        task: null,
        reason: 'No ready tasks available for batch activation',
        next_action: getQueueNextAction({
          active: null,
          ready: [],
          in_review: [],
          blocked: [],
          needs_feedback: [],
        }),
      },
    };
  }

  // Activate all ready tasks in parallel
  const batchResults: Array<{
    task_id: string;
    status: string;
    task: ParsedTask;
    active_task_context: ActiveTaskContext | null;
  }> = [];

  for (const task of readyTasks) {
    const activationResult = await runtimeDeps.activateTaskFn(task.task_id, 'run');
    if (activationResult.ok) {
      batchResults.push({
        task_id: activationResult.data.task_id,
        status: activationResult.data.status,
        task: activationResult.data.task,
        active_task_context: await buildActiveTaskContext(activationResult.data.task, workflowSurfaces),
      });
    }
  }

  if (batchResults.length === 0) {
    return {
      ok: false,
      error: {
        code: 'BATCH_ACTIVATION_FAILED',
        message: 'Failed to activate any ready tasks',
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    data: {
      task_id: null,
      action: 'batch_activated',
      status: 'ready',
      task: null,
      reason: `Activated ${batchResults.length} tasks in batch mode`,
      batch_results: batchResults,
      batch_count: batchResults.length,
      next_action: getQueueNextAction({
        active: null,
        ready: batchResults.map(r => r.task_id),
        in_review: [],
        blocked: [],
        needs_feedback: [],
      }),
    },
  };
}

export async function run(args: string[] = [], deps: Partial<RunDeps> = {}): Promise<RunResult> {
  const runtimeDeps: RunDeps = {
    selectNextTaskFn: selectNextTask,
    activateTaskFn: activateTask,
    ...deps,
  };
  const positionalArgs = getPositionalArgs(args);
  const allReadyFlag = hasAllReadyFlag(args);
  const freshFlag = hasFreshFlag(args);

  if (positionalArgs.length > 1 || (freshFlag && allReadyFlag)) {
    return getInvalidRunCommandError();
  }

  const workflowSurfaces = await detectWorkflowSurfaces(process.cwd());

  const explicitTaskId = positionalArgs[0];
  if (explicitTaskId) {
    if (freshFlag || allReadyFlag) {
      return getInvalidRunCommandError();
    }

    return await buildRunResultFromActivation(await runtimeDeps.activateTaskFn(explicitTaskId, 'run'), workflowSurfaces);
  }

  // Handle --all-ready batch activation
  if (allReadyFlag) {
    return runAllReady(runtimeDeps, workflowSurfaces);
  }

  const nextTaskResult = await runtimeDeps.selectNextTaskFn({ fresh: freshFlag });
  if (!nextTaskResult.ok) {
    return nextTaskResult;
  }

  if (
    !('task_id' in nextTaskResult.data)
    || !('status' in nextTaskResult.data)
    || !('task' in nextTaskResult.data)
    || !('reason' in nextTaskResult.data)
  ) {
    return {
      ok: false,
      error: {
        code: 'RUN_FAILED',
        message: 'Unexpected task next result',
        retryable: false,
      },
    };
  }

  if (nextTaskResult.data.task_id === null) {
    const activeTaskIds = Array.isArray(nextTaskResult.data.active_task_ids)
      ? nextTaskResult.data.active_task_ids.filter((taskId): taskId is string => typeof taskId === 'string' && taskId.trim() !== '')
      : [];

    if (activeTaskIds.length > 0) {
      const outcome = activeTaskIds.length === 1
        ? `Task ${activeTaskIds[0]} is already in progress. Resume it explicitly with "superplan run ${activeTaskIds[0]} --json" if that is the intended work, or block/complete it before starting different work.`
        : `Tasks ${activeTaskIds.join(', ')} are already in progress. Resume the intended one explicitly with "superplan run <task_ref> --json" or resolve them before starting different work.`;

      return {
        ok: true,
        data: {
          task_id: null,
          action: 'idle',
          status: null,
          task: null,
          active_task_context: null,
          reason: nextTaskResult.data.reason,
          next_action: stopNextAction(
            outcome,
            'Bare run now only picks up new ready work. It does not auto-resume existing in-progress tasks because that can hijack a fresh request.',
          ),
        },
      };
    }

    return {
      ok: true,
      data: {
        task_id: null,
        action: 'idle',
        status: null,
        task: null,
        active_task_context: null,
        reason: nextTaskResult.data.reason,
        next_action: getQueueNextAction({
          active: null,
          ready: [],
          in_review: [],
          blocked: [],
          needs_feedback: [],
        }),
      },
    };
  }

  if (nextTaskResult.data.status === 'in_progress' || nextTaskResult.data.status === 'ready') {
    const activationResult = await runtimeDeps.activateTaskFn(nextTaskResult.data.task_id, 'run');
    if (!activationResult.ok) {
      return activationResult;
    }

    return {
      ok: true,
      data: {
        task_id: activationResult.data.task_id,
        action: activationResult.data.action,
        status: activationResult.data.status,
        task: activationResult.data.task,
        active_task_context: await buildActiveTaskContext(activationResult.data.task, workflowSurfaces),
        reason: nextTaskResult.data.reason,
        next_action: stopNextAction(
          `Task ${activationResult.data.task_id} is active. Continue implementation until it is completed, blocked, or waiting for feedback.`,
          'The task has been activated, so the next step is execution rather than another control-plane command.',
        ),
        ...('overlay' in activationResult.data && activationResult.data.overlay
          ? { overlay: activationResult.data.overlay }
          : {}),
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'RUN_FAILED',
      message: 'Unexpected task next status',
      retryable: false,
    },
  };
}

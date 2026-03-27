import { activateTask, selectNextTask, type ParsedTask } from './task';
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
        action: 'start' | 'resume' | 'continue' | 'idle';
        status: 'in_progress' | null;
        task: ParsedTask | null;
        active_task_context?: ActiveTaskContext | null;
        reason: string;
        next_action: NextAction;
        overlay?: OverlayRuntimeNotice;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--json' && arg !== '--quiet');
}

function getInvalidRunCommandError(): RunResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_RUN_COMMAND',
      message: [
        'Run accepts at most one optional <task_id>.',
        '',
        'Usage:',
        '  superplan run',
        '  superplan run <task_id>',
      ].join('\n'),
      retryable: true,
    },
  };
}

function buildActiveTaskContext(task: ParsedTask, workflowSurfaces: WorkflowSurfaceSummary): ActiveTaskContext {
  const taskRef = getTaskRef(task);
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

  return {
    task_ref: taskRef,
    task_id: task.task_id,
    change_id: task.change_id ?? null,
    task_file_path: task.task_file_path ?? null,
    task_contract_present: Boolean(task.task_file_path),
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

function buildRunResultFromActivation(
  activationResult: Awaited<ReturnType<typeof activateTask>>,
  workflowSurfaces: WorkflowSurfaceSummary,
): RunResult {
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
        active_task_context: buildActiveTaskContext(activationResult.data.task, workflowSurfaces),
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

export async function run(args: string[] = [], deps: Partial<RunDeps> = {}): Promise<RunResult> {
  const runtimeDeps: RunDeps = {
    selectNextTaskFn: selectNextTask,
    activateTaskFn: activateTask,
    ...deps,
  };
  const positionalArgs = getPositionalArgs(args);

  if (positionalArgs.length > 1) {
    return getInvalidRunCommandError();
  }

  const workflowSurfaces = await detectWorkflowSurfaces(process.cwd());

  const explicitTaskId = positionalArgs[0];
  if (explicitTaskId) {
    return buildRunResultFromActivation(await runtimeDeps.activateTaskFn(explicitTaskId, 'run'), workflowSurfaces);
  }

  const nextTaskResult = await runtimeDeps.selectNextTaskFn();
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
        active_task_context: buildActiveTaskContext(activationResult.data.task, workflowSurfaces),
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

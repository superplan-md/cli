import { parse } from './parse';
import { status } from './status';
import { loadTasks, task } from './task';
import { refreshOverlaySnapshot } from '../overlay-runtime';
import { getQueueNextAction, type NextAction } from '../next-action';

interface SyncDiagnostic {
  code: string;
  message: string;
  task_id?: string;
}

interface SyncFixAction {
  task_id: string;
  action: 'reset' | 'block' | 'migrate';
  reason?: string;
  to_task_id?: string;
}

interface SyncDeps {
  loadTasksFn: typeof loadTasks;
  parseFn: typeof parse;
  taskFn: typeof task;
  statusFn: typeof status;
}

export type SyncResult =
  | {
      ok: true;
      data: {
        parsed_tasks: number;
        diagnostics: SyncDiagnostic[];
        runtime_fixed: boolean;
        actions: SyncFixAction[];
        active: string | null;
        ready: string[];
        in_review: string[];
        blocked: string[];
        needs_feedback: string[];
        message: string;
        next_action: NextAction;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export async function sync(deps: Partial<SyncDeps> = {}): Promise<SyncResult> {
  const runtimeDeps: SyncDeps = {
    loadTasksFn: loadTasks,
    parseFn: parse,
    taskFn: task,
    statusFn: status,
    ...deps,
  };

  const parseResult = await runtimeDeps.parseFn([], { json: true });
  if (!parseResult.ok) {
    return parseResult;
  }

  const fixResult = await runtimeDeps.taskFn(['repair', 'fix']);
  if (!fixResult.ok) {
    return fixResult;
  }

  if (!('fixed' in fixResult.data) || !('actions' in fixResult.data)) {
    return {
      ok: false,
      error: {
        code: 'SYNC_FAILED',
        message: 'Unexpected runtime repair result',
        retryable: false,
      },
    };
  }

  const runtimeFixed = fixResult.data.fixed;
  const actions = fixResult.data.actions;
  if (typeof runtimeFixed !== 'boolean' || !Array.isArray(actions)) {
    return {
      ok: false,
      error: {
        code: 'SYNC_FAILED',
        message: 'Unexpected runtime repair result',
        retryable: false,
      },
    };
  }

  const statusResult = await runtimeDeps.statusFn();
  if (!statusResult.ok) {
    return statusResult;
  }

  const tasksResult = await runtimeDeps.loadTasksFn();
  if (!tasksResult.ok) {
    return tasksResult;
  }

  await refreshOverlaySnapshot(tasksResult.data.tasks);

  return {
    ok: true,
    data: {
      parsed_tasks: parseResult.data.tasks.length,
      diagnostics: parseResult.data.diagnostics,
      runtime_fixed: runtimeFixed,
      actions,
      active: statusResult.data.active,
      ready: statusResult.data.ready,
      in_review: statusResult.data.in_review,
      blocked: statusResult.data.blocked,
      needs_feedback: statusResult.data.needs_feedback,
      message: `Sync completed: ${parseResult.data.tasks.length} tasks parsed, ${actions.length} runtime fixes applied.`,
      next_action: getQueueNextAction({
        active: statusResult.data.active,
        ready: statusResult.data.ready,
        in_review: statusResult.data.in_review,
        blocked: statusResult.data.blocked,
        needs_feedback: statusResult.data.needs_feedback,
      }),
    },
  };
}

import { parse } from './parse';
import { status } from './status';
import { task } from './task';

interface SyncDiagnostic {
  code: string;
  message: string;
  task_id?: string;
}

interface SyncFixAction {
  task_id: string;
  action: 'reset' | 'block';
  reason?: string;
}

interface SyncDeps {
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
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export async function sync(deps: Partial<SyncDeps> = {}): Promise<SyncResult> {
  const runtimeDeps: SyncDeps = {
    parseFn: parse,
    taskFn: task,
    statusFn: status,
    ...deps,
  };

  const parseResult = await runtimeDeps.parseFn([], { json: true });
  if (!parseResult.ok) {
    return parseResult;
  }

  const fixResult = await runtimeDeps.taskFn(['fix']);
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

  const statusResult = await runtimeDeps.statusFn();
  if (!statusResult.ok) {
    return statusResult;
  }

  return {
    ok: true,
    data: {
      parsed_tasks: parseResult.data.tasks.length,
      diagnostics: parseResult.data.diagnostics,
      runtime_fixed: fixResult.data.fixed,
      actions: fixResult.data.actions,
      active: statusResult.data.active,
      ready: statusResult.data.ready,
      in_review: statusResult.data.in_review,
      blocked: statusResult.data.blocked,
      needs_feedback: statusResult.data.needs_feedback,
    },
  };
}

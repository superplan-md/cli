import { change } from './change';
import { run } from './run';
import { worktree } from './worktree';
import { stopNextAction, type NextAction } from '../next-action';

export type QuickResult =
  | {
      ok: true;
      data: {
        change_id: string;
        task_id: string;
        task_ref: string;
        title: string;
        status: string;
        next_action: NextAction;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function generateSlug(title: string): string {
  const timestamp = Date.now().toString(36).slice(-4);
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `${base}-${timestamp}`;
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

function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith('--'));
}

export async function quick(args: string[] = []): Promise<QuickResult> {
  const positionalArgs = getPositionalArgs(args);
  
  if (positionalArgs.length === 0) {
    return {
      ok: false,
      error: {
        code: 'QUICK_MISSING_TITLE',
        message: [
          'Quick command requires a task title.',
          '',
          'Usage:',
          '  superplan quick "Fix login bug"',
          '  superplan quick "Update README" --priority high',
          '',
          'Options:',
          '  --priority high|medium|low  Set task priority (default: medium)',
        ].join('\n'),
        retryable: true,
      },
    };
  }

  const title = positionalArgs[0];
  const priority = getOptionValue(args, '--priority') ?? 'medium';
  const changeSlug = generateSlug(title);
  const taskId = 'T-001';
  const taskRef = `${changeSlug}/${taskId}`;

  const changeResult = await change([
    'new',
    changeSlug,
    '--title',
    title,
    '--single-task',
    title,
    '--priority',
    priority,
  ]);
  if (!changeResult.ok) {
    return {
      ok: false,
      error: {
        code: 'QUICK_CHANGE_FAILED',
        message: `Failed to create change: ${changeResult.error.message}`,
        retryable: changeResult.error.retryable,
      },
    };
  }

  const runResult = await run([taskRef]);
  if (!runResult.ok) {
    if (runResult.error.code === 'ANOTHER_TASK_IN_PROGRESS' || runResult.error.code === 'EXECUTION_ROOT_OCCUPIED') {
      let ensuredExecutionRoot: string | null = null;
      if (runResult.error.code === 'EXECUTION_ROOT_OCCUPIED') {
        const ensureResult = await worktree(['ensure', changeSlug]);
        if (!ensureResult.ok) {
          return {
            ok: false,
            error: {
              code: 'QUICK_WORKTREE_ENSURE_FAILED',
              message: `Task ${taskRef} was scaffolded, but isolating it into a dedicated execution root failed: ${ensureResult.error.message}`,
              retryable: ensureResult.error.retryable,
            },
          };
        }

        ensuredExecutionRoot = ensureResult.data.execution_root ?? null;
      }

      return {
        ok: true,
        data: {
          change_id: changeSlug,
          task_id: taskId,
          task_ref: taskRef,
          title,
          status: 'ready',
          next_action: stopNextAction(
            runResult.error.code === 'EXECUTION_ROOT_OCCUPIED'
              ? `Task ${taskRef} is scaffolded. A dedicated execution root is ready${ensuredExecutionRoot ? ` at "${ensuredExecutionRoot}"` : ''}; start it from that root with "superplan run ${taskRef} --json".`
              : `Task ${taskRef} is scaffolded. Resolve the current in-progress task first, then start it with "superplan run ${taskRef} --json".`,
            runResult.error.code === 'EXECUTION_ROOT_OCCUPIED'
              ? 'Quick created tracked work successfully, but execution had to be isolated away from the current checkout.'
              : 'Quick now uses the single-task scaffold path immediately, but activation still respects the one-active-task rule.',
          ),
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'QUICK_RUN_FAILED',
        message: `Failed to activate task: ${runResult.error.message}`,
        retryable: runResult.error.retryable,
      },
    };
  }

  if (!runResult.data.task_id || !runResult.data.task) {
    return {
      ok: false,
      error: {
        code: 'QUICK_NO_TASK_ACTIVATED',
        message: 'No task was activated',
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    data: {
      change_id: changeSlug,
      task_id: runResult.data.task.task_id,
      task_ref: runResult.data.task_id,
      title,
      status: runResult.data.status ?? 'in_progress',
      next_action: runResult.data.next_action,
    },
  };
}

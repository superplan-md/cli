import { change } from './change';
import { task } from './task';
import { run } from './run';
import { getQueueNextAction, type NextAction } from '../next-action';

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

function generateTaskId(): string {
  const timestamp = Date.now().toString(36).slice(-4).toUpperCase();
  return `T-${timestamp}`;
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
  const taskId = generateTaskId();

  // Step 1: Create change
  const changeResult = await change(['new', changeSlug]);
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

  // Step 2: Create task
  const taskResult = await task([
    'scaffold',
    'new',
    changeSlug,
    taskId,
    '--priority',
    priority,
  ]);
  
  if (!taskResult.ok) {
    return {
      ok: false,
      error: {
        code: 'QUICK_TASK_FAILED',
        message: `Failed to create task: ${taskResult.error.message}`,
        retryable: taskResult.error.retryable,
      },
    };
  }

  // Step 3: Activate task
  const runResult = await run([]);
  if (!runResult.ok) {
    return {
      ok: false,
      error: {
        code: 'QUICK_RUN_FAILED',
        message: `Failed to activate task: ${runResult.error.message}`,
        retryable: runResult.error.retryable,
      },
    };
  }

  if (!runResult.data.task_id) {
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
      task_id: runResult.data.task_id,
      task_ref: `${changeSlug}:${runResult.data.task_id}`,
      title,
      status: runResult.data.status ?? 'in_progress',
      next_action: getQueueNextAction({
        active: runResult.data.task_id,
        ready: [],
        in_review: [],
        blocked: [],
        needs_feedback: [],
      }),
    },
  };
}

import { task } from './task';
import { refreshOverlaySnapshot, setOverlayVisibilityRequest } from '../overlay-runtime';

type OverlaySubcommand = 'ensure' | 'show' | 'hide';

export type OverlayResult =
  | {
      ok: true;
      data: {
        requested_action: OverlaySubcommand;
        visible: boolean;
        snapshot_path: string;
        control_path: string;
        attention_state: 'normal' | 'needs_feedback' | 'all_tasks_done' | null;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const OVERLAY_SUBCOMMANDS = new Set<OverlaySubcommand>(['ensure', 'show', 'hide']);

export function getOverlayCommandHelpMessage(options: { subcommand?: string }): string {
  const intro = options.subcommand
    ? `Unknown overlay subcommand: ${options.subcommand}`
    : 'Superplan overlay command requires a subcommand.';

  return [
    intro,
    '',
    'Overlay commands:',
    '  ensure                      Prepare overlay runtime state and request the companion to be visible',
    '  show                        Request the overlay companion to become visible',
    '  hide                        Request the overlay companion to hide its window',
    '',
    'Examples:',
    '  superplan overlay ensure',
    '  superplan overlay show',
    '  superplan overlay hide',
  ].join('\n');
}

function getInvalidOverlayCommandError(subcommand?: string): OverlayResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_OVERLAY_COMMAND',
      message: getOverlayCommandHelpMessage({ subcommand }),
      retryable: true,
    },
  };
}

function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--json' && arg !== '--quiet');
}

async function loadTasksForSnapshot() {
  const showTasksResult = await task(['show']);
  if (!showTasksResult.ok) {
    return showTasksResult;
  }

  if (!('tasks' in showTasksResult.data)) {
    return {
      ok: false as const,
      error: {
        code: 'OVERLAY_REFRESH_FAILED',
        message: 'Unexpected task show result',
        retryable: false,
      },
    };
  }

  return {
    ok: true as const,
    data: {
      tasks: showTasksResult.data.tasks,
    },
  };
}

async function ensureOrShowOverlay(subcommand: 'ensure' | 'show'): Promise<OverlayResult> {
  const tasksResult = await loadTasksForSnapshot();
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const [{ paths, snapshot }, { control }] = await Promise.all([
    refreshOverlaySnapshot(tasksResult.data.tasks),
    setOverlayVisibilityRequest(subcommand),
  ]);

  return {
    ok: true,
    data: {
      requested_action: subcommand,
      visible: control.visible,
      snapshot_path: paths.snapshot_path,
      control_path: paths.control_path,
      attention_state: snapshot.attention_state,
    },
  };
}

async function hideOverlay(): Promise<OverlayResult> {
  const { paths, control } = await setOverlayVisibilityRequest('hide');

  return {
    ok: true,
    data: {
      requested_action: 'hide',
      visible: control.visible,
      snapshot_path: paths.snapshot_path,
      control_path: paths.control_path,
      attention_state: null,
    },
  };
}

export async function overlay(args: string[]): Promise<OverlayResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0];

  if (!subcommand || !OVERLAY_SUBCOMMANDS.has(subcommand as OverlaySubcommand)) {
    return getInvalidOverlayCommandError(subcommand);
  }

  if (subcommand === 'ensure' || subcommand === 'show') {
    return ensureOrShowOverlay(subcommand);
  }

  return hideOverlay();
}

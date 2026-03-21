import { loadTasks } from './task';
import { refreshOverlaySnapshot, setOverlayVisibilityRequest } from '../overlay-runtime';
import {
  hasLocalSuperplanRoot,
  readOverlayPreferences,
  writeOverlayPreference,
  type OverlayPreferenceScope,
} from '../overlay-preferences';
import {
  applyRequestedOverlayAction,
  createSkippedCompanionLaunchResult,
} from '../overlay-visibility';
import type { OverlayCompanionLaunchResult } from '../overlay-companion';

type OverlayRequestedAction = 'ensure' | 'show' | 'hide';
type OverlaySubcommand = OverlayRequestedAction | 'enable' | 'disable' | 'status';

export type OverlayResult =
  | {
      ok: true;
      data: {
        requested_action?: OverlayRequestedAction;
        applied_action?: OverlayRequestedAction;
        visible: boolean;
        enabled: boolean;
        global_enabled: boolean | null;
        local_enabled: boolean | null;
        effective_scope: OverlayPreferenceScope | null;
        snapshot_path: string;
        control_path: string;
        attention_state: 'normal' | 'needs_feedback' | 'all_tasks_done' | null;
        has_content: boolean;
        reason?: 'disabled' | 'empty';
        config_path?: string;
        companion?: OverlayCompanionLaunchResult;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const OVERLAY_SUBCOMMANDS = new Set<OverlaySubcommand>(['ensure', 'show', 'hide', 'enable', 'disable', 'status']);

export function getOverlayCommandHelpMessage(options: { subcommand?: string }): string {
  const intro = options.subcommand
    ? `Unknown overlay subcommand: ${options.subcommand}`
    : 'Superplan overlay command requires a subcommand.';

  return [
    intro,
    '',
    'Overlay commands:',
    '  enable [--global]           Enable overlay behavior (local by default, global with --global)',
    '  disable [--global]          Disable overlay behavior (local by default, global with --global)',
    '  status                      Show effective overlay preference and runtime visibility state',
    '  ensure                      Prepare overlay runtime state and launch or reveal the installed companion',
    '  show                        Launch or reveal the installed overlay companion',
    '  hide                        Request the overlay companion to hide its window',
    '',
    'Examples:',
    '  superplan overlay enable',
    '  superplan overlay disable --global',
    '  superplan overlay status',
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
  return args.filter(arg => arg !== '--json' && arg !== '--quiet' && arg !== '--global');
}

function getPreferenceScope(args: string[]): OverlayPreferenceScope {
  return args.includes('--global') ? 'global' : 'local';
}

async function loadTasksForSnapshot() {
  return await loadTasks();
}

async function ensureOrShowOverlay(subcommand: 'ensure' | 'show'): Promise<OverlayResult> {
  const tasksResult = await loadTasksForSnapshot();
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const { paths, snapshot } = await refreshOverlaySnapshot(tasksResult.data.tasks);
  const visibility = await applyRequestedOverlayAction(subcommand, snapshot);

  return {
    ok: true,
    data: {
      requested_action: subcommand,
      applied_action: visibility.applied_action,
      visible: visibility.visible,
      enabled: visibility.enabled,
      global_enabled: visibility.global_enabled,
      local_enabled: visibility.local_enabled,
      effective_scope: visibility.effective_scope,
      snapshot_path: paths.snapshot_path,
      control_path: paths.control_path,
      attention_state: snapshot.attention_state,
      has_content: visibility.has_content,
      companion: visibility.companion,
      ...(visibility.enabled ? {} : { reason: 'disabled' as const }),
      ...(visibility.enabled && !visibility.has_content ? { reason: 'empty' as const } : {}),
    },
  };
}

async function hideOverlay(): Promise<OverlayResult> {
  const [{ paths, control }, preferences] = await Promise.all([
    setOverlayVisibilityRequest('hide'),
    readOverlayPreferences(),
  ]);

  return {
    ok: true,
    data: {
      requested_action: 'hide',
      applied_action: 'hide',
      visible: control.visible,
      enabled: preferences.effective_enabled,
      global_enabled: preferences.global_enabled,
      local_enabled: preferences.local_enabled,
      effective_scope: preferences.effective_scope,
      snapshot_path: paths.snapshot_path,
      control_path: paths.control_path,
      attention_state: null,
      has_content: false,
      companion: createSkippedCompanionLaunchResult(process.cwd()),
    },
  };
}

function getInitRequiredOverlayError(): OverlayResult {
  return {
    ok: false,
    error: {
      code: 'INIT_REQUIRED',
      message: 'Run superplan init before changing local overlay preferences',
      retryable: true,
    },
  };
}

async function setOverlayEnabled(enabled: boolean, scope: OverlayPreferenceScope): Promise<OverlayResult> {
  if (scope === 'local' && !await hasLocalSuperplanRoot()) {
    return getInitRequiredOverlayError();
  }

  const [{ config_path }, { paths }] = await Promise.all([
    writeOverlayPreference(enabled, { scope }),
    setOverlayVisibilityRequest('hide'),
  ]);
  const nextPreferences = await readOverlayPreferences();

  return {
    ok: true,
    data: {
      applied_action: 'hide',
      visible: false,
      enabled: nextPreferences.effective_enabled,
      global_enabled: nextPreferences.global_enabled,
      local_enabled: nextPreferences.local_enabled,
      effective_scope: nextPreferences.effective_scope,
      snapshot_path: paths.snapshot_path,
      control_path: paths.control_path,
      attention_state: null,
      has_content: false,
      config_path,
      ...(enabled ? {} : { reason: 'disabled' as const }),
    },
  };
}

async function getOverlayStatus(): Promise<OverlayResult> {
  const tasksResult = await loadTasksForSnapshot();
  if (!tasksResult.ok) {
    return tasksResult;
  }

  const [{ paths }, preferences] = await Promise.all([
    refreshOverlaySnapshot(tasksResult.data.tasks),
    readOverlayPreferences(),
  ]);

  const hasContent = tasksResult.data.tasks.length > 0;

  return {
    ok: true,
    data: {
      visible: preferences.effective_enabled && hasContent,
      enabled: preferences.effective_enabled,
      global_enabled: preferences.global_enabled,
      local_enabled: preferences.local_enabled,
      effective_scope: preferences.effective_scope,
      snapshot_path: paths.snapshot_path,
      control_path: paths.control_path,
      attention_state: null,
      has_content: hasContent,
      ...(!preferences.effective_enabled ? { reason: 'disabled' as const } : {}),
      ...(preferences.effective_enabled && !hasContent ? { reason: 'empty' as const } : {}),
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

  if (subcommand === 'enable') {
    return setOverlayEnabled(true, getPreferenceScope(args));
  }

  if (subcommand === 'disable') {
    return setOverlayEnabled(false, getPreferenceScope(args));
  }

  if (subcommand === 'status') {
    return getOverlayStatus();
  }

  return hideOverlay();
}

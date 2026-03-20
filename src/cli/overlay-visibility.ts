import { setOverlayVisibilityRequest } from './overlay-runtime';
import { readOverlayPreferences, type OverlayPreferenceState } from './overlay-preferences';
import { launchInstalledOverlayCompanion, type OverlayCompanionLaunchResult } from './overlay-companion';
import type { OverlayRequestedAction, OverlaySnapshot } from '../shared/overlay';

export interface OverlayVisibilityApplyResult {
  applied_action: OverlayRequestedAction;
  visible: boolean;
  enabled: boolean;
  global_enabled: boolean | null;
  local_enabled: boolean | null;
  effective_scope: OverlayPreferenceState['effective_scope'];
  has_content: boolean;
  companion: OverlayCompanionLaunchResult;
}

type OverlaySnapshotLike = Pick<OverlaySnapshot, 'workspace_path' | 'active_task' | 'attention_state' | 'board' | 'events'>;

export function hasRenderableSnapshotContent(snapshot: OverlaySnapshotLike): boolean {
  if (snapshot.active_task) {
    return true;
  }

  if (snapshot.attention_state !== 'normal') {
    return true;
  }

  if (snapshot.events.length > 0) {
    return true;
  }

  return Object.values(snapshot.board).some(column => column.length > 0);
}

export function createSkippedCompanionLaunchResult(
  workspacePath: string,
  reason: OverlayCompanionLaunchResult['reason'] = 'not_requested',
): OverlayCompanionLaunchResult {
  return {
    attempted: false,
    launched: false,
    configured: false,
    launchable: false,
    source: null,
    install_path: null,
    executable_path: null,
    workspace_path: workspacePath,
    reason,
  };
}

export async function applyRequestedOverlayAction(
  requestedAction: OverlayRequestedAction,
  snapshot: OverlaySnapshotLike,
): Promise<OverlayVisibilityApplyResult> {
  const preferences = await readOverlayPreferences(snapshot.workspace_path);
  const hasContent = hasRenderableSnapshotContent(snapshot);
  const appliedAction: OverlayRequestedAction = preferences.effective_enabled && hasContent ? requestedAction : 'hide';
  const [{ control }, companion] = await Promise.all([
    setOverlayVisibilityRequest(appliedAction, { workspacePath: snapshot.workspace_path }),
    appliedAction === 'hide'
      ? Promise.resolve(createSkippedCompanionLaunchResult(snapshot.workspace_path))
      : launchInstalledOverlayCompanion(snapshot.workspace_path),
  ]);

  return {
    applied_action: appliedAction,
    visible: control.visible,
    enabled: preferences.effective_enabled,
    global_enabled: preferences.global_enabled,
    local_enabled: preferences.local_enabled,
    effective_scope: preferences.effective_scope,
    has_content: hasContent,
    companion,
  };
}

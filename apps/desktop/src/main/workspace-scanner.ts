import * as os from 'os'
import * as path from 'path'
import {
  scanRuntimeOverlaySnapshots,
  type RuntimeOverlaySnapshot,
  type RuntimeOverlayTrackedChange
} from './runtime-overlay-snapshots'
import type {
  DesktopChangeNavigationItem,
  DesktopWorkspaceNavigationItem
} from '../shared/desktop-contract'

function shouldRenderTrackedChange(change: RuntimeOverlayTrackedChange): boolean {
  return change.status !== 'tracking'
}

function toDesktopChangeStatus(
  status: RuntimeOverlayTrackedChange['status']
): 'active' | 'idle' | 'done' {
  if (status === 'done') return 'done'
  if (status === 'in_progress' || status === 'tracking' || status === 'blocked' || status === 'needs_feedback') {
    return 'active'
  }
  return 'idle'
}

function toDesktopChange(change: RuntimeOverlayTrackedChange): DesktopChangeNavigationItem {
  const taskCount = change.task_total
  const completedTaskCount = change.task_done

  return {
    id: change.change_id,
    title: change.title,
    stateScore: taskCount > 0 ? Math.round((completedTaskCount / taskCount) * 100) : 0,
    lastActiveAt: change.updated_at,
    inProgress: change.status === 'in_progress' || change.status === 'tracking',
    unread: false,
    taskCount,
    completedTaskCount,
    status: toDesktopChangeStatus(change.status)
  }
}

export function buildWorkspaceNavigation(
  snapshots: RuntimeOverlaySnapshot[]
): DesktopWorkspaceNavigationItem[] {
  const homeDir = os.homedir()
  const workspaces = snapshots.map((snapshot) => {
    const workspacePath = snapshot.workspace_path
    const changes = snapshot.tracked_changes
      .filter(shouldRenderTrackedChange)
      .map(toDesktopChange)
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))

    return {
      id: path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9]/g, '-') || 'workspace-root',
      name: path.basename(workspacePath),
      rootLabel: workspacePath.startsWith(homeDir)
        ? path.relative(homeDir, workspacePath)
        : workspacePath,
      path: workspacePath,
      lastActiveAt: snapshot.updated_at,
      changes
    } satisfies DesktopWorkspaceNavigationItem
  })

  workspaces.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  return workspaces
}

export async function scanWorkspaces(): Promise<DesktopWorkspaceNavigationItem[]> {
  return buildWorkspaceNavigation(await scanRuntimeOverlaySnapshots())
}

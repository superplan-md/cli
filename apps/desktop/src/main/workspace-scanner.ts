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

function getWorkspaceRootLabel(workspacePath: string, homeDir: string): string {
  return workspacePath.startsWith(homeDir)
    ? path.relative(homeDir, workspacePath)
    : workspacePath
}

export function buildWorkspaceNavigation(
  snapshots: RuntimeOverlaySnapshot[]
): DesktopWorkspaceNavigationItem[] {
  const homeDir = os.homedir()
  const workspacesByProjectId = new Map<
    string,
    DesktopWorkspaceNavigationItem & { changeMap: Map<string, DesktopChangeNavigationItem> }
  >()

  for (const snapshot of snapshots) {
    const existingWorkspace = workspacesByProjectId.get(snapshot.project_id)
    const nextWorkspace =
      existingWorkspace
      ?? {
        id: snapshot.project_id,
        name: snapshot.project_name,
        rootLabel: getWorkspaceRootLabel(snapshot.project_path, homeDir),
        path: snapshot.project_path,
        lastActiveAt: snapshot.updated_at,
        changes: [],
        changeMap: new Map<string, DesktopChangeNavigationItem>()
      }

    if (snapshot.updated_at > nextWorkspace.lastActiveAt) {
      nextWorkspace.lastActiveAt = snapshot.updated_at
    }

    for (const change of snapshot.tracked_changes.filter(shouldRenderTrackedChange).map(toDesktopChange)) {
      const currentChange = nextWorkspace.changeMap.get(change.id)
      if (!currentChange || change.lastActiveAt > currentChange.lastActiveAt) {
        nextWorkspace.changeMap.set(change.id, change)
      }
    }

    workspacesByProjectId.set(snapshot.project_id, nextWorkspace)
  }

  const workspaces = [...workspacesByProjectId.values()].map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    rootLabel: workspace.rootLabel,
    path: workspace.path,
    lastActiveAt: workspace.lastActiveAt,
    changes: [...workspace.changeMap.values()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  } satisfies DesktopWorkspaceNavigationItem))

  workspaces.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
  return workspaces
}

export async function scanWorkspaces(): Promise<DesktopWorkspaceNavigationItem[]> {
  return buildWorkspaceNavigation(await scanRuntimeOverlaySnapshots())
}

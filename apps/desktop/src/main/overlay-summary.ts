import * as path from 'path'
import { getChangeSnapshot } from './change-snapshot'
import {
  scanRuntimeOverlaySnapshots,
  type RuntimeOverlaySnapshot,
  type RuntimeOverlayTrackedChange
} from './runtime-overlay-snapshots'
import type {
  DesktopChangeSnapshot,
  DesktopOverlayItem,
  DesktopOverlayItemStatus,
  DesktopOverlaySummary
} from '../shared/desktop-contract'

// Primary ordering rule:
// 1. changes that need attention first
// 2. active/running changes next
// 3. completed changes last
// Within the same bucket, newest update wins.
function primaryStatusPriority(status: DesktopOverlayItemStatus): number {
  switch (status) {
    case 'needs_feedback':
      return 0
    case 'blocked':
      return 1
    case 'running':
      return 2
    case 'change_done':
      return 3
  }
}

function workspaceIdForPath(workspacePath: string): string {
  return path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'workspace-root'
}

function previewForTrackedChange(
  change: RuntimeOverlayTrackedChange,
  snapshot: DesktopChangeSnapshot | null
): string {
  if (snapshot) {
    const feedbackTask = snapshot.tasks.find((task) => task.status === 'needs_feedback')
    if (feedbackTask) {
      return feedbackTask.message ?? feedbackTask.descriptionExcerpt
    }

    const blockedTask = snapshot.tasks.find((task) => task.status === 'blocked')
    if (blockedTask) {
      return blockedTask.reason ?? blockedTask.descriptionExcerpt
    }

    const runningTask = snapshot.tasks.find((task) => task.status === 'in_progress')
    if (runningTask) {
      return runningTask.title
    }

    if (snapshot.status === 'done') {
      return `All ${snapshot.totalCount} tasks completed`
    }
  }

  if (change.status === 'done') {
    return `All ${change.task_total} tasks completed`
  }

  return `${change.task_done}/${change.task_total} tasks done`
}

function summarizeTrackedChange(
  workspacePath: string,
  change: RuntimeOverlayTrackedChange,
  snapshot: DesktopChangeSnapshot | null
): DesktopOverlayItem | null {
  let status: DesktopOverlayItemStatus
  let statusLabel: string

  switch (change.status) {
    case 'needs_feedback':
      status = 'needs_feedback'
      statusLabel = 'Needs feedback'
      break
    case 'blocked':
      status = 'blocked'
      statusLabel = 'Blocked'
      break
    case 'done':
      status = 'change_done'
      statusLabel = 'Change done'
      break
    case 'tracking':
    case 'in_progress':
      status = 'running'
      statusLabel = 'Running'
      break
    case 'backlog':
      return null
  }

  return {
    workspaceId: workspaceIdForPath(workspacePath),
    workspaceName: path.basename(workspacePath),
    workspacePath,
    changeId: change.change_id,
    changeTitle: change.title,
    status,
    statusLabel,
    preview: previewForTrackedChange(change, snapshot),
    taskDone: change.task_done,
    taskTotal: change.task_total,
    updatedAt: change.updated_at,
    agentId: change.agent_id ?? null,
    agentName: change.agent_name ?? null
  }
}

function createEmptyOverlaySummary(): DesktopOverlaySummary {
  return {
    generatedAt: new Date().toISOString(),
    primary: null,
    secondary: [],
    allItems: [],
    hiddenCount: 0,
    activeWorkspaceCount: 0,
    activeChangeCount: 0,
    needsFeedbackCount: 0,
    completedCount: 0,
    runningCount: 0,
    blockedCount: 0
  }
}

export async function buildOverlaySummary(
  snapshots: RuntimeOverlaySnapshot[]
): Promise<DesktopOverlaySummary> {
  if (snapshots.length === 0) {
    return createEmptyOverlaySummary()
  }

  const items = (
    await Promise.all(
      snapshots.flatMap((snapshot) =>
        snapshot.tracked_changes.map(async (change) => {
          let detailedSnapshot: DesktopChangeSnapshot | null = null

          try {
            detailedSnapshot = await getChangeSnapshot(snapshot.workspace_path, change.change_id)
          } catch {
            detailedSnapshot = null
          }

          return summarizeTrackedChange(snapshot.workspace_path, change, detailedSnapshot)
        })
      )
    )
  )
    .filter((item): item is DesktopOverlayItem => item !== null)
    .sort((left, right) => {
      const priorityDelta = primaryStatusPriority(left.status) - primaryStatusPriority(right.status)
      if (priorityDelta !== 0) return priorityDelta
      return right.updatedAt.localeCompare(left.updatedAt)
    })

  return {
    generatedAt: new Date().toISOString(),
    primary: items[0] ?? null,
    secondary: items.slice(1, 3),
    allItems: items,
    hiddenCount: Math.max(0, items.length - 3),
    activeWorkspaceCount: new Set(items.map((item) => item.workspaceId)).size,
    activeChangeCount: items.length,
    needsFeedbackCount: items.filter((item) => item.status === 'needs_feedback').length,
    completedCount: items.filter((item) => item.status === 'change_done').length,
    runningCount: items.filter((item) => item.status === 'running').length,
    blockedCount: items.filter((item) => item.status === 'blocked').length
  }
}

export async function getOverlaySummary(): Promise<DesktopOverlaySummary> {
  return buildOverlaySummary(await scanRuntimeOverlaySnapshots())
}

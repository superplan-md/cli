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

interface CachedOverlayItem {
  revision: string
  item: DesktopOverlayItem | null
}

const overlayItemCache = new Map<string, CachedOverlayItem>()

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

function workspaceIdForSnapshot(snapshot: RuntimeOverlaySnapshot): string {
  return snapshot.project_id || path.basename(snapshot.project_path).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'workspace-root'
}

function getOverlayItemCacheKey(workspacePath: string, changeId: string): string {
  return `${workspacePath}::${changeId}`
}

function getOverlayItemRevision(change: RuntimeOverlayTrackedChange): string {
  return [
    change.updated_at,
    change.status,
    change.task_done,
    change.task_total,
    change.agent_id ?? '',
    change.agent_name ?? ''
  ].join(':')
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
  runtimeSnapshot: RuntimeOverlaySnapshot,
  change: RuntimeOverlayTrackedChange,
  detailedSnapshot: DesktopChangeSnapshot | null
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
    workspaceId: workspaceIdForSnapshot(runtimeSnapshot),
    workspaceName: runtimeSnapshot.project_name,
    workspacePath: runtimeSnapshot.project_path,
    changeId: change.change_id,
    changeTitle: change.title,
    status,
    statusLabel,
    preview: previewForTrackedChange(change, detailedSnapshot),
    taskDone: change.task_done,
    taskTotal: change.task_total,
    updatedAt: change.updated_at,
    agentId: change.agent_id ?? null,
    agentName: change.agent_name ?? null
  }
}

function shouldRenderTrackedChange(change: RuntimeOverlayTrackedChange): boolean {
  return change.status !== 'tracking'
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
    overlayItemCache.clear()
    return createEmptyOverlaySummary()
  }

  const seenCacheKeys = new Set<string>()
  const rawItems = (
    await Promise.all(
      snapshots.flatMap((snapshot) =>
        snapshot.tracked_changes
          .filter(shouldRenderTrackedChange)
          .map(async (change) => {
            const cacheKey = getOverlayItemCacheKey(snapshot.project_id, change.change_id)
            const nextRevision = getOverlayItemRevision(change)
            const cached = overlayItemCache.get(cacheKey)
            seenCacheKeys.add(cacheKey)

            if (cached && cached.revision === nextRevision) {
              return cached.item
            }

            let detailedSnapshot: DesktopChangeSnapshot | null = null

            try {
              detailedSnapshot = await getChangeSnapshot(snapshot.project_path, change.change_id)
            } catch {
              detailedSnapshot = null
            }

            const item = summarizeTrackedChange(snapshot, change, detailedSnapshot)
            overlayItemCache.set(cacheKey, {
              revision: nextRevision,
              item
            })
            return item
          })
      )
    )
  )
    .filter((item): item is DesktopOverlayItem => item !== null)

  const dedupedItems = new Map<string, DesktopOverlayItem>()
  for (const item of rawItems) {
    const dedupeKey = `${item.workspaceId}::${item.changeId}`
    const existing = dedupedItems.get(dedupeKey)
    if (!existing || item.updatedAt > existing.updatedAt) {
      dedupedItems.set(dedupeKey, item)
    }
  }

  const items = [...dedupedItems.values()].sort((left, right) => {
      const priorityDelta = primaryStatusPriority(left.status) - primaryStatusPriority(right.status)
      if (priorityDelta !== 0) return priorityDelta
      return right.updatedAt.localeCompare(left.updatedAt)
    })

  for (const cacheKey of overlayItemCache.keys()) {
    if (!seenCacheKeys.has(cacheKey)) {
      overlayItemCache.delete(cacheKey)
    }
  }

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

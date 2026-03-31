import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

export interface RuntimeOverlayTrackedChange {
  change_id: string
  title: string
  status: 'tracking' | 'backlog' | 'in_progress' | 'blocked' | 'needs_feedback' | 'done'
  task_total: number
  task_done: number
  updated_at: string
  agent_id?: string | null
  agent_name?: string | null
}

export interface RuntimeOverlaySnapshot {
  workspace_path: string
  updated_at: string
  tracked_changes: RuntimeOverlayTrackedChange[]
}

const GLOBAL_SUPERPLAN_DIR = path.join(os.homedir(), '.config', 'superplan')

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readOverlaySnapshot(runtimeEntryDir: string): Promise<RuntimeOverlaySnapshot | null> {
  const snapshotPath = path.join(runtimeEntryDir, 'overlay.json')
  if (!await pathExists(snapshotPath)) {
    return null
  }

  try {
    const raw = await fs.readFile(snapshotPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RuntimeOverlaySnapshot>
    if (
      typeof parsed.workspace_path !== 'string' ||
      typeof parsed.updated_at !== 'string' ||
      !Array.isArray(parsed.tracked_changes)
    ) {
      return null
    }

    return {
      workspace_path: parsed.workspace_path,
      updated_at: parsed.updated_at,
      tracked_changes: parsed.tracked_changes.filter(
        (change): change is RuntimeOverlayTrackedChange =>
          Boolean(
            change &&
            typeof change === 'object' &&
            typeof change.change_id === 'string' &&
            typeof change.title === 'string' &&
            typeof change.status === 'string' &&
            typeof change.task_total === 'number' &&
            typeof change.task_done === 'number' &&
            typeof change.updated_at === 'string'
          )
      )
    }
  } catch {
    return null
  }
}

export async function scanRuntimeOverlaySnapshots(): Promise<RuntimeOverlaySnapshot[]> {
  if (!await pathExists(GLOBAL_SUPERPLAN_DIR)) {
    return []
  }

  let runtimeEntries: Array<{ name: string; isDirectory(): boolean }>
  try {
    runtimeEntries = await fs.readdir(GLOBAL_SUPERPLAN_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const snapshots = (
    await Promise.all(
      runtimeEntries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('workspace-'))
        .map((entry) => readOverlaySnapshot(path.join(GLOBAL_SUPERPLAN_DIR, entry.name, 'runtime')))
    )
  ).filter((snapshot): snapshot is RuntimeOverlaySnapshot => snapshot !== null)

  snapshots.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return snapshots
}

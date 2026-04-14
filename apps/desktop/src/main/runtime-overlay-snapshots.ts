import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { resolveProjectIdentity } from '../../../../src/cli/project-identity'

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
  project_id: string
  project_name: string
  project_path: string
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

function deriveProjectIdentity(workspacePath: string): Pick<
  RuntimeOverlaySnapshot,
  'project_id' | 'project_name' | 'project_path'
> {
  const projectIdentity = resolveProjectIdentity(workspacePath)
  const projectPath = projectIdentity.project_root
  return {
    project_id: projectIdentity.project_id,
    project_name: path.basename(projectPath) || 'root',
    project_path: projectPath
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

    const projectIdentity =
      typeof parsed.project_id === 'string' &&
      typeof parsed.project_name === 'string' &&
      typeof parsed.project_path === 'string'
        ? {
            project_id: parsed.project_id,
            project_name: parsed.project_name,
            project_path: parsed.project_path
          }
        : deriveProjectIdentity(parsed.workspace_path)

    return {
      ...projectIdentity,
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

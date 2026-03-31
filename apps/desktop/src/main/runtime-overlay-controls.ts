import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

export interface RuntimeOverlayControlState {
  workspace_path: string
  requested_action: 'ensure' | 'show' | 'hide'
  updated_at: string
  visible: boolean
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

async function readOverlayControl(runtimeEntryDir: string): Promise<RuntimeOverlayControlState | null> {
  const controlPath = path.join(runtimeEntryDir, 'overlay-control.json')
  if (!await pathExists(controlPath)) {
    return null
  }

  try {
    const raw = await fs.readFile(controlPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RuntimeOverlayControlState>
    if (
      typeof parsed.workspace_path !== 'string' ||
      typeof parsed.updated_at !== 'string' ||
      typeof parsed.visible !== 'boolean' ||
      (parsed.requested_action !== 'ensure' &&
        parsed.requested_action !== 'show' &&
        parsed.requested_action !== 'hide')
    ) {
      return null
    }

    return {
      workspace_path: parsed.workspace_path,
      requested_action: parsed.requested_action,
      updated_at: parsed.updated_at,
      visible: parsed.visible
    }
  } catch {
    return null
  }
}

export async function scanRuntimeOverlayControls(): Promise<RuntimeOverlayControlState[]> {
  if (!await pathExists(GLOBAL_SUPERPLAN_DIR)) {
    return []
  }

  let runtimeEntries: Array<{ name: string; isDirectory(): boolean }>
  try {
    runtimeEntries = await fs.readdir(GLOBAL_SUPERPLAN_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  const controls = (
    await Promise.all(
      runtimeEntries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('workspace-'))
        .map((entry) => readOverlayControl(path.join(GLOBAL_SUPERPLAN_DIR, entry.name, 'runtime')))
    )
  ).filter((control): control is RuntimeOverlayControlState => control !== null)

  controls.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return controls
}

export function getLatestVisibleOverlayControl(
  controls: RuntimeOverlayControlState[]
): RuntimeOverlayControlState | null {
  return controls.find((control) => control.visible) ?? null
}

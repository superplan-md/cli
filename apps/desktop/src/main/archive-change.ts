import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveProjectStateRoot } from '../../../../src/cli/project-identity'

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function archiveChange(workspacePath: string, changeId: string): Promise<boolean> {
  const workspaceSuperplanRoot = resolveProjectStateRoot(workspacePath)
  const changesRoot = path.join(workspaceSuperplanRoot, 'changes')
  const changeRoot = path.join(changesRoot, changeId)
  const archiveRoot = path.join(changesRoot, '.archive')
  const archiveTarget = path.join(archiveRoot, changeId)

  if (!await pathExists(changeRoot)) {
    return false
  }

  if (await pathExists(archiveTarget)) {
    return false
  }

  await fs.mkdir(archiveRoot, { recursive: true })
  await fs.rename(changeRoot, archiveTarget)

  const runtimeTasksPath = path.join(workspaceSuperplanRoot, 'runtime', 'tasks.json')
  if (await pathExists(runtimeTasksPath)) {
    try {
      const raw = await fs.readFile(runtimeTasksPath, 'utf-8')
      const runtimeState = JSON.parse(raw) as Record<string, unknown>
      const changes = runtimeState['changes']
      if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
        const nextChanges = changes as Record<string, unknown>
        if (changeId in nextChanges) {
          delete nextChanges[changeId]
          runtimeState['changes'] = nextChanges
          await fs.writeFile(runtimeTasksPath, JSON.stringify(runtimeState, null, 2), 'utf-8')
        }
      }
    } catch {
      // best-effort cleanup only
    }
  }

  return true
}

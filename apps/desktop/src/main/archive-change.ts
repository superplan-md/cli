import * as fs from 'fs/promises'
import * as path from 'path'
import { resolveProjectStateRoot } from '../../../../src/cli/project-identity'
import { refreshOverlaySnapshot } from '../../../../src/cli/overlay-runtime'
import { loadTasks } from '../../../../src/cli/commands/task'

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function withWorkingDirectory<T>(targetDir: string, fn: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd()
  process.chdir(targetDir)

  try {
    return await fn()
  } finally {
    process.chdir(previousCwd)
  }
}

async function refreshWorkspaceOverlayState(workspacePath: string): Promise<void> {
  await withWorkingDirectory(workspacePath, async () => {
    const tasksResult = await loadTasks({ skipInvariant: true })
    const tasks = tasksResult.ok ? tasksResult.data.tasks : []
    await refreshOverlaySnapshot(tasks, { workspacePath })
  })
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

  try {
    await refreshWorkspaceOverlayState(workspacePath)
  } catch {
    // best-effort refresh only
  }

  return true
}

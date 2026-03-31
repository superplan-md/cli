/**
 * Change snapshot reader — builds a DesktopChangeSnapshot from real .superplan/
 * filesystem data for a given workspace path and change id.
 */

import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import type {
  DesktopChangeSnapshot,
  DesktopChangeTask,
  DesktopChangeViewStatus
} from '../shared/desktop-contract'

const GLOBAL_SUPERPLAN_DIR = path.join(os.homedir(), '.config', 'superplan')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// tasks.md graph metadata parsing
// ---------------------------------------------------------------------------

interface GraphTaskEntry {
  taskId: string
  title: string
  dependsOnAll: string[]
  dependsOnAny: string[]
}

interface GraphMetadata {
  changeId: string
  changeTitle: string
  tasks: GraphTaskEntry[]
}

/**
 * Parse the tasks.md Graph Metadata and Graph Layout sections.
 * Handles both compact and spaced formatting found in real files.
 */
function parseGraphMetadata(content: string): GraphMetadata | null {
  const changeIdMatch = /Change ID:\s*`([^`]+)`/.exec(content)
  const titleMatch = /Title:\s*(.+)/.exec(content)
  if (!changeIdMatch || !titleMatch) return null

  const changeId = changeIdMatch[1].trim()
  const changeTitle = titleMatch[1].trim()

  // Parse graph layout: lines like `- `T-001` Some task title`
  const tasks: GraphTaskEntry[] = []
  const lines = content.split('\n')

  let currentTask: GraphTaskEntry | null = null
  for (const line of lines) {
    // Task header: `- `T-xxx` Title`
    const taskHeaderMatch = /^\s*-\s*`(T-[A-Za-z0-9]+)`\s+(.+)/.exec(line)
    if (taskHeaderMatch) {
      if (currentTask) tasks.push(currentTask)
      currentTask = {
        taskId: taskHeaderMatch[1],
        title: taskHeaderMatch[2].trim(),
        dependsOnAll: [],
        dependsOnAny: []
      }
      continue
    }

    if (!currentTask) continue

    // depends_on_all: [`T-001`, `T-002`]
    const depAllMatch = /depends_on_all:\s*\[([^\]]*)\]/.exec(line)
    if (depAllMatch) {
      const depStr = depAllMatch[1]
      currentTask.dependsOnAll = [...depStr.matchAll(/`(T-[A-Za-z0-9]+)`/g)].map((m) => m[1])
      continue
    }

    // depends_on_any: [`T-003`]
    const depAnyMatch = /depends_on_any:\s*\[([^\]]*)\]/.exec(line)
    if (depAnyMatch) {
      const depStr = depAnyMatch[1]
      currentTask.dependsOnAny = [...depStr.matchAll(/`(T-[A-Za-z0-9]+)`/g)].map((m) => m[1])
    }
  }

  if (currentTask) tasks.push(currentTask)

  return { changeId, changeTitle, tasks }
}

// ---------------------------------------------------------------------------
// Task contract parsing (YAML front-matter + markdown body)
// ---------------------------------------------------------------------------

interface TaskContractFrontMatter {
  task_id: string
  change_id?: string
  title?: string
  status: string
  priority?: string
}

interface ParsedTaskContract {
  frontMatter: TaskContractFrontMatter
  description: string
  acceptanceCriteria: { text: string; done: boolean }[]
}

/**
 * Minimal YAML front-matter parser — only handles the flat key: value pairs
 * used in task contracts. Does not handle nested YAML.
 */
function parseSimpleYaml(yamlText: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const line of yamlText.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const value = match[2].trim()
    // handle bracket arrays like `[]` or `[T-001, T-002]`
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim()
      result[key] = inner ? inner.split(',').map((s) => s.trim()) : []
    } else {
      result[key] = value
    }
  }

  return result
}

function parseTaskContract(content: string): ParsedTaskContract | null {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (!fmMatch) return null

  const yamlText = fmMatch[1]
  const parsed = parseSimpleYaml(yamlText)

  const taskId = typeof parsed['task_id'] === 'string' ? parsed['task_id'] : null
  const status = typeof parsed['status'] === 'string' ? parsed['status'] : 'pending'
  if (!taskId) return null

  const frontMatter: TaskContractFrontMatter = {
    task_id: taskId,
    change_id: typeof parsed['change_id'] === 'string' ? parsed['change_id'] : undefined,
    title: typeof parsed['title'] === 'string' ? parsed['title'] : undefined,
    status,
    priority: typeof parsed['priority'] === 'string' ? parsed['priority'] : undefined
  }

  // Extract body after the closing `---`
  const bodyStart = fmMatch[0].length
  const body = content.slice(bodyStart)

  // Parse description from ## Description section
  const descMatch = /##\s+Description\r?\n([\s\S]*?)(?=\n##\s|\s*$)/.exec(body)
  const description = descMatch ? descMatch[1].trim() : ''

  // Parse acceptance criteria from ## Acceptance Criteria section
  const acSectionMatch = /##\s+Acceptance Criteria\r?\n([\s\S]*?)(?=\n##\s|\s*$)/.exec(body)
  const acceptanceCriteria: { text: string; done: boolean }[] = []
  if (acSectionMatch) {
    for (const line of acSectionMatch[1].split('\n')) {
      const doneMatch = /^-\s*\[x\]\s*(.+)/i.exec(line)
      const todoMatch = /^-\s*\[\s*\]\s*(.+)/.exec(line)
      if (doneMatch) {
        acceptanceCriteria.push({ text: doneMatch[1].trim(), done: true })
      } else if (todoMatch) {
        acceptanceCriteria.push({ text: todoMatch[1].trim(), done: false })
      }
    }
  }

  return { frontMatter, description, acceptanceCriteria }
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

interface RuntimeTaskEntry {
  status: string
  started_at?: string | null
  updated_at?: string | null
  completed_at?: string | null
}

interface NewRuntimeState {
  changes: Record<
    string,
    {
      active_task_ref: string | null
      updated_at?: string
      tasks: Record<string, RuntimeTaskEntry>
    }
  >
}

interface LegacyRuntimeState {
  tasks: Record<string, RuntimeTaskEntry>
}

async function readRuntimeState(
  superplanRoot: string,
  changeId: string
): Promise<{
  tasks: Record<string, RuntimeTaskEntry>
  activeTaskRef: string | null
  updatedAt: string | null
}> {
  const tasksPath = path.join(superplanRoot, 'runtime', 'tasks.json')
  try {
    const raw = await fs.readFile(tasksPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown

    if (
      parsed &&
      typeof parsed === 'object' &&
      'changes' in parsed
    ) {
      const state = parsed as NewRuntimeState
      const entry = state.changes[changeId]
      return {
        tasks: entry?.tasks ?? {},
        activeTaskRef: entry?.active_task_ref ?? null,
        updatedAt: entry?.updated_at ?? null
      }
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      'tasks' in parsed &&
      !('changes' in parsed)
    ) {
      const state = parsed as LegacyRuntimeState
      return { tasks: state.tasks, activeTaskRef: null, updatedAt: null }
    }
  } catch {
    // missing or malformed — treat as empty
  }

  return { tasks: {}, activeTaskRef: null, updatedAt: null }
}

// ---------------------------------------------------------------------------
// Status resolution
// ---------------------------------------------------------------------------

function resolveViewStatus(
  contractStatus: string,
  runtimeStatus: string | undefined,
  _taskId: string,
  _activeTaskRef: string | null
): DesktopChangeViewStatus {
  const effective = runtimeStatus ?? contractStatus

  switch (effective) {
    case 'done':
      return 'done'
    case 'tracking':
    case 'in_progress':
      return 'in_progress'
    case 'blocked':
      return 'blocked'
    case 'needs_feedback':
      return 'needs_feedback'
    case 'in_review':
      return 'in_review'
    default:
      return 'backlog'
  }
}

function resolvePriority(raw: string | undefined): 'high' | 'medium' | 'low' | null {
  if (raw === 'high' || raw === 'medium' || raw === 'low') return raw
  return null
}

// ---------------------------------------------------------------------------
// Dependency readiness
// ---------------------------------------------------------------------------

function isTaskReady(
  _taskId: string,
  graphTask: GraphTaskEntry,
  runtimeTasks: Record<string, RuntimeTaskEntry>
): boolean {
  for (const dep of graphTask.dependsOnAll) {
    const rt = runtimeTasks[dep]
    if (!rt || rt.status !== 'done') return false
  }

  if (graphTask.dependsOnAny.length > 0) {
    const anyDone = graphTask.dependsOnAny.some((dep) => runtimeTasks[dep]?.status === 'done')
    if (!anyDone) return false
  }

  return true
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getChangeSnapshot(
  workspacePath: string,
  changeId: string
): Promise<DesktopChangeSnapshot | null> {
  const superplanRoot = GLOBAL_SUPERPLAN_DIR
  const workspaceName = path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'workspace-root'
  const changeRoot = path.join(superplanRoot, `workspace-${workspaceName}`, 'changes', changeId)
  const tasksIndexPath = path.join(changeRoot, 'tasks.md')

  if (!await pathExists(tasksIndexPath)) return null

  let tasksIndexContent: string
  try {
    tasksIndexContent = await fs.readFile(tasksIndexPath, 'utf-8')
  } catch {
    return null
  }

  const graphMeta = parseGraphMetadata(tasksIndexContent)
  if (!graphMeta) return null

  const { tasks: runtimeTasks, activeTaskRef, updatedAt: runtimeUpdatedAt } =
    await readRuntimeState(path.join(superplanRoot, `workspace-${workspaceName}`), changeId)

  const tasksDir = path.join(changeRoot, 'tasks')
  const desktopTasks: DesktopChangeTask[] = []
  const workstreams = new Set<string>()
  let lastUpdatedAt = runtimeUpdatedAt

  for (const graphTask of graphMeta.tasks) {
    const taskFilePath = path.join(tasksDir, `${graphTask.taskId}.md`)
    let contract: ParsedTaskContract | null = null

    try {
      const contractContent = await fs.readFile(taskFilePath, 'utf-8')
      contract = parseTaskContract(contractContent)
    } catch {
      // task contract may not be scaffolded yet — fall back to graph data
    }

    const runtimeEntry = runtimeTasks[graphTask.taskId]
    const contractStatus = contract?.frontMatter.status ?? 'pending'
    const viewStatus = resolveViewStatus(
      contractStatus,
      runtimeEntry?.status,
      graphTask.taskId,
      activeTaskRef
    )

    const acItems = contract?.acceptanceCriteria ?? []
    const incompleteAc = acItems.filter((item) => !item.done).map((item) => item.text)
    const completedAc = acItems.filter((item) => item.done).map((item) => item.text)
    const acceptanceCriteria = [...incompleteAc, ...completedAc]
    const acceptanceTotal = acItems.length
    const acceptanceCompleted = completedAc.length
    const progressPct =
      acceptanceTotal > 0 ? Math.round((acceptanceCompleted / acceptanceTotal) * 100) : 0

    const taskUpdatedAt = runtimeEntry?.updated_at ?? null
    if (taskUpdatedAt && (!lastUpdatedAt || taskUpdatedAt > lastUpdatedAt)) {
      lastUpdatedAt = taskUpdatedAt
    }

    const taskTitle = contract?.frontMatter.title ?? graphTask.title
    const description = contract?.description ?? graphTask.title
    const descriptionExcerpt =
      description.length > 120 ? `${description.slice(0, 120).trimEnd()}…` : description

    const ready = isTaskReady(graphTask.taskId, graphTask, runtimeTasks)

    desktopTasks.push({
      ref: graphTask.taskId,
      title: taskTitle,
      descriptionExcerpt,
      fullDescription: description,
      status: viewStatus,
      ready,
      priority: resolvePriority(contract?.frontMatter.priority),
      acceptanceTotal,
      acceptanceCompleted,
      acceptanceCriteria,
      progressPct,
      dependencies: graphTask.dependsOnAll,
      workstream: null,
      createdAt: runtimeEntry?.started_at ?? null,
      updatedAt: runtimeEntry?.updated_at ?? null,
      reason: null,
      message: null,
      filePath: null
    })
  }

  // Derive overall snapshot status
  const totalCount = desktopTasks.length
  const completedCount = desktopTasks.filter((t) => t.status === 'done').length
  const hasInProgress = desktopTasks.some((t) => t.status === 'in_progress')

  let status: 'active' | 'idle' | 'done'
  if (totalCount > 0 && completedCount === totalCount) {
    status = 'done'
  } else if (hasInProgress) {
    status = 'active'
  } else {
    status = 'idle'
  }

  const progressPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const workstreamList = [...workstreams].sort()

  return {
    changeId: graphMeta.changeId,
    changeTitle: graphMeta.changeTitle,
    status,
    progressPct,
    completedCount,
    totalCount,
    updatedAt: lastUpdatedAt ?? new Date(0).toISOString(),
    activeTaskRef,
    workstreams: workstreamList,
    tasks: desktopTasks
  }
}

/**
 * ChangeRightPanel — the main right-panel surface for a selected change.
 *
 * Contains:
 *  - sticky header (title, status badge, progress bar, counts, updated time, active task callout)
 *  - Board view  (kanban, 6 fixed columns)
 *  - List view   (grouped execution buckets)
 *  - TaskDetailModal (centered, read-only)
 */

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DialogRoot,
  DialogPortal,
  DialogBackdrop,
  DialogPopup,
  DialogClose,
  DialogTitle
} from '@/components/ui/dialog'
import {
  IconLoader2,
  IconAlertCircle,
  IconCircleCheck,
  IconArrowRight,
  IconBrandOpenai,
  IconMessageCircle,
  IconLayoutKanban,
  IconList,
  IconGitBranch,
  IconClock,
  IconCopy,
  IconExternalLink,
  IconRocket,
  IconTerminal2
} from '@tabler/icons-react'
import type { DesktopChangeSnapshot, DesktopChangeTask, DesktopChangeViewStatus } from '../../../shared/desktop-contract'

// ---------------------------------------------------------------------------
// Acceptance checklist — incomplete items first, cut-line, then completed
// ---------------------------------------------------------------------------

function AcceptanceChecklist({ task }: { task: DesktopChangeTask }): React.JSX.Element | null {
  if (task.acceptanceTotal === 0) return null

  const items = task.acceptanceCriteria
  const doneCount = task.acceptanceCompleted
  const totalCount = task.acceptanceTotal

  // Convention: incomplete items first (indices 0..total-done-1), done items last
  const incompleteItems = items.slice(0, totalCount - doneCount)
  const completeItems = items.slice(totalCount - doneCount)

  return (
    <section>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/45">
        Acceptance — {doneCount}/{totalCount}
      </h3>
      <div className="flex flex-col gap-0">
        {/* Incomplete items */}
        {incompleteItems.map((item, i) => (
          <div key={`incomplete-${i}`} className="flex items-start gap-2 py-[5px]">
            <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-foreground/[0.15]" />
            <span className="text-[12px] leading-snug text-foreground/72">{item}</span>
          </div>
        ))}

        {/* Cut-line separator — only shown when both lists are non-empty */}
        {incompleteItems.length > 0 && completeItems.length > 0 && (
          <div className="my-2 flex items-center gap-2">
            <div className="h-px flex-1 bg-foreground/[0.06]" />
            <span className="text-[9.5px] text-muted-foreground/25">{doneCount} done</span>
            <div className="h-px flex-1 bg-foreground/[0.06]" />
          </div>
        )}

        {/* Completed items — struck through and dimmed */}
        {completeItems.map((item, i) => (
          <div key={`complete-${i}`} className="flex items-start gap-2 py-[5px]">
            <IconCircleCheck
              style={{ width: 14, height: 14, marginTop: 1, flexShrink: 0 }}
              className="text-emerald-600 dark:text-emerald-400/40"
              stroke={2}
            />
            <span className="text-[12px] leading-snug text-muted-foreground/28 line-through decoration-foreground/[0.12]">
              {item}
            </span>
          </div>
        ))}

        {/* Edge case: all done, no incomplete — just show the done list without cut-line */}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(iso: string | null): string {
  if (!iso) return ''
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type StatusMeta = {
  badge: 'default' | 'secondary' | 'outline' | 'success' | 'active'
  dot: string
  label: string
}

const STATUS_META: Record<DesktopChangeViewStatus, StatusMeta> = {
  backlog:        { badge: 'secondary', dot: 'bg-foreground/20',  label: 'Backlog' },
  in_progress:    { badge: 'active',    dot: 'bg-sky-500 dark:bg-sky-400',        label: 'In Progress' },
  in_review:      { badge: 'outline',   dot: 'bg-violet-500 dark:bg-violet-400',     label: 'In Review' },
  blocked:        { badge: 'default',   dot: 'bg-red-500 dark:bg-red-400',        label: 'Blocked' },
  needs_feedback: { badge: 'default',   dot: 'bg-amber-500 dark:bg-amber-400',      label: 'Needs Feedback' },
  done:           { badge: 'success',   dot: 'bg-emerald-500 dark:bg-emerald-400',    label: 'Done' }
}

const CHANGE_STATUS_META = {
  active: { badge: 'active' as const,     label: 'Active' },
  idle:   { badge: 'secondary' as const,  label: 'Idle' },
  done:   { badge: 'success' as const,    label: 'Done' }
}

const FAVORITE_AGENTS = [
  {
    label: 'Codex',
    href: 'https://chatgpt.com/codex',
    icon: IconBrandOpenai
  },
  {
    label: 'Claude Code',
    href: 'https://www.anthropic.com/claude-code',
    icon: IconRocket
  },
  {
    label: 'Cursor',
    href: 'https://cursor.com',
    icon: IconExternalLink
  },
  {
    label: 'OpenCode',
    href: 'https://github.com/sst/opencode',
    icon: IconExternalLink
  }
] as const

const INIT_COMMAND = 'superplan init'

// ---------------------------------------------------------------------------
// TaskDetailModal
// ---------------------------------------------------------------------------

interface TaskDetailModalProps {
  task: DesktopChangeTask | null
  open: boolean
  onClose: () => void
}

function TaskDetailModal({ task, open, onClose }: TaskDetailModalProps): React.JSX.Element {
  return (
    <DialogRoot open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="w-full max-w-xl flex-col gap-0 overflow-hidden">
          {task ? (
            <>
              <DialogClose />

              {/* Header */}
              <div className="px-5 pb-3 pt-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground/50">{task.ref}</span>
                  <Badge variant={STATUS_META[task.status].badge} className="gap-1">
                    <span className={cn('inline-block h-1.5 w-1.5 rounded-full', STATUS_META[task.status].dot)} />
                    {STATUS_META[task.status].label}
                  </Badge>
                </div>
                <DialogTitle className="text-sm font-semibold leading-snug text-foreground">
                  {task.title}
                </DialogTitle>
              </div>

              <div className="h-px bg-foreground/[0.06]" />

              {/* Body */}
              <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-5 py-4">

                {/* Description */}
                {task.fullDescription && (
                  <section>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/45">
                      Description
                    </h3>
                    <p className="text-[12.5px] leading-relaxed text-foreground/72">
                      {task.fullDescription}
                    </p>
                  </section>
                )}

                {/* Acceptance criteria */}
                <AcceptanceChecklist task={task} />

{/* Blocked reason */}
                {task.reason && (
                  <section>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-red-600 dark:text-red-400/55">
                      Blocked Reason
                    </h3>
                    <p className="text-[12px] leading-relaxed text-red-700 dark:text-red-300/65">{task.reason}</p>
                  </section>
                )}
                {/* Feedback message */}
                {task.message && (
                  <section>
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400/55">
                      Feedback Needed
                    </h3>
                    <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-200/65">{task.message}</p>
                  </section>
                )}

                {/* Meta grid */}
                <section>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/45">
                    Details
                  </h3>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {task.workstream && (
                      <>
                        <dt className="text-[11px] text-muted-foreground/45">Workstream</dt>
                        <dd className="text-[11px] text-foreground/65">{task.workstream}</dd>
                      </>
                    )}
                    {task.dependencies.length > 0 && (
                      <>
                        <dt className="text-[11px] text-muted-foreground/45">Depends on</dt>
                        <dd className="text-[11px] text-foreground/65">{task.dependencies.join(', ')}</dd>
                      </>
                    )}
                    {task.filePath && (
                      <>
                        <dt className="text-[11px] text-muted-foreground/45">File</dt>
                        <dd className="break-all font-mono text-[11px] text-foreground/55">{task.filePath}</dd>
                      </>
                    )}
                    {task.updatedAt && (
                      <>
                        <dt className="text-[11px] text-muted-foreground/45">Updated</dt>
                        <dd className="text-[11px] text-foreground/45">{formatRelativeTime(task.updatedAt)}</dd>
                      </>
                    )}
                    {task.createdAt && (
                      <>
                        <dt className="text-[11px] text-muted-foreground/45">Created</dt>
                        <dd className="text-[11px] text-foreground/45">{formatRelativeTime(task.createdAt)}</dd>
                      </>
                    )}
                  </dl>
                </section>
              </div>
            </>
          ) : null}
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  )
}

// ---------------------------------------------------------------------------
// Task card (Board)
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: DesktopChangeTask
  onClick: () => void
  showReadiness?: boolean
}

function TaskCard({ task, onClick, showReadiness }: TaskCardProps): React.JSX.Element {
  const hasReason = !!task.reason
  const hasMessage = !!task.message

  return (
    <button
      className="group w-full rounded-md border border-foreground/[0.07] bg-foreground/[0.025] p-2 text-left transition-colors hover:border-foreground/[0.12] hover:bg-foreground/[0.045]"
      onClick={onClick}
      type="button"
    >
      {/* Row 1: ref + readiness */}
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground/40">{task.ref}</span>
        {showReadiness && task.ready && (
          <span className="ml-auto text-[9.5px] text-muted-foreground/30">
            deps clear
          </span>
        )}
      </div>

      {/* Row 2: title */}
      <p className="mb-2 line-clamp-2 text-[13px] font-medium leading-snug text-foreground/85">
        {task.title}
      </p>

      {/* Inline reason / message */}
      {hasReason && (
        <p className="mb-1.5 flex gap-1 line-clamp-1 text-[10.5px] leading-snug text-red-600 dark:text-red-300/60">
          <IconAlertCircle style={{ width: 10, height: 10, marginTop: 1, flexShrink: 0 }} stroke={2} />
          {task.reason}
        </p>
      )}
      {hasMessage && (
        <p className="mb-1.5 flex gap-1 line-clamp-1 text-[10.5px] leading-snug text-amber-700 dark:text-amber-200/60">
          <IconMessageCircle style={{ width: 10, height: 10, marginTop: 1, flexShrink: 0 }} stroke={2} />
          {task.message}
        </p>
      )}

      {/* Footer: acceptance + workstream + deps */}
      <div className="flex flex-wrap items-center gap-1.5">
        {task.acceptanceTotal > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/45">
            <IconCircleCheck style={{ width: 10, height: 10 }} stroke={2} />
            {task.acceptanceCompleted}/{task.acceptanceTotal}
          </span>
        )}
        {task.workstream && (
          <span className="rounded-sm bg-foreground/[0.09] px-1.5 py-px text-[10px] font-medium text-muted-foreground/55">
            {task.workstream}
          </span>
        )}
        {task.dependencies.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/35">
            <IconGitBranch style={{ width: 10, height: 10 }} stroke={2} />
            {task.dependencies.length}
          </span>
        )}
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Board view
// ---------------------------------------------------------------------------

const BOARD_COLUMNS: { id: DesktopChangeViewStatus; label: string }[] = [
  { id: 'backlog',         label: 'Backlog' },
  { id: 'in_progress',    label: 'In Progress' },
  { id: 'needs_feedback', label: 'Needs Feedback' },
  { id: 'blocked',        label: 'Blocked' },
  { id: 'in_review',      label: 'In Review' },
  { id: 'done',           label: 'Done' }
]

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

function sortBacklog(tasks: DesktopChangeTask[]): DesktopChangeTask[] {
  return [...tasks].sort((a, b) => {
    const ra = a.ready ? 0 : 1
    const rb = b.ready ? 0 : 1
    if (ra !== rb) return ra - rb
    const pa = PRIORITY_ORDER[a.priority ?? 'low'] ?? 2
    const pb = PRIORITY_ORDER[b.priority ?? 'low'] ?? 2
    if (pa !== pb) return pa - pb
    return a.ref.localeCompare(b.ref)
  })
}

interface BoardViewProps {
  tasks: DesktopChangeTask[]
  onTaskClick: (task: DesktopChangeTask) => void
}

function BoardView({ tasks, onTaskClick }: BoardViewProps): React.JSX.Element {
  const byStatus = new Map<DesktopChangeViewStatus, DesktopChangeTask[]>()
  for (const col of BOARD_COLUMNS) byStatus.set(col.id, [])
  for (const task of tasks) {
    byStatus.get(task.status)?.push(task)
  }
  byStatus.set('backlog', sortBacklog(byStatus.get('backlog') ?? []))

  // Populated columns float before empty ones; canonical order preserved within each tier
  const orderedColumns = [
    ...BOARD_COLUMNS.filter((col) => (byStatus.get(col.id) ?? []).length > 0),
    ...BOARD_COLUMNS.filter((col) => (byStatus.get(col.id) ?? []).length === 0)
  ]

  return (
    // Right-fade scroll hint via a mask on the outer wrapper
    <div
      className="relative flex h-full min-w-0"
      style={{
        maskImage: 'linear-gradient(to right, black calc(100% - 40px), transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 40px), transparent 100%)'
      }}
    >
      <div className="flex h-full gap-2.5 overflow-x-auto pb-3 pr-10">
        {orderedColumns.map((col) => {
          const colTasks = byStatus.get(col.id) ?? []
          const meta = STATUS_META[col.id]
          const isBacklog = col.id === 'backlog'
          const isEmpty = colTasks.length === 0

          return (
            <div
              key={col.id}
              className={cn(
                'flex w-[196px] shrink-0 flex-col gap-1.5',
                isEmpty && 'opacity-40'
              )}
            >
              {/* Column header */}
              <div className="flex items-center gap-1.5 px-0.5 pb-0.5">
                <span className={cn('inline-block h-1.5 w-1.5 rounded-full', meta.dot)} />
                <span className="text-[10.5px] font-semibold text-foreground/45">{col.label}</span>
                {!isEmpty && (
                  <span className="ml-auto text-[10px] text-muted-foreground/30">{colTasks.length}</span>
                )}
              </div>

              {/* Cards — no "Empty" label, just visually subdued */}
              <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.ref}
                    task={task}
                    onClick={() => onTaskClick(task)}
                    showReadiness={isBacklog}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------

const LIST_GROUPS: { id: DesktopChangeViewStatus; label: string; sortBy: 'priority' | 'activity' }[] = [
  { id: 'in_progress',    label: 'In Progress',    sortBy: 'priority' },
  { id: 'needs_feedback', label: 'Needs Feedback',  sortBy: 'activity' },
  { id: 'blocked',        label: 'Blocked',         sortBy: 'activity' },
  { id: 'backlog',        label: 'Backlog',         sortBy: 'priority' },
  { id: 'in_review',      label: 'In Review',       sortBy: 'activity' },
  { id: 'done',           label: 'Done',            sortBy: 'activity' }
]

function sortByActivity(tasks: DesktopChangeTask[]): DesktopChangeTask[] {
  return [...tasks].sort((a, b) => {
    const ta = a.updatedAt ?? a.createdAt ?? ''
    const tb = b.updatedAt ?? b.createdAt ?? ''
    return tb.localeCompare(ta)
  })
}

function sortByPriority(tasks: DesktopChangeTask[]): DesktopChangeTask[] {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? 'low'] ?? 2
    const pb = PRIORITY_ORDER[b.priority ?? 'low'] ?? 2
    if (pa !== pb) return pa - pb
    return a.ref.localeCompare(b.ref)
  })
}

interface ListViewProps {
  tasks: DesktopChangeTask[]
  onTaskClick: (task: DesktopChangeTask) => void
}

function ListView({ tasks, onTaskClick }: ListViewProps): React.JSX.Element {
  const byStatus = new Map<DesktopChangeViewStatus, DesktopChangeTask[]>()
  for (const g of LIST_GROUPS) byStatus.set(g.id, [])
  for (const task of tasks) {
    byStatus.get(task.status)?.push(task)
  }

  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto pb-4 pr-4">
      {LIST_GROUPS.map((group) => {
        const rawTasks = byStatus.get(group.id) ?? []
        if (rawTasks.length === 0) return null
        const sorted = group.sortBy === 'priority' ? sortByPriority(rawTasks) : sortByActivity(rawTasks)
        const meta = STATUS_META[group.id]

        return (
          <section key={group.id}>
            {/* Group header */}
            <div className="mb-1 flex items-center gap-1.5">
              <span className={cn('inline-block h-1.5 w-1.5 rounded-full', meta.dot)} />
              <span className="text-[10.5px] font-semibold text-foreground/45">{group.label}</span>
              <span className="text-[10px] text-muted-foreground/30">{sorted.length}</span>
            </div>

            {/* Rows */}
            <div className="flex flex-col overflow-hidden rounded-md border border-foreground/[0.07]">
              {sorted.map((task, idx) => (
                <button
                  key={task.ref}
                  className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-foreground/[0.03]',
                  idx !== 0 && 'border-t border-foreground/[0.04]'
                  )}
                  onClick={() => onTaskClick(task)}
                  type="button"
                >
                  {/* Status dot */}
                  <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} />

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">{task.ref}</span>
                      <span className="truncate text-[13px] font-medium text-foreground/85">{task.title}</span>
                    </div>
                    {(task.reason || task.message) && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/45">
                        {task.reason ?? task.message}
                      </p>
                    )}
                  </div>

                  {/* Right meta */}
                  <div className="flex shrink-0 items-center gap-2">
                    {task.acceptanceTotal > 0 && (
                      <span className="text-[10px] text-muted-foreground/38">
                        {task.acceptanceCompleted}/{task.acceptanceTotal}
                      </span>
                    )}
                    <IconArrowRight style={{ width: 11, height: 11 }} className="text-muted-foreground/22" stroke={2} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel header — 2-row design, compact
// ---------------------------------------------------------------------------

interface PanelHeaderProps {
  snapshot: DesktopChangeSnapshot
  view: 'board' | 'list'
  onViewChange: (v: 'board' | 'list') => void
}

function PanelHeader({ snapshot, view, onViewChange }: PanelHeaderProps): React.JSX.Element {
  const changeStatusMeta = CHANGE_STATUS_META[snapshot.status]
  const activeTask = snapshot.tasks.find((t) => t.ref === snapshot.activeTaskRef) ?? null

  return (
    <div className="shrink-0 border-b border-foreground/[0.055] px-5 pb-2.5 pt-3.5">

      {/* Row 1: title · badge · [active task] · view toggle */}
      <div className="mb-2 flex min-w-0 items-center gap-2">
        {/* Title */}
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight text-foreground/88">
          {snapshot.changeTitle}
        </h2>

        {/* Status badge — inline, not isolated */}
        <Badge variant={changeStatusMeta.badge} className="shrink-0">
          {changeStatusMeta.label}
        </Badge>

        {/* Segmented view toggle */}
        <div className="flex shrink-0 items-center rounded-md bg-foreground/[0.05] p-0.5">
          <button
            className={cn(
              'flex items-center gap-1 rounded px-2 py-[3px] text-[10.5px] font-medium transition-colors',
              view === 'board'
                ? 'bg-foreground/[0.09] text-foreground/80 shadow-sm'
                : 'text-muted-foreground/45 hover:text-foreground/55'
            )}
            onClick={() => onViewChange('board')}
            type="button"
          >
            <IconLayoutKanban style={{ width: 11, height: 11 }} stroke={2} />
            Board
          </button>
          <button
            className={cn(
              'flex items-center gap-1 rounded px-2 py-[3px] text-[10.5px] font-medium transition-colors',
              view === 'list'
                ? 'bg-foreground/[0.09] text-foreground/80 shadow-sm'
                : 'text-muted-foreground/45 hover:text-foreground/55'
            )}
            onClick={() => onViewChange('list')}
            type="button"
          >
            <IconList style={{ width: 11, height: 11 }} stroke={2} />
            List
          </button>
        </div>
      </div>

      {/* Row 2: progress bar · counts · updated · active task callout */}
      <div className="flex min-w-0 items-center gap-2.5">

        {/* Progress bar — proportional, not full-width stretch */}
        <div className="flex items-center gap-1.5">
          <div className="h-[3px] w-28 overflow-hidden rounded-full bg-foreground/[0.08]">
            <div
              className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400/55 transition-all duration-500"
              style={{ width: `${snapshot.progressPct}%` }}
            />
          </div>
          <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground/45">
            {snapshot.completedCount}/{snapshot.totalCount}
          </span>
        </div>

        {/* Separator dot */}
        <span className="text-foreground/12 select-none">·</span>

        {/* Updated time */}
        {snapshot.updatedAt && (
          <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground/32">
            <IconClock style={{ width: 10, height: 10 }} stroke={1.8} />
            {formatRelativeTime(snapshot.updatedAt)}
          </span>
        )}

        {/* Active task inline callout — only shown when present, stays in row 2 */}
        {activeTask && (
          <>
            <span className="text-foreground/12 select-none">·</span>
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              <IconLoader2
                style={{ width: 10, height: 10, animationDuration: '3s', flexShrink: 0 }}
                className="animate-spin text-sky-600 dark:text-sky-400/65"
                stroke={2}
              />
              <span className="truncate text-[10.5px] text-sky-700 dark:text-sky-300/70">
                <span className="font-mono text-[9.5px] text-sky-600 dark:text-sky-400/45 mr-0.5">{activeTask.ref}</span>
                {activeTask.title}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shell states
// ---------------------------------------------------------------------------

function LoadingState(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground/35">
        <IconLoader2
          className="animate-spin"
          style={{ width: 18, height: 18, animationDuration: '2s' }}
          stroke={1.5}
        />
        <span className="text-[11.5px]">Loading…</span>
      </div>
    </div>
  )
}

function EmptyState({
  title,
  description,
  showActions = false
}: {
  title: string
  description: string
  showActions?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  async function handleCopyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(INIT_COMMAND)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  function handleOpenAgent(href: string): void {
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.018] px-5 py-5 text-left shadow-[0_12px_40px_rgba(15,23,42,0.04)]">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-foreground/55">
              <IconTerminal2 style={{ width: 18, height: 18 }} stroke={1.8} />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-foreground/82">{title}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground/52">{description}</p>
            </div>
          </div>

          {showActions ? (
            <>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/42">
                Favorite Coding Agents
              </div>
              <div className="grid grid-cols-2 gap-2">
                {FAVORITE_AGENTS.map((agent) => {
                  const Icon = agent.icon
                  return (
                    <Button
                      key={agent.label}
                      className="h-9 justify-between rounded-xl border border-foreground/[0.06] bg-background/80 px-3 text-foreground/72 hover:bg-foreground/[0.035] hover:text-foreground/86"
                      onClick={() => handleOpenAgent(agent.href)}
                      size="sm"
                      variant="outline"
                    >
                      <span className="flex items-center gap-2">
                        <Icon style={{ width: 13, height: 13 }} stroke={1.9} />
                        {agent.label}
                      </span>
                      <IconExternalLink style={{ width: 11, height: 11 }} stroke={2} />
                    </Button>
                  )
                })}
              </div>

              <div className="mt-4 border-t border-foreground/[0.06] pt-4">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/42">
                  Initialize Superplan
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-foreground/[0.06] bg-background/75 p-2">
                  <code className="min-w-0 flex-1 truncate px-1 text-[12px] text-foreground/72">{INIT_COMMAND}</code>
                  <Button
                    className="gap-1.5 rounded-lg px-2.5 text-foreground/68 hover:text-foreground/85"
                    onClick={() => void handleCopyCommand()}
                    size="sm"
                    variant="ghost"
                  >
                    <IconCopy style={{ width: 12, height: 12 }} stroke={1.9} />
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function UnavailableState(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-1.5 text-muted-foreground/28">
        <IconAlertCircle style={{ width: 16, height: 16 }} stroke={1.5} />
        <span className="text-[11.5px]">Change unavailable</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root export
// ---------------------------------------------------------------------------

interface ChangeRightPanelProps {
  snapshot: DesktopChangeSnapshot | null | 'loading'
}

export function ChangeRightPanel({ snapshot }: ChangeRightPanelProps): React.JSX.Element {
  const [view, setView] = useState<'board' | 'list'>('board')
  const [selectedTask, setSelectedTask] = useState<DesktopChangeTask | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  function handleTaskClick(task: DesktopChangeTask): void {
    setSelectedTask(task)
    setModalOpen(true)
  }

  function handleModalClose(): void {
    setModalOpen(false)
  }

  if (snapshot === 'loading') return <LoadingState />
  if (snapshot === null) {
    return (
      <EmptyState
        description="Open one of your coding agents or copy the init command to get a workspace ready."
        showActions
        title="No change selected"
      />
    )
  }

  const data = snapshot as DesktopChangeSnapshot
  if (!data.changeId) return <UnavailableState />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PanelHeader snapshot={data} view={view} onViewChange={setView} />

      {data.totalCount === 0 ? (
        <EmptyState
          description="This change exists, but it does not have any tasks yet."
          title="No tasks yet"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden pl-5 pt-3">
          {view === 'board' ? (
            <BoardView tasks={data.tasks} onTaskClick={handleTaskClick} />
          ) : (
            <ListView tasks={data.tasks} onTaskClick={handleTaskClick} />
          )}
        </div>
      )}

      <TaskDetailModal task={selectedTask} open={modalOpen} onClose={handleModalClose} />
    </div>
  )
}

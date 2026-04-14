import { useEffect, useState } from 'react'
import {
  IconArchive,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconLoader2,
  IconLayoutBoard,
  IconPin,
  IconPinFilled,
  IconPointFilled,
  IconSettings2
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SettingsDialog } from '@/components/settings-dialog'
import type { DesktopWorkspaceNavigationItem } from '../../../shared/desktop-contract'

interface WorkspaceSidebarProps {
  workspaces: DesktopWorkspaceNavigationItem[]
  activeWorkspaceId: string | null
  activeChangeId: string | null
  layout?: 'windowed' | 'fullscreen'
  onWorkspaceSelected: (workspaceId: string) => void
  onChangeSelected: (workspaceId: string, changeId: string) => void
  onOpenBoardAtChange?: (workspaceId: string, changeId: string) => void
  onArchiveChange?: (workspaceId: string, changeId: string) => void
  topControl?: React.ReactNode
}

export function WorkspaceSidebar({
  workspaces,
  activeWorkspaceId,
  activeChangeId,
  layout = 'windowed',
  onWorkspaceSelected,
  onChangeSelected,
  onOpenBoardAtChange,
  onArchiveChange,
  topControl
}: WorkspaceSidebarProps): React.JSX.Element {
  const isFullscreen = layout === 'fullscreen'
  // const overlayEnabled = useDesktopConfigStore((state) => state.config.overlayEnabled)
  // TODO: enable overlay toggle once the feature is stable.
  // const mergeConfig = useDesktopConfigStore((state) => state.mergeConfig)
  const [openWorkspaces, setOpenWorkspaces] = useState<Set<string>>(new Set())
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    setOpenWorkspaces((prev) => {
      const next = new Set<string>()

      workspaces.forEach((workspace) => {
        if (
          prev.has(workspace.id) ||
          workspace.id === activeWorkspaceId ||
          workspace.changes.some((change) => change.inProgress)
        ) {
          next.add(workspace.id)
        }
      })

      if (next.size === 0 && workspaces.length > 0) {
        next.add(activeWorkspaceId ?? workspaces[0].id)
      }

      return next
    })
  }, [activeWorkspaceId, workspaces])

  const toggleWorkspace = (workspaceId: string): void => {
    setOpenWorkspaces((prev) => {
      const next = new Set(prev)
      if (next.has(workspaceId)) {
        next.delete(workspaceId)
      } else {
        next.add(workspaceId)
      }
      return next
    })
    onWorkspaceSelected(workspaceId)
  }

  const togglePin = (id: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedChange =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.changes.find(
      (change) => change.id === activeChangeId
    ) ?? null

  function handleOpenBoardAtChange(): void {
    if (!activeWorkspaceId || !activeChangeId) return
    onOpenBoardAtChange?.(activeWorkspaceId, activeChangeId)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {topControl ? (
        <div className="drag-region flex h-5 shrink-0 items-start justify-start">{topControl}</div>
      ) : null}

      <div className={cn(isFullscreen ? 'pb-1.5 pt-1' : 'pb-1.5 pt-0.5')}>
        <div
          style={{ fontSize: '10px', letterSpacing: '0.08em' }}
          className="font-semibold uppercase text-muted-foreground/45"
        >
          Workspaces
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-0.5">
          {workspaces.map((workspace) => {
            const isOpen = openWorkspaces.has(workspace.id)

            // Sort changes: pinned first, then by lastActiveAt descending
            const sortedChanges = [...workspace.changes].sort((a, b) => {
              const aUniqueId = `${workspace.id}:${a.id}`
              const bUniqueId = `${workspace.id}:${b.id}`
              const aPinned = pinnedIds.has(aUniqueId) ? 0 : 1
              const bPinned = pinnedIds.has(bUniqueId) ? 0 : 1
              if (aPinned !== bPinned) return aPinned - bPinned
              return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
            })

            return (
              <div key={workspace.id}>
                {/* Workspace header row */}
                <button
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-[4px] text-left hover:bg-foreground/[0.04]"
                  onClick={() => toggleWorkspace(workspace.id)}
                >
                  <IconFolder
                    style={{ width: 12, height: 12 }}
                    className="shrink-0 text-foreground/42"
                    stroke={1.8}
                  />
                  <span
                    style={{ fontSize: '12.5px', fontWeight: 520 }}
                    className="min-w-0 flex-1 truncate text-foreground/62"
                  >
                    {workspace.name.toLowerCase()}
                  </span>
                  {isOpen ? (
                    <IconChevronDown
                      style={{ width: 10, height: 10 }}
                      className="shrink-0 text-muted-foreground/48"
                      stroke={2.5}
                    />
                  ) : (
                    <IconChevronRight
                      style={{ width: 10, height: 10 }}
                      className="shrink-0 text-muted-foreground/48"
                      stroke={2.5}
                    />
                  )}
                </button>

                {/* Change items */}
                {isOpen && sortedChanges.length > 0 && (
                  <div className="space-y-px py-px">
                    {sortedChanges.map((change) => {
                      const selected =
                        workspace.id === activeWorkspaceId && change.id === activeChangeId
                      const uniqueId = `${workspace.id}:${change.id}`
                      const hovered = hoveredId === uniqueId
                      const pinned = pinnedIds.has(uniqueId)

                      return (
                        <button
                          key={uniqueId}
                          className={cn(
                            'group flex w-full h-[28px] items-center gap-1.5 rounded-md px-2 text-left',
                            selected
                              ? 'bg-foreground/[0.07] text-foreground'
                              : 'text-foreground/70 hover:bg-foreground/[0.03]'
                          )}
                          onClick={() => onChangeSelected(workspace.id, change.id)}
                          onMouseEnter={() => setHoveredId(uniqueId)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Left icon slot: pin on hover/pinned, else status */}
                          <span
                            className="flex shrink-0 items-center justify-center"
                            style={{ width: 14, minWidth: 14, height: 14 }}
                          >
                            {hovered || pinned ? (
                              <span
                                title={pinned ? 'Unpin' : 'Pin'}
                                className={cn(
                                  'flex items-center justify-center',
                                  pinned
                                    ? 'text-sky-400'
                                    : 'text-foreground/50 hover:text-foreground/80'
                                )}
                                onClick={(e) => togglePin(uniqueId, e)}
                              >
                                {pinned ? (
                                  <IconPinFilled style={{ width: 12, height: 12 }} />
                                ) : (
                                  <IconPin style={{ width: 12, height: 12 }} stroke={2} />
                                )}
                              </span>
                            ) : change.inProgress ? (
                              <IconLoader2
                                style={{ width: 11, height: 11, animationDuration: '3s' }}
                                className="animate-spin opacity-40"
                                stroke={2.5}
                              />
                            ) : change.unread ? (
                              <IconPointFilled
                                style={{ width: 6, height: 6 }}
                                className="text-sky-400/80"
                              />
                            ) : null}
                          </span>

                          {/* Title + time subtitle */}
                          <div className="min-w-0 flex-1">
                            <div
                              style={{ fontSize: '12.5px', lineHeight: '1.3' }}
                              className="truncate font-medium text-foreground/88"
                            >
                              {change.title}
                            </div>
                          </div>

                          {/* Right slot: archive on hover, else task count */}
                          <span
                            className="flex shrink-0 items-center justify-end"
                            style={{ width: 32, minWidth: 32 }}
                          >
                            {hovered ? (
                              <span
                                title="Archive"
                                className="flex items-center text-foreground/50 hover:text-foreground/80"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onArchiveChange?.(workspace.id, change.id)
                                }}
                              >
                                <IconArchive style={{ width: 13, height: 13 }} stroke={1.8} />
                              </span>
                            ) : (
                              <span
                                style={{ fontSize: '12px', lineHeight: 1 }}
                                className="text-muted-foreground/40 font-medium tracking-wide"
                              >
                                {change.completedTaskCount}/{change.taskCount}
                              </span>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 border-t border-foreground/[0.06] pt-2">
        <Button
          className="mb-1 h-7 w-full justify-start gap-1.5 rounded px-2 text-foreground/50 hover:bg-foreground/[0.03] hover:text-foreground/70"
          disabled={!selectedChange}
          onClick={handleOpenBoardAtChange}
          style={{ fontSize: '12px' }}
          variant="ghost"
        >
          <IconLayoutBoard style={{ width: 12, height: 12 }} stroke={1.8} />
          {selectedChange ? 'Open board at change' : 'Select a change first'}
        </Button>

        <SettingsDialog
          trigger={
            <Button
              className="h-7 w-full justify-start gap-1.5 rounded px-2 text-foreground/50 hover:bg-foreground/[0.03] hover:text-foreground/70"
              style={{ fontSize: '12px' }}
              variant="ghost"
            >
              <IconSettings2 style={{ width: 12, height: 12 }} stroke={1.8} />
              Settings
            </Button>
          }
        />
      </div>
    </div>
  )
}

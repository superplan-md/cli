import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { ChangeRightPanel } from '@/components/change-right-panel'
import { useDesktopBootstrap } from '@/hooks/use-desktop-bootstrap'
import { useDesktopConfigStore } from '@/stores/use-desktop-config-store'
import { useDesktopLayoutStore } from '@/stores/use-desktop-layout-store'
import { useDesktopSessionStore } from '@/stores/use-desktop-session-store'
import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react'
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels'
import { startTransition, useState, useEffect, useRef } from 'react'
import { DESKTOP_CHROME_METRICS } from '../../shared/desktop-contract'
import type {
  DesktopChangeSnapshot,
  DesktopWorkspaceNavigationItem
} from '../../shared/desktop-contract'

const SIDEBAR_MIN_WIDTH = '220px'
const SIDEBAR_COLLAPSED_WIDTH = '0px'
const MAIN_PANEL_MIN_WIDTH = '360px'

function App(): React.JSX.Element {
  useDesktopBootstrap()
  const config = useDesktopConfigStore((state) => state.config)
  const mergeConfig = useDesktopConfigStore((state) => state.mergeConfig)
  const layoutState = useDesktopLayoutStore((state) => state.layoutState)
  const setPanelLayout = useDesktopLayoutStore((state) => state.setPanelLayout)
  const setNavigationCollapsed = useDesktopLayoutStore((state) => state.setNavigationCollapsed)
  const windowFullscreen = useDesktopSessionStore((state) => state.windowFullscreen)
  const lastEvent = useDesktopSessionStore((state) => state.lastEvent)
  const panelLayout = layoutState.shell.panelLayout
  const navigationCollapsed = layoutState.shell.navigationCollapsed
  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null)

  // Workspaces loaded from real filesystem via IPC
  const [workspaces, setWorkspaces] = useState<DesktopWorkspaceNavigationItem[]>([])
  const [workspaceFeedVersion, setWorkspaceFeedVersion] = useState(0)

  async function refreshWorkspaces(): Promise<DesktopWorkspaceNavigationItem[]> {
    const loaded = await window.desktop.getWorkspaces()
    setWorkspaces(loaded)
    return loaded
  }

  useEffect(() => {
    void refreshWorkspaces()
  }, [])

  useEffect(() => {
    return window.desktop.onWorkspacesChanged((nextWorkspaces) => {
      setWorkspaces(nextWorkspaces)
      setWorkspaceFeedVersion((value) => value + 1)
    })
  }, [])

  const [activeChangeId, setActiveChangeId] = useState<string | null>(null)
  const resolvedActiveWorkspaceId = config.activeWorkspaceId ?? workspaces[0]?.id ?? null
  const macosChrome = DESKTOP_CHROME_METRICS.macos
  const trafficLightsCenterY = macosChrome.trafficLights.y + macosChrome.trafficLights.diameter / 2
  const trafficLightsRightEdge =
    macosChrome.trafficLights.x +
    macosChrome.trafficLights.diameter * 3 +
    macosChrome.trafficLights.gap * 2
  const windowedSidebarButtonStyle = {
    left: `${trafficLightsRightEdge + macosChrome.sidebarControl.gapFromTrafficLights}px`,
    top: `${trafficLightsCenterY - macosChrome.sidebarControl.size / 2 + macosChrome.sidebarControl.centerYOffset}px`,
    width: `${macosChrome.sidebarControl.size}px`,
    height: `${macosChrome.sidebarControl.size}px`,
    minWidth: `${macosChrome.sidebarControl.size}px`,
    minHeight: `${macosChrome.sidebarControl.size}px`
  } as const

  const windowedSidebarIconStyle = {
    width: `${macosChrome.sidebarControl.iconSize}px`,
    height: `${macosChrome.sidebarControl.iconSize}px`
  } as const

  const fullscreenSidebarButtonStyle = {
    left: '12px',
    top: '12px',
    width: `${macosChrome.sidebarControl.size}px`,
    height: `${macosChrome.sidebarControl.size}px`,
    minWidth: `${macosChrome.sidebarControl.size}px`,
    minHeight: `${macosChrome.sidebarControl.size}px`
  } as const

  // Right panel snapshot state
  const [changeSnapshot, setChangeSnapshot] = useState<DesktopChangeSnapshot | null | 'loading'>('loading')

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === resolvedActiveWorkspaceId) ?? workspaces[0]

  // When workspaces load, set initial activeChangeId only if it is already set in config 
  // but don't force select a change just because we load a workspace
  useEffect(() => {
    if (workspaces.length === 0) return
    setActiveChangeId((current) => current ?? null)
  }, [workspaces])

  // Load snapshot whenever selection changes — sidebar selection is source of truth
  useEffect(() => {
    if (!activeWorkspace || !activeChangeId) {
      setChangeSnapshot(null)
      return
    }

    setChangeSnapshot('loading')

    let cancelled = false
    void window.desktop
      .getChangeSnapshot(activeWorkspace.path, activeChangeId)
      .then((snapshot) => {
        if (!cancelled) setChangeSnapshot(snapshot)
      })
      .catch(() => {
        if (!cancelled) setChangeSnapshot(null)
      })

    return () => {
      cancelled = true
    }
  }, [activeWorkspace?.path, activeChangeId, workspaceFeedVersion])

  useEffect(() => {
    const sidebarPanel = sidebarPanelRef.current
    if (!sidebarPanel) return

    if (navigationCollapsed) {
      if (!sidebarPanel.isCollapsed()) {
        sidebarPanel.collapse()
      }
      return
    }

    if (sidebarPanel.isCollapsed()) {
      sidebarPanel.expand()
    }
  }, [navigationCollapsed])

  // Handle navigate-to-change events emitted by the overlay
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'navigate-to-change') return
    const { workspacePath, changeId } = lastEvent
    const workspace = workspaces.find((w) => w.path === workspacePath)
    if (!workspace) return
    handleChangeSelected(workspace.id, changeId)
  // handleChangeSelected is stable (defined inline without deps); workspaces is the real dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent, workspaces])

  function persistLayoutState(nextPanelLayout: number[], nextNavigationCollapsed: boolean): void {
    void window.desktop.saveLayoutState({
      ...layoutState,
      shell: {
        ...layoutState.shell,
        navigationCollapsed: nextNavigationCollapsed,
        panelLayout: nextPanelLayout
      }
    })
  }

  function handleLayoutChanged(nextLayout: Record<string, number>): void {
    const orderedLayout = [nextLayout.sidebar ?? panelLayout[0], nextLayout.main ?? panelLayout[1]]
    const sidebarCollapsed = sidebarPanelRef.current?.isCollapsed() ?? false

    if (sidebarCollapsed) {
      startTransition(() => {
        setNavigationCollapsed(true)
      })

      persistLayoutState(panelLayout, true)
      return
    }

    if (navigationCollapsed) {
      startTransition(() => {
        setNavigationCollapsed(false)
      })
    }

    if (navigationCollapsed && !sidebarCollapsed) {
      return
    }

    startTransition(() => {
      setPanelLayout(orderedLayout)
    })

    persistLayoutState(orderedLayout, false)
  }

  function handleSidebarToggle(): void {
    const sidebarPanel = sidebarPanelRef.current
    const nextCollapsed = !navigationCollapsed

    if (sidebarPanel) {
      if (sidebarPanel.isCollapsed()) {
        sidebarPanel.expand()
      } else {
        sidebarPanel.collapse()
      }
    }

    startTransition(() => {
      setNavigationCollapsed(nextCollapsed)
    })

    persistLayoutState(panelLayout, nextCollapsed)
  }

  function renderSidebarToggleButton({
    collapsed,
    className,
    style,
    iconClassName
  }: {
    collapsed: boolean
    className: string
    style?: React.CSSProperties
    iconClassName?: string
  }): React.JSX.Element {
    return (
      <button
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={className}
        onClick={handleSidebarToggle}
        style={style}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        type="button"
      >
        {collapsed ? (
          <IconLayoutSidebarLeftExpand
            className={iconClassName}
            style={style ? windowedSidebarIconStyle : undefined}
          />
        ) : (
          <IconLayoutSidebarLeftCollapse
            className={iconClassName}
            style={style ? windowedSidebarIconStyle : undefined}
          />
        )}
      </button>
    )
  }

  function handleWorkspaceSelected(_workspaceId: string): void {
    // Deliberately empty: expanding/collapsing a workspace should not change the active workspace or auto-select a change.
    // The active workspace is instead inferred from the active change.
  }

  function handleChangeSelected(workspaceId: string, changeId: string): void {
    if (workspaceId !== config.activeWorkspaceId) {
      mergeConfig({ activeWorkspaceId: workspaceId })
      void window.desktop.updateConfig({ activeWorkspaceId: workspaceId })
    }

    setActiveChangeId(changeId)
  }

  function handleOpenBoardAtChange(workspaceId: string, changeId: string): void {
    if (workspaceId !== config.activeWorkspaceId) {
      mergeConfig({ activeWorkspaceId: workspaceId })
      void window.desktop.updateConfig({ activeWorkspaceId: workspaceId })
    }

    setActiveChangeId(changeId)
    void window.desktop.openBoardAtChange(workspaceId, changeId)
  }

  function handleArchiveChange(workspaceId: string, changeId: string): void {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return

    void window.desktop.archiveChange(workspace.path, changeId).then(async (archived) => {
      if (!archived) return

      const nextWorkspaces = await refreshWorkspaces()
      const nextWorkspace = nextWorkspaces.find((item) => item.id === workspaceId)

      if (!nextWorkspace) {
        const fallbackWorkspace = nextWorkspaces[0] ?? null
        const fallbackWorkspaceId = fallbackWorkspace?.id ?? null
        mergeConfig({ activeWorkspaceId: fallbackWorkspaceId })
        void window.desktop.updateConfig({ activeWorkspaceId: fallbackWorkspaceId })
        setActiveChangeId(fallbackWorkspace?.changes[0]?.id ?? null)
        return
      }

      if (activeWorkspace?.id === workspaceId && activeChangeId === changeId) {
        setActiveChangeId(nextWorkspace.changes[0]?.id ?? null)
      }
    })
  }

  return (
    <main className="app-shell h-screen w-screen overflow-hidden text-foreground">
      <div className="app-frame relative flex h-full w-full flex-col overflow-hidden">
        <section className="no-drag flex min-h-0 flex-1">
          <Group
            className="h-full w-full overflow-hidden"
            defaultLayout={{
              main: panelLayout[1],
              sidebar: panelLayout[0]
            }}
            onLayoutChanged={handleLayoutChanged}
            orientation="horizontal"
            resizeTargetMinimumSize={{ coarse: 28, fine: 8 }}
          >
            <Panel
              className="min-w-0"
              collapsedSize={SIDEBAR_COLLAPSED_WIDTH}
              collapsible
              defaultSize={panelLayout[0]}
              id="sidebar"
              minSize={SIDEBAR_MIN_WIDTH}
              panelRef={sidebarPanelRef}
            >
              <aside className="panel-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                {windowFullscreen ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-2 pt-3">
                    {navigationCollapsed ? null : (
                      <WorkspaceSidebar
                        activeChangeId={activeChangeId}
                        activeWorkspaceId={activeWorkspace?.id ?? null}
                        layout="fullscreen"
                        onArchiveChange={handleArchiveChange}
                        onChangeSelected={handleChangeSelected}
                        onOpenBoardAtChange={handleOpenBoardAtChange}
                        onWorkspaceSelected={handleWorkspaceSelected}
                        topControl={
                          renderSidebarToggleButton({
                            collapsed: false,
                            className:
                              'sidebar-toggle no-drag inline-flex h-5 w-5 items-center justify-start border-0 bg-transparent p-0 transition-colors',
                            iconClassName: '-ml-px size-[18px]'
                          })
                        }
                        workspaces={workspaces}
                      />
                    )}
                  </div>
                ) : (
                  <>
                    {navigationCollapsed ? null : (
                      <div className="panel-topbar drag-region macos-window-controls-gap flex h-14 items-center px-3">
                        {renderSidebarToggleButton({
                          collapsed: false,
                          className:
                            'sidebar-toggle no-drag macos-traffic-inline-button inline-flex items-center justify-center rounded-full transition-colors',
                          style: windowedSidebarButtonStyle
                        })}
                      </div>
                    )}
                    {navigationCollapsed ? null : (
                      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-2 pt-3">
                        <WorkspaceSidebar
                          activeChangeId={activeChangeId}
                          activeWorkspaceId={activeWorkspace?.id ?? null}
                          onArchiveChange={handleArchiveChange}
                          onChangeSelected={handleChangeSelected}
                          onOpenBoardAtChange={handleOpenBoardAtChange}
                          onWorkspaceSelected={handleWorkspaceSelected}
                          workspaces={workspaces}
                        />
                      </div>
                    )}
                  </>
                )}
              </aside>
            </Panel>

            {navigationCollapsed ? null : <Separator className="panel-resize-handle" />}

            <Panel
              className="min-w-0"
              defaultSize={panelLayout[1]}
              id="main"
              minSize={MAIN_PANEL_MIN_WIDTH}
            >
              <section className="panel-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
                <div className="panel-topbar drag-region relative h-14 shrink-0">
                  {navigationCollapsed
                    ? windowFullscreen
                      ? renderSidebarToggleButton({
                          collapsed: true,
                          className:
                            'sidebar-toggle no-drag absolute inline-flex items-center justify-start border-0 bg-transparent p-0 transition-colors',
                          style: fullscreenSidebarButtonStyle,
                          iconClassName: '-ml-px size-[18px]'
                        })
                      : renderSidebarToggleButton({
                          collapsed: true,
                          className:
                            'sidebar-toggle no-drag macos-traffic-inline-button absolute inline-flex items-center justify-center rounded-full transition-colors',
                          style: windowedSidebarButtonStyle
                        })
                    : null}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ChangeRightPanel snapshot={changeSnapshot} />
                </div>
              </section>
            </Panel>
          </Group>
        </section>
      </div>
    </main>
  )
}

export default App

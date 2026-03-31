import { z } from 'zod'

export const DESKTOP_CHROME_METRICS = {
  macos: {
    titleBarHeight: 52,
    trafficLights: {
      x: 14,
      y: 14,
      diameter: 14,
      gap: 8
    },
    sidebarControl: {
      x: 78,
      size: 16,
      iconSize: 16,
      gapFromTrafficLights: 10,
      centerYOffset: -2
    }
  }
} as const

export const DESKTOP_IPC_CHANNELS = {
  getConfig: 'desktop:get-config',
  updateConfig: 'desktop:update-config',
  getLayoutState: 'desktop:get-layout-state',
  saveLayoutState: 'desktop:save-layout-state',
  getOverlayState: 'desktop:get-overlay-state',
  saveOverlayState: 'desktop:save-overlay-state',
  resizeOverlay: 'desktop:resize-overlay',
  setOverlayMode: 'desktop:set-overlay-mode',
  getOverlaySummary: 'desktop:get-overlay-summary',
  overlaySummaryChanged: 'desktop:overlay-summary-changed',
  openOverlay: 'desktop:open-overlay',
  closeOverlay: 'desktop:close-overlay',
  openBoard: 'desktop:open-board',
  openBoardAtChange: 'desktop:open-board-at-change',
  getWindowState: 'desktop:get-window-state',
  taskStreamEvent: 'desktop:task-stream-event',
  getChangeSnapshot: 'desktop:get-change-snapshot',
  getWorkspaces: 'desktop:get-workspaces',
  workspacesChanged: 'desktop:workspaces-changed',
  archiveChange: 'desktop:archive-change'
} as const

export const DesktopWindowStateSchema = z.object({
  focused: z.boolean(),
  fullscreen: z.boolean()
})
export type DesktopWindowState = z.infer<typeof DesktopWindowStateSchema>

export const ThemeModeSchema = z.enum(['system', 'light', 'dark'])
export type ThemeMode = z.infer<typeof ThemeModeSchema>

export const DesktopConfigSchema = z.object({
  themeMode: ThemeModeSchema,
  activeWorkspaceId: z.string().min(1).nullable(),
  uiDensity: z.enum(['comfortable', 'compact']),
  overlayEnabled: z.boolean()
})
export type DesktopConfig = z.infer<typeof DesktopConfigSchema>

export const DesktopLayoutStateSchema = z.object({
  shell: z.object({
    navigationCollapsed: z.boolean(),
    panelLayout: z.array(z.number().min(0)).min(1)
  })
})
export type DesktopLayoutState = z.infer<typeof DesktopLayoutStateSchema>

export const DesktopOverlayModeSchema = z.enum(['card', 'chip'])
export type DesktopOverlayMode = z.infer<typeof DesktopOverlayModeSchema>

export const DesktopBoundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
})
export type DesktopBounds = z.infer<typeof DesktopBoundsSchema>

export const DesktopOverlayStateSchema = z.object({
  mode: DesktopOverlayModeSchema,
  cardBounds: DesktopBoundsSchema.nullable(),
  chipBounds: DesktopBoundsSchema.nullable()
})
export type DesktopOverlayState = z.infer<typeof DesktopOverlayStateSchema>

export const DesktopOverlayItemStatusSchema = z.enum([
  'needs_feedback',
  'blocked',
  'change_done',
  'running'
])
export type DesktopOverlayItemStatus = z.infer<typeof DesktopOverlayItemStatusSchema>

export const DesktopOverlayItemSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  workspacePath: z.string().min(1),
  changeId: z.string().min(1),
  changeTitle: z.string().min(1),
  status: DesktopOverlayItemStatusSchema,
  statusLabel: z.string().min(1),
  preview: z.string().min(1),
  taskDone: z.number().int().min(0),
  taskTotal: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
  /** Populated for needs_feedback items — identifies which agent requested feedback */
  agentId: z.string().nullable(),
  agentName: z.string().nullable()
})
export type DesktopOverlayItem = z.infer<typeof DesktopOverlayItemSchema>

export const DesktopOverlaySummarySchema = z.object({
  generatedAt: z.iso.datetime(),
  primary: DesktopOverlayItemSchema.nullable(),
  secondary: z.array(DesktopOverlayItemSchema).max(2),
  allItems: z.array(DesktopOverlayItemSchema),
  hiddenCount: z.number().int().min(0),
  activeWorkspaceCount: z.number().int().min(0),
  activeChangeCount: z.number().int().min(0),
  needsFeedbackCount: z.number().int().min(0),
  completedCount: z.number().int().min(0),
  runningCount: z.number().int().min(0),
  blockedCount: z.number().int().min(0)
})
export type DesktopOverlaySummary = z.infer<typeof DesktopOverlaySummarySchema>

export const DesktopConfigPatchSchema = DesktopConfigSchema.partial()
export type DesktopConfigPatch = z.infer<typeof DesktopConfigPatchSchema>

export const DesktopTaskStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('desktop-ready'),
    emittedAt: z.iso.datetime()
  }),
  z.object({
    type: z.literal('window-focus-changed'),
    emittedAt: z.iso.datetime(),
    focused: z.boolean()
  }),
  z.object({
    type: z.literal('window-fullscreen-changed'),
    emittedAt: z.iso.datetime(),
    fullscreen: z.boolean()
  }),
  z.object({
    type: z.literal('navigate-to-change'),
    emittedAt: z.iso.datetime(),
    workspacePath: z.string().min(1),
    changeId: z.string().min(1)
  })
])
export type DesktopTaskStreamEvent = z.infer<typeof DesktopTaskStreamEventSchema>

export const DesktopWorkspaceTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done'])
})
export type DesktopWorkspaceTask = z.infer<typeof DesktopWorkspaceTaskSchema>

export const DesktopWorkspaceSnapshotSchema = z.object({
  workspaceName: z.string().min(1),
  workspacePath: z.string().min(1),
  tasks: z.array(DesktopWorkspaceTaskSchema),
  updatedAt: z.iso.datetime()
})
export type DesktopWorkspaceSnapshot = z.infer<typeof DesktopWorkspaceSnapshotSchema>

// --- Workspace + change navigation types (sidebar) ---

export type DesktopChangeStatus = 'active' | 'idle' | 'done'

export interface DesktopChangeNavigationItem {
  id: string
  title: string
  stateScore: number
  lastActiveAt: string
  inProgress: boolean
  unread: boolean
  taskCount: number
  completedTaskCount: number
  status: DesktopChangeStatus
}

export interface DesktopWorkspaceNavigationItem {
  id: string
  name: string
  rootLabel: string
  path: string
  lastActiveAt: string
  changes: DesktopChangeNavigationItem[]
}

export const DesktopChangeNavigationItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  stateScore: z.number().int().min(0),
  lastActiveAt: z.iso.datetime(),
  inProgress: z.boolean(),
  unread: z.boolean(),
  taskCount: z.number().int().min(0),
  completedTaskCount: z.number().int().min(0),
  status: z.enum(['active', 'idle', 'done'])
})

export const DesktopWorkspaceNavigationItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rootLabel: z.string().min(1),
  path: z.string().min(1),
  lastActiveAt: z.iso.datetime(),
  changes: z.array(DesktopChangeNavigationItemSchema)
})

export const DesktopWorkspaceNavigationListSchema = z.array(DesktopWorkspaceNavigationItemSchema)

// --- Selected change panel types ---

export type DesktopChangeViewStatus =
  | 'backlog'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'needs_feedback'
  | 'done'

export interface DesktopChangeTask {
  ref: string
  title: string
  descriptionExcerpt: string
  status: DesktopChangeViewStatus
  /** Whether the task has all deps satisfied */
  ready: boolean
  priority: 'high' | 'medium' | 'low' | null
  acceptanceTotal: number
  acceptanceCompleted: number
  /**
   * Ordered list of acceptance criteria items.
   * Convention: incomplete items first (indices 0..acceptanceTotal-acceptanceCompleted-1),
   * then completed items (indices acceptanceTotal-acceptanceCompleted..end).
   */
  acceptanceCriteria: string[]
  progressPct: number
  dependencies: string[]
  workstream: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Populated for blocked tasks */
  reason: string | null
  /** Populated for needs_feedback tasks */
  message: string | null
  filePath: string | null
  fullDescription: string
}

export interface DesktopChangeBoardColumn {
  id: DesktopChangeViewStatus
  label: string
  tasks: DesktopChangeTask[]
}

export interface DesktopChangeSnapshot {
  changeId: string
  changeTitle: string
  status: 'active' | 'idle' | 'done'
  progressPct: number
  completedCount: number
  totalCount: number
  updatedAt: string
  activeTaskRef: string | null
  workstreams: string[]
  tasks: DesktopChangeTask[]
}

export interface DesktopApi {
  getConfig: () => Promise<DesktopConfig>
  updateConfig: (patch: DesktopConfigPatch) => Promise<DesktopConfig>
  getLayoutState: () => Promise<DesktopLayoutState>
  saveLayoutState: (state: DesktopLayoutState) => Promise<DesktopLayoutState>
  getOverlayState: () => Promise<DesktopOverlayState>
  saveOverlayState: (state: DesktopOverlayState) => Promise<DesktopOverlayState>
  resizeOverlay: (height: number) => Promise<DesktopOverlayState>
  setOverlayMode: (mode: DesktopOverlayMode) => Promise<DesktopOverlayState>
  getOverlaySummary: () => Promise<DesktopOverlaySummary>
  onOverlaySummaryChanged: (listener: (summary: DesktopOverlaySummary) => void) => () => void
  openOverlay: (mode?: DesktopOverlayMode) => Promise<DesktopOverlayState>
  closeOverlay: () => Promise<void>
  openBoard: () => Promise<void>
  openBoardAtChange: (workspacePath: string, changeId: string) => Promise<void>
  getWindowState: () => Promise<DesktopWindowState>
  onTaskStreamEvent: (listener: (event: DesktopTaskStreamEvent) => void) => () => void
  getChangeSnapshot: (
    workspacePath: string,
    changeId: string
  ) => Promise<DesktopChangeSnapshot | null>
  getWorkspaces: () => Promise<DesktopWorkspaceNavigationItem[]>
  onWorkspacesChanged: (listener: (workspaces: DesktopWorkspaceNavigationItem[]) => void) => () => void
  archiveChange: (workspacePath: string, changeId: string) => Promise<boolean>
}

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  themeMode: 'system',
  activeWorkspaceId: null,
  uiDensity: 'comfortable',
  overlayEnabled: true
}

export const DEFAULT_DESKTOP_LAYOUT_STATE: DesktopLayoutState = {
  shell: {
    navigationCollapsed: false,
    panelLayout: [24, 76]
  }
}

export const DEFAULT_DESKTOP_OVERLAY_STATE: DesktopOverlayState = {
  mode: 'card',
  cardBounds: null,
  chipBounds: null
}

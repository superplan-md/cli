import { app, shell, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  DESKTOP_CHROME_METRICS,
  DESKTOP_IPC_CHANNELS,
  DesktopOverlayModeSchema,
  DesktopOverlaySummarySchema,
  DesktopTaskStreamEventSchema,
  DesktopWorkspaceNavigationListSchema,
  type DesktopBounds,
  type DesktopConfigPatch,
  type DesktopOverlayMode,
  type DesktopOverlaySummary,
  type DesktopOverlayState,
  type DesktopTaskStreamEvent,
  type DesktopWorkspaceNavigationItem,
  type DesktopWindowState
} from '../shared/desktop-contract'
import {
  getDesktopConfig,
  getDesktopLayoutState,
  getDesktopOverlayState,
  saveDesktopLayoutState,
  saveDesktopOverlayState,
  updateDesktopConfig,
  updateDesktopOverlayMode
} from './desktop-store'
import {
  readGlobalOverlayPreference,
  writeGlobalOverlayPreference
} from './overlay-preferences'
import { archiveChange } from './archive-change'
import { getChangeSnapshot } from './change-snapshot'
import { buildOverlaySummary } from './overlay-summary'
import {
  getLatestVisibleOverlayControl,
  type RuntimeOverlayControlState,
  scanRuntimeOverlayControls
} from './runtime-overlay-controls'
import { scanRuntimeOverlaySnapshots } from './runtime-overlay-snapshots'
import { buildWorkspaceNavigation } from './workspace-scanner'

let currentBoardWindow: BrowserWindow | null = null
let currentOverlayWindow: BrowserWindow | null = null
let currentOverlaySummary: DesktopOverlaySummary = DesktopOverlaySummarySchema.parse({
  generatedAt: new Date().toISOString(),
  primary: null,
  secondary: [],
  allItems: [],
  hiddenCount: 0,
  activeWorkspaceCount: 0,
  activeChangeCount: 0,
  needsFeedbackCount: 0,
  completedCount: 0,
  runningCount: 0,
  blockedCount: 0
})
let currentWorkspaces: DesktopWorkspaceNavigationItem[] = DesktopWorkspaceNavigationListSchema.parse([])
let lastOverlaySummarySerialized = ''
let lastWorkspacesSerialized = JSON.stringify(currentWorkspaces)
let runtimeRefreshTimer: NodeJS.Timeout | null = null
let runtimeRefreshInFlight = false
let queuedRuntimeRefreshMode: RuntimeRefreshMode | null = null
let overlayWindowVisibilitySource: 'manual' | 'runtime' | null = null
let latestVisibleRuntimeOverlayControlKey: string | null = null
let suppressedRuntimeOverlayControlKey: string | null = null
let lastOverlayWorkspaceVisibilityKey: string | null = null
let keepDesktopShellResident = false
let isQuitting = false
let currentActivationPolicy: 'regular' | 'accessory' | null = null

const VISIBLE_RUNTIME_REFRESH_MS = 1000
const IDLE_RUNTIME_CONTROL_REFRESH_MS = 3000

type DesktopLaunchSurface = 'board' | 'overlay'
type RuntimeRefreshMode = 'full' | 'controls-only'

interface DesktopLaunchIntent {
  surface: DesktopLaunchSurface
  workspacePath: string | null
}

interface RuntimeRefreshPlan {
  delayMs: number
  mode: RuntimeRefreshMode
}

function readCliFlagValue(argv: string[], flag: string): string | null {
  const directIndex = argv.indexOf(flag)
  if (directIndex >= 0) {
    return argv[directIndex + 1] ?? null
  }

  const inlineFlag = `${flag}=`
  const inlineArg = argv.find((arg) => arg.startsWith(inlineFlag))
  return inlineArg ? inlineArg.slice(inlineFlag.length) : null
}

function parseDesktopLaunchIntent(argv: string[]): DesktopLaunchIntent {
  const workspacePath = readCliFlagValue(argv, '--workspace')
  let surface: DesktopLaunchSurface = workspacePath ? 'overlay' : 'board'

  if (argv.includes('--board')) {
    surface = 'board'
  } else if (argv.includes('--overlay')) {
    surface = 'overlay'
  }

  return {
    surface,
    workspacePath
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
const initialLaunchIntent = parseDesktopLaunchIntent(process.argv)
let pendingLaunchIntent: DesktopLaunchIntent | null = initialLaunchIntent
keepDesktopShellResident = initialLaunchIntent.surface === 'overlay'

function serializeOverlaySummaryForChangeDetection(summary: DesktopOverlaySummary): string {
  return JSON.stringify({
    ...summary,
    generatedAt: ''
  })
}

function getOpenDesktopWindows(): BrowserWindow[] {
  return [currentBoardWindow, currentOverlayWindow].filter(
    (window): window is BrowserWindow => Boolean(window && !window.isDestroyed())
  )
}

function isWindowActivelyVisible(window: BrowserWindow): boolean {
  return window.isVisible() && !window.isMinimized()
}

function getRuntimeRefreshPlan(): RuntimeRefreshPlan | null {
  const openWindows = getOpenDesktopWindows()

  if (openWindows.some(isWindowActivelyVisible)) {
    return {
      delayMs: VISIBLE_RUNTIME_REFRESH_MS,
      mode: 'full'
    }
  }

  if (keepDesktopShellResident || openWindows.length > 0) {
    return {
      delayMs: IDLE_RUNTIME_CONTROL_REFRESH_MS,
      mode: 'controls-only'
    }
  }

  return null
}

function combineRuntimeRefreshModes(
  current: RuntimeRefreshMode | null,
  next: RuntimeRefreshMode
): RuntimeRefreshMode {
  return current === 'full' || next === 'full' ? 'full' : 'controls-only'
}

function clearRuntimeRefreshTimer(): void {
  if (runtimeRefreshTimer) {
    clearTimeout(runtimeRefreshTimer)
    runtimeRefreshTimer = null
  }
}

function scheduleRuntimeRefresh(): void {
  clearRuntimeRefreshTimer()
  if (isQuitting || runtimeRefreshInFlight) {
    return
  }

  const plan = getRuntimeRefreshPlan()
  if (!plan) {
    return
  }

  runtimeRefreshTimer = setTimeout(() => {
    runtimeRefreshTimer = null
    void refreshDesktopRuntimeData(plan.mode)
  }, plan.delayMs)
  runtimeRefreshTimer.unref?.()
}

function requestRuntimeRefresh(mode: RuntimeRefreshMode = 'full'): void {
  clearRuntimeRefreshTimer()

  if (runtimeRefreshInFlight) {
    queuedRuntimeRefreshMode = combineRuntimeRefreshModes(queuedRuntimeRefreshMode, mode)
    return
  }

  void refreshDesktopRuntimeData(mode)
}

function getRendererUrl(hash: string): string {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}#${hash}`
  }

  return `file://${join(__dirname, '../renderer/index.html')}#${hash}`
}

function applyRendererUrl(window: BrowserWindow, hash: string): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(getRendererUrl(hash))
    return
  }

  void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

function clampBounds(bounds: DesktopBounds): DesktopBounds {
  const area = screen.getDisplayMatching(bounds).workArea

  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height),
    width: Math.min(bounds.width, area.width),
    height: Math.min(bounds.height, area.height)
  }
}

function getCurrentWindowState(): DesktopWindowState {
  const fullscreen = currentBoardWindow
    ? currentBoardWindow.isFullScreen() ||
      (process.platform === 'darwin' && currentBoardWindow.isSimpleFullScreen())
    : false

  return {
    focused: currentBoardWindow?.isFocused() ?? false,
    fullscreen
  }
}

function emitTaskStreamEvent(mainWindow: BrowserWindow, event: DesktopTaskStreamEvent): void {
  const validatedEvent = DesktopTaskStreamEventSchema.parse(event)
  mainWindow.webContents.send(DESKTOP_IPC_CHANNELS.taskStreamEvent, validatedEvent)
}

function emitOverlaySummaryChanged(summary: DesktopOverlaySummary): void {
  const validatedSummary = DesktopOverlaySummarySchema.parse(summary)
  for (const window of getOpenDesktopWindows()) {
    window.webContents.send(DESKTOP_IPC_CHANNELS.overlaySummaryChanged, validatedSummary)
  }
}

function emitWorkspacesChanged(workspaces: DesktopWorkspaceNavigationItem[]): void {
  const validatedWorkspaces = DesktopWorkspaceNavigationListSchema.parse(workspaces)
  for (const window of getOpenDesktopWindows()) {
    window.webContents.send(DESKTOP_IPC_CHANNELS.workspacesChanged, validatedWorkspaces)
  }
}

function emitCurrentDesktopData(targetWindow: BrowserWindow): void {
  targetWindow.webContents.send(
    DESKTOP_IPC_CHANNELS.overlaySummaryChanged,
    DesktopOverlaySummarySchema.parse(currentOverlaySummary)
  )
  targetWindow.webContents.send(
    DESKTOP_IPC_CHANNELS.workspacesChanged,
    DesktopWorkspaceNavigationListSchema.parse(currentWorkspaces)
  )
}

function getRuntimeOverlayControlKey(control: RuntimeOverlayControlState | null): string | null {
  if (!control) {
    return null
  }

  return `${control.workspace_path}:${control.updated_at}:${control.requested_action}:${control.visible ? '1' : '0'}`
}

async function refreshDesktopRuntimeData(mode: RuntimeRefreshMode = 'full'): Promise<void> {
  if (runtimeRefreshInFlight) {
    queuedRuntimeRefreshMode = combineRuntimeRefreshModes(queuedRuntimeRefreshMode, mode)
    return
  }

  runtimeRefreshInFlight = true
  try {
    const controls = await scanRuntimeOverlayControls()
    const latestVisibleControl = getLatestVisibleOverlayControl(controls)
    const shouldRefreshVisibleData =
      mode === 'full' ||
      Boolean(latestVisibleControl) ||
      getOpenDesktopWindows().some(isWindowActivelyVisible)

    if (shouldRefreshVisibleData) {
      const snapshots = await scanRuntimeOverlaySnapshots()
      const [nextOverlaySummary, nextWorkspaces] = await Promise.all([
        buildOverlaySummary(snapshots),
        Promise.resolve(buildWorkspaceNavigation(snapshots))
      ])

      const nextOverlaySummarySerialized = serializeOverlaySummaryForChangeDetection(nextOverlaySummary)
      if (nextOverlaySummarySerialized !== lastOverlaySummarySerialized) {
        currentOverlaySummary = nextOverlaySummary
        lastOverlaySummarySerialized = nextOverlaySummarySerialized
        emitOverlaySummaryChanged(nextOverlaySummary)
      }

      const nextWorkspacesSerialized = JSON.stringify(nextWorkspaces)
      if (nextWorkspacesSerialized !== lastWorkspacesSerialized) {
        currentWorkspaces = nextWorkspaces
        lastWorkspacesSerialized = nextWorkspacesSerialized
        emitWorkspacesChanged(nextWorkspaces)
      } else {
        currentWorkspaces = nextWorkspaces
      }
    }

    const latestVisibleControlKey = getRuntimeOverlayControlKey(latestVisibleControl)
    latestVisibleRuntimeOverlayControlKey = latestVisibleControlKey
    if (latestVisibleControl) {
      if (suppressedRuntimeOverlayControlKey === latestVisibleControlKey) {
        return
      }
      const overlayWindow = currentOverlayWindow
      const overlayWindowVisible =
        overlayWindow !== null &&
        !overlayWindow.isDestroyed() &&
        overlayWindow.isVisible()

      if (!overlayWindowVisible || overlayWindowVisibilitySource !== 'runtime') {
        showOverlayWindow(getDesktopOverlayState().mode, 'runtime')
      }
    } else if (overlayWindowVisibilitySource === 'runtime') {
      closeOverlayWindow()
    }

    if (!latestVisibleControl || latestVisibleControlKey !== suppressedRuntimeOverlayControlKey) {
      suppressedRuntimeOverlayControlKey = null
    }
  } finally {
    runtimeRefreshInFlight = false
    const queuedMode = queuedRuntimeRefreshMode
    queuedRuntimeRefreshMode = null

    if (queuedMode) {
      requestRuntimeRefresh(queuedMode)
      return
    }

    scheduleRuntimeRefresh()
  }
}

function emitFullscreenState(mainWindow: BrowserWindow): void {
  emitTaskStreamEvent(mainWindow, {
    type: 'window-fullscreen-changed',
    emittedAt: new Date().toISOString(),
    fullscreen:
      mainWindow.isFullScreen() ||
      (process.platform === 'darwin' && mainWindow.isSimpleFullScreen())
  })
}

function createCommonWebPreferences() {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false
  }
}

function syncMacosActivationPolicy(policy: 'regular' | 'accessory'): void {
  if (process.platform !== 'darwin' || currentActivationPolicy === policy) {
    return
  }

  app.setActivationPolicy(policy)
  currentActivationPolicy = policy
}

function getDesiredMacosActivationPolicy(): 'regular' | 'accessory' {
  const boardWindowOpen = Boolean(currentBoardWindow && !currentBoardWindow.isDestroyed())
  if (boardWindowOpen) {
    return 'regular'
  }

  const overlayWindowOpen = Boolean(currentOverlayWindow && !currentOverlayWindow.isDestroyed())
  if (overlayWindowOpen) {
    return 'accessory'
  }

  // Never leave the app stranded as a hidden accessory process when all
  // windows are closed. Keeping the process resident is fine, but it must
  // remain recoverable from the Dock/app switcher.
  return 'regular'
}

function syncMacosActivationPolicyForCurrentWindows(): void {
  syncMacosActivationPolicy(getDesiredMacosActivationPolicy())
}

function getOverlayWorkspaceVisibilityOptions() {
  if (process.platform !== 'darwin') {
    return undefined
  }

  const boardWindowOpen = Boolean(currentBoardWindow && !currentBoardWindow.isDestroyed())
  const skipTransformProcessType = !boardWindowOpen && currentActivationPolicy === 'accessory'

  return {
    visibleOnFullScreen: true,
    // Electron only allows skipping the process-type transform when the app is
    // already operating as an accessory/UIElement app. When the board keeps the
    // app in regular mode, the transform is required for fullscreen visibility.
    skipTransformProcessType
  }
}

function applyOverlayWorkspaceVisibility(overlayWindow: BrowserWindow): void {
  if (process.platform !== 'darwin') {
    return
  }

  const options = getOverlayWorkspaceVisibilityOptions()
  if (!options) {
    return
  }

  const visibilityKey = `${overlayWindow.id}:${options.skipTransformProcessType ? 'skip' : 'transform'}`
  if (
    lastOverlayWorkspaceVisibilityKey === visibilityKey &&
    overlayWindow.isVisibleOnAllWorkspaces()
  ) {
    return
  }

  overlayWindow.setVisibleOnAllWorkspaces(true, options)
  lastOverlayWorkspaceVisibilityKey = visibilityKey
}

function applyOverlayWindowLevel(overlayWindow: BrowserWindow): void {
  // macOS: window level and workspace visibility are applied after show() in ready-to-show
  // This is required for visibleOnFullScreen to work correctly
  if (process.platform !== 'darwin') {
    overlayWindow.setAlwaysOnTop(true)
  }
}

function applyNativeThemeSource(): void {
  const themeMode = getDesktopConfig().themeMode
  nativeTheme.themeSource = themeMode
}

function createBoardWindow(): BrowserWindow {
  const boardWindow = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: {
            x: DESKTOP_CHROME_METRICS.macos.trafficLights.x,
            y: DESKTOP_CHROME_METRICS.macos.trafficLights.y
          },
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const,
          backgroundColor: '#00000000'
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: createCommonWebPreferences()
  })

  currentBoardWindow = boardWindow

  boardWindow.on('ready-to-show', () => {
    if (process.platform === 'darwin') {
      boardWindow.setAlwaysOnTop(false)
      boardWindow.setVisibleOnAllWorkspaces(false)
    }
    boardWindow.show()
  })

  boardWindow.on('closed', () => {
    if (currentBoardWindow === boardWindow) currentBoardWindow = null
    syncMacosActivationPolicyForCurrentWindows()
    scheduleRuntimeRefresh()
  })

  boardWindow.on('minimize', () => {
    scheduleRuntimeRefresh()
  })

  boardWindow.on('hide', () => {
    scheduleRuntimeRefresh()
  })

  boardWindow.on('restore', () => {
    requestRuntimeRefresh('full')
  })

  boardWindow.on('focus', () => {
    emitTaskStreamEvent(boardWindow, {
      type: 'window-focus-changed',
      emittedAt: new Date().toISOString(),
      focused: true
    })
  })

  boardWindow.on('blur', () => {
    emitTaskStreamEvent(boardWindow, {
      type: 'window-focus-changed',
      emittedAt: new Date().toISOString(),
      focused: false
    })
  })

  boardWindow.on('enter-full-screen', () => {
    emitFullscreenState(boardWindow)
  })

  boardWindow.on('leave-full-screen', () => {
    emitFullscreenState(boardWindow)
  })

  boardWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  boardWindow.webContents.once('did-finish-load', () => {
    emitCurrentDesktopData(boardWindow)
    emitTaskStreamEvent(boardWindow, {
      type: 'desktop-ready',
      emittedAt: new Date().toISOString()
    })
    emitFullscreenState(boardWindow)
  })

  applyRendererUrl(boardWindow, 'board')
  return boardWindow
}

function cardSizeBounds(): DesktopBounds {
  const area = screen.getPrimaryDisplay().workArea
  return {
    width: 336,
    height: 150,
    x: area.x + 20,
    y: area.y + 20
  }
}

function chipSizeBounds(): DesktopBounds {
  const area = screen.getPrimaryDisplay().workArea
  return {
    width: 130,
    height: 32,
    x: area.x + 20,
    y: area.y + 20
  }
}

function overlayBoundsForMode(
  state: DesktopOverlayState,
  mode: DesktopOverlayMode,
  anchor?: Pick<DesktopBounds, 'x' | 'y'>
): DesktopBounds {
  const persisted = mode === 'card' ? state.cardBounds : state.chipBounds
  const fallback = mode === 'card' ? cardSizeBounds() : chipSizeBounds()
  const sizedPersisted = persisted
    ? {
        ...persisted,
        width: fallback.width,
        height: mode === 'card' ? persisted.height : fallback.height
      }
    : null

  if (anchor) {
    return clampBounds({
      ...fallback,
      x: anchor.x,
      y: anchor.y
    })
  }

  return clampBounds(sizedPersisted ?? fallback)
}

function persistOverlayBounds(window: BrowserWindow, mode: DesktopOverlayMode): DesktopOverlayState {
  const overlayState = getDesktopOverlayState()
  const bounds = window.getBounds()

  return saveDesktopOverlayState({
    ...overlayState,
    mode,
    cardBounds: mode === 'card' ? bounds : overlayState.cardBounds,
    chipBounds: mode === 'chip' ? bounds : overlayState.chipBounds
  })
}

function createOverlayWindow(_mode: DesktopOverlayMode, bounds: DesktopBounds): BrowserWindow {
  const overlayWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    ...(process.platform === 'darwin'
      ? {
          type: 'floating' as const,
          vibrancy: 'sidebar' as const,
          visualEffectState: 'active' as const
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: createCommonWebPreferences()
  })

  currentOverlayWindow = overlayWindow
  applyOverlayWindowLevel(overlayWindow)

  overlayWindow.on('ready-to-show', () => {
    if (process.platform === 'darwin') {
      syncMacosActivationPolicyForCurrentWindows()
      applyOverlayWorkspaceVisibility(overlayWindow)
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    }
    overlayWindow.showInactive()
  })

  overlayWindow.on('closed', () => {
    if (currentOverlayWindow === overlayWindow) currentOverlayWindow = null
    lastOverlayWorkspaceVisibilityKey = null
    overlayWindowVisibilitySource = null
    syncMacosActivationPolicyForCurrentWindows()
    scheduleRuntimeRefresh()
  })

  overlayWindow.on('hide', () => {
    scheduleRuntimeRefresh()
  })

  overlayWindow.on('moved', () => {
    if (currentOverlayWindow === overlayWindow) {
      persistOverlayBounds(overlayWindow, getDesktopOverlayState().mode)
    }
  })

  overlayWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  applyRendererUrl(overlayWindow, 'overlay')
  overlayWindow.webContents.once('did-finish-load', () => {
    emitCurrentDesktopData(overlayWindow)
  })
  return overlayWindow
}

function ensureBoardWindow(): BrowserWindow {
  if (currentBoardWindow && !currentBoardWindow.isDestroyed()) {
    return currentBoardWindow
  }

  return createBoardWindow()
}

function ensureOverlayWindow(mode: DesktopOverlayMode): BrowserWindow {
  if (currentOverlayWindow && !currentOverlayWindow.isDestroyed()) {
    return currentOverlayWindow
  }

  return createOverlayWindow(mode, overlayBoundsForMode(getDesktopOverlayState(), mode))
}

function showBoardWindow(): void {
  syncMacosActivationPolicy('regular')
  const boardWindow = ensureBoardWindow()
  if (boardWindow.isMinimized()) boardWindow.restore()
  boardWindow.show()
  boardWindow.focus()
  syncMacosActivationPolicyForCurrentWindows()
  requestRuntimeRefresh('full')
}

function handleDesktopLaunchIntent(intent: DesktopLaunchIntent): void {
  if (intent.surface === 'overlay') {
    showOverlayWindow(getDesktopOverlayState().mode, 'runtime')
    return
  }

  showBoardWindow()
}

function showOverlayWindow(
  mode: DesktopOverlayMode,
  source: 'manual' | 'runtime' = 'manual'
): DesktopOverlayState {
  if (source === 'manual') {
    suppressedRuntimeOverlayControlKey = null
  }

  const anchor = currentOverlayWindow && !currentOverlayWindow.isDestroyed()
    ? currentOverlayWindow.getBounds()
    : undefined
  let nextOverlayState = updateDesktopOverlayMode(mode)
  const overlayWindow = ensureOverlayWindow(mode)
  const bounds = overlayBoundsForMode(nextOverlayState, mode, anchor)
  overlayWindow.setBounds(bounds)

  if (process.platform === 'darwin') {
    applyOverlayWorkspaceVisibility(overlayWindow)
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  }
  overlayWindow.showInactive()
  overlayWindowVisibilitySource = source
  if (source === 'runtime') {
    keepDesktopShellResident = true
  }
  syncMacosActivationPolicyForCurrentWindows()
  if (source === 'manual') {
    requestRuntimeRefresh('full')
  } else {
    scheduleRuntimeRefresh()
  }

  nextOverlayState = saveDesktopOverlayState({
    ...nextOverlayState,
    mode,
    cardBounds: mode === 'card' ? bounds : nextOverlayState.cardBounds,
    chipBounds: mode === 'chip' ? bounds : nextOverlayState.chipBounds
  })
  return nextOverlayState
}

function closeOverlayWindow(): void {
  suppressedRuntimeOverlayControlKey = latestVisibleRuntimeOverlayControlKey

  if (currentOverlayWindow && !currentOverlayWindow.isDestroyed()) {
    currentOverlayWindow.close()
    return
  }

  overlayWindowVisibilitySource = null
  syncMacosActivationPolicyForCurrentWindows()
  scheduleRuntimeRefresh()
}

function resizeOverlayWindow(height: number): DesktopOverlayState {
  const overlayWindow = currentOverlayWindow
  const overlayState = getDesktopOverlayState()

  if (!overlayWindow || overlayWindow.isDestroyed() || overlayState.mode !== 'card') {
    return overlayState
  }

  const currentBounds = overlayWindow.getBounds()
  const nextBounds = clampBounds({
    ...currentBounds,
    height: Math.max(88, Math.round(height))
  })

  overlayWindow.setBounds(nextBounds)

  return saveDesktopOverlayState({
    ...overlayState,
    cardBounds: nextBounds
  })
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const intent = parseDesktopLaunchIntent(argv)
    pendingLaunchIntent = intent
    if (app.isReady()) {
      handleDesktopLaunchIntent(intent)
    }
  })
}

app.whenReady().then(async () => {
  applyNativeThemeSource()

  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getConfig, () => {
    return readGlobalOverlayPreference().then((overlayEnabled) => ({
      ...getDesktopConfig(),
      overlayEnabled
    }))
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.updateConfig, async (_, patch: DesktopConfigPatch) => {
    const { overlayEnabled, ...desktopConfigPatch } = patch
    if (typeof overlayEnabled === 'boolean') {
      await writeGlobalOverlayPreference(overlayEnabled)
    }

    const nextConfig = Object.keys(desktopConfigPatch).length > 0
      ? updateDesktopConfig(desktopConfigPatch)
      : getDesktopConfig()
    nativeTheme.themeSource = nextConfig.themeMode
    return {
      ...nextConfig,
      overlayEnabled: await readGlobalOverlayPreference()
    }
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getLayoutState, () => {
    return getDesktopLayoutState()
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.saveLayoutState, (_, state) => {
    return saveDesktopLayoutState(state)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getOverlayState, () => {
    return getDesktopOverlayState()
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.saveOverlayState, (_, state) => {
    return saveDesktopOverlayState(state)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.resizeOverlay, (_, height: number) => {
    return resizeOverlayWindow(height)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.setOverlayMode, (_, mode) => {
    const nextMode = DesktopOverlayModeSchema.parse(mode)
    return showOverlayWindow(nextMode, overlayWindowVisibilitySource ?? 'manual')
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getOverlaySummary, () => {
    return currentOverlaySummary
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.openOverlay, (_, mode?: DesktopOverlayMode) => {
    return showOverlayWindow(mode ?? getDesktopOverlayState().mode, 'manual')
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.closeOverlay, () => {
    closeOverlayWindow()
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.openBoard, () => {
    showBoardWindow()
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.openBoardAtChange, (_event, workspacePath: string, changeId: string) => {
    const wasOpen = currentBoardWindow !== null && !currentBoardWindow.isDestroyed()
    showBoardWindow()
    const boardWindow = currentBoardWindow
    if (!boardWindow || boardWindow.isDestroyed()) return

    const sendNav = (): void => {
      emitTaskStreamEvent(boardWindow, {
        type: 'navigate-to-change',
        emittedAt: new Date().toISOString(),
        workspacePath,
        changeId
      })
    }

    if (wasOpen) {
      sendNav()
    } else {
      boardWindow.webContents.once('did-finish-load', sendNav)
    }
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getWindowState, () => {
    return getCurrentWindowState()
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getChangeSnapshot, (_event, workspacePath: string, changeId: string) => {
    return getChangeSnapshot(workspacePath, changeId)
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.getWorkspaces, () => {
    return currentWorkspaces
  })

  ipcMain.handle(DESKTOP_IPC_CHANNELS.archiveChange, async (_event, workspacePath: string, changeId: string) => {
    const archived = await archiveChange(workspacePath, changeId)
    if (archived) {
      await refreshDesktopRuntimeData('full')
    }
    return archived
  })

  await refreshDesktopRuntimeData('full')

  handleDesktopLaunchIntent(pendingLaunchIntent ?? initialLaunchIntent)
  pendingLaunchIntent = null

  app.on('activate', function () {
    if (keepDesktopShellResident) {
      return
    }

    if (getOpenDesktopWindows().length === 0) {
      showBoardWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (keepDesktopShellResident && !isQuitting) {
    syncMacosActivationPolicy('regular')
    return
  }

  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  clearRuntimeRefreshTimer()
})

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  DESKTOP_IPC_CHANNELS,
  DesktopOverlayModeSchema,
  type DesktopApi,
  type DesktopChangeSnapshot,
  type DesktopWorkspaceNavigationItem,
  type DesktopConfigPatch,
  type DesktopLayoutState,
  type DesktopOverlayMode,
  type DesktopOverlayState,
  type DesktopTaskStreamEvent
} from '../shared/desktop-contract'

const desktopApi: DesktopApi = {
  getConfig: async () => ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getConfig),
  updateConfig: async (patch: DesktopConfigPatch) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.updateConfig, patch),
  getLayoutState: async () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getLayoutState),
  saveLayoutState: async (state: DesktopLayoutState) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.saveLayoutState, state),
  getOverlayState: async () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getOverlayState),
  saveOverlayState: async (state: DesktopOverlayState) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.saveOverlayState, state),
  resizeOverlay: async (height: number) =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.resizeOverlay, height),
  setOverlayMode: async (mode: DesktopOverlayMode) =>
    ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.setOverlayMode,
      DesktopOverlayModeSchema.parse(mode)
    ),
  getOverlaySummary: async () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getOverlaySummary),
  onOverlaySummaryChanged: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: Awaited<ReturnType<DesktopApi['getOverlaySummary']>>) => {
      listener(payload)
    }

    ipcRenderer.on(DESKTOP_IPC_CHANNELS.overlaySummaryChanged, wrappedListener)

    return () => {
      ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.overlaySummaryChanged, wrappedListener)
    }
  },
  openOverlay: async (mode?: DesktopOverlayMode) =>
    ipcRenderer.invoke(
      DESKTOP_IPC_CHANNELS.openOverlay,
      mode ? DesktopOverlayModeSchema.parse(mode) : undefined
    ),
  closeOverlay: async () => {
    await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.closeOverlay)
  },
  openBoard: async () => {
    await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openBoard)
  },
  openBoardAtChange: async (workspacePath: string, changeId: string) => {
    await ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.openBoardAtChange, workspacePath, changeId)
  },
  getWindowState: async () =>
    ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getWindowState),
  onTaskStreamEvent: (listener: (event: DesktopTaskStreamEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: DesktopTaskStreamEvent) => {
      listener(payload)
    }

    ipcRenderer.on(DESKTOP_IPC_CHANNELS.taskStreamEvent, wrappedListener)

    return () => {
      ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.taskStreamEvent, wrappedListener)
    }
  },
  getChangeSnapshot: async (workspacePath: string, changeId: string): Promise<DesktopChangeSnapshot | null> => {
    return ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getChangeSnapshot, workspacePath, changeId) as Promise<DesktopChangeSnapshot | null>
  },
  getWorkspaces: async (): Promise<DesktopWorkspaceNavigationItem[]> => {
    return ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.getWorkspaces) as Promise<DesktopWorkspaceNavigationItem[]>
  },
  onWorkspacesChanged: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: DesktopWorkspaceNavigationItem[]) => {
      listener(payload)
    }

    ipcRenderer.on(DESKTOP_IPC_CHANNELS.workspacesChanged, wrappedListener)

    return () => {
      ipcRenderer.removeListener(DESKTOP_IPC_CHANNELS.workspacesChanged, wrappedListener)
    }
  },
  archiveChange: async (workspacePath: string, changeId: string): Promise<boolean> => {
    return ipcRenderer.invoke(DESKTOP_IPC_CHANNELS.archiveChange, workspacePath, changeId) as Promise<boolean>
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('desktop', desktopApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.desktop = desktopApi
}

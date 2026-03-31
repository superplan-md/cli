import { create } from 'zustand'
import {
  DEFAULT_DESKTOP_OVERLAY_STATE,
  type DesktopOverlayMode,
  type DesktopOverlayState,
  type DesktopOverlaySummary
} from '../../../shared/desktop-contract'

interface DesktopOverlayStoreState {
  overlayState: DesktopOverlayState
  overlaySummary: DesktopOverlaySummary | null
  overlaySummaryError: string | null
  loaded: boolean
  overlaySummaryPrimed: boolean
  knownDoneKeys: Set<string>
  setOverlayState: (overlayState: DesktopOverlayState) => void
  setOverlaySummary: (overlaySummary: DesktopOverlaySummary) => void
  setOverlaySummaryError: (message: string | null) => void
  setOverlayMode: (mode: DesktopOverlayMode) => void
  addKnownDoneKeys: (keys: string[]) => void
}

export const useDesktopOverlayStore = create<DesktopOverlayStoreState>((set) => ({
  overlayState: DEFAULT_DESKTOP_OVERLAY_STATE,
  overlaySummary: null,
  overlaySummaryError: null,
  loaded: false,
  overlaySummaryPrimed: false,
  knownDoneKeys: new Set<string>(),
  setOverlayState: (overlayState) => set({ overlayState, loaded: true }),
  setOverlaySummary: (overlaySummary) =>
    set((state) => {
      if (state.overlaySummaryPrimed) {
        return { overlaySummary, overlaySummaryError: null }
      }

      const knownDoneKeys = new Set(state.knownDoneKeys)
      overlaySummary.allItems.forEach((item) => {
        if (item.status === 'change_done') {
          knownDoneKeys.add(`${item.workspaceId}:${item.changeId}`)
        }
      })

      return {
        overlaySummary,
        overlaySummaryError: null,
        overlaySummaryPrimed: true,
        knownDoneKeys
      }
    }),
  setOverlaySummaryError: (message) => set({ overlaySummaryError: message }),
  setOverlayMode: (mode) =>
    set((state) => ({
      overlayState: {
        ...state.overlayState,
        mode
      },
      loaded: true
    })),
  addKnownDoneKeys: (keys) =>
    set((state) => {
      const next = new Set(state.knownDoneKeys)
      keys.forEach((k) => next.add(k))
      return { knownDoneKeys: next }
    })
}))

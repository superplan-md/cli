import { create } from 'zustand'
import {
  DEFAULT_DESKTOP_LAYOUT_STATE,
  type DesktopLayoutState
} from '../../../shared/desktop-contract'

interface DesktopLayoutStoreState {
  layoutState: DesktopLayoutState
  loaded: boolean
  setLayoutState: (layoutState: DesktopLayoutState) => void
  setPanelLayout: (panelLayout: number[]) => void
  setNavigationCollapsed: (navigationCollapsed: boolean) => void
}

export const useDesktopLayoutStore = create<DesktopLayoutStoreState>((set) => ({
  layoutState: DEFAULT_DESKTOP_LAYOUT_STATE,
  loaded: false,
  setLayoutState: (layoutState) => set({ layoutState, loaded: true }),
  setPanelLayout: (panelLayout) =>
    set((state) => ({
      layoutState: {
        ...state.layoutState,
        shell: {
          ...state.layoutState.shell,
          panelLayout
        }
      },
      loaded: true
    })),
  setNavigationCollapsed: (navigationCollapsed) =>
    set((state) => ({
      layoutState: {
        ...state.layoutState,
        shell: {
          ...state.layoutState.shell,
          navigationCollapsed
        }
      },
      loaded: true
    }))
}))

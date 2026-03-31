import { create } from 'zustand'
import {
  DEFAULT_DESKTOP_CONFIG,
  type DesktopConfig,
  type DesktopConfigPatch
} from '../../../shared/desktop-contract'

interface DesktopConfigStoreState {
  config: DesktopConfig
  loaded: boolean
  setConfig: (config: DesktopConfig) => void
  mergeConfig: (patch: DesktopConfigPatch) => void
}

export const useDesktopConfigStore = create<DesktopConfigStoreState>((set) => ({
  config: DEFAULT_DESKTOP_CONFIG,
  loaded: false,
  setConfig: (config) => set({ config, loaded: true }),
  mergeConfig: (patch) =>
    set((state) => ({
      config: {
        ...state.config,
        ...patch
      },
      loaded: true
    }))
}))

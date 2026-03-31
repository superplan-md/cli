const Store = require('electron-store').default as typeof import('electron-store').default
import {
  DEFAULT_DESKTOP_CONFIG,
  DEFAULT_DESKTOP_LAYOUT_STATE,
  DEFAULT_DESKTOP_OVERLAY_STATE,
  DesktopConfigPatchSchema,
  DesktopConfigSchema,
  DesktopLayoutStateSchema,
  DesktopOverlayModeSchema,
  DesktopOverlayStateSchema,
  type DesktopConfig,
  type DesktopConfigPatch,
  type DesktopLayoutState,
  type DesktopOverlayMode,
  type DesktopOverlayState
} from '../shared/desktop-contract'

interface DesktopStoreShape {
  config: DesktopConfig
  layoutState: DesktopLayoutState
  overlayState: DesktopOverlayState
}

const desktopStore = new Store<DesktopStoreShape>({
  name: 'desktop-preferences',
  defaults: {
    config: DEFAULT_DESKTOP_CONFIG,
    layoutState: DEFAULT_DESKTOP_LAYOUT_STATE,
    overlayState: DEFAULT_DESKTOP_OVERLAY_STATE
  }
})

export function getDesktopConfig(): DesktopConfig {
  return DesktopConfigSchema.parse({
    ...DEFAULT_DESKTOP_CONFIG,
    ...desktopStore.get('config')
  })
}

export function updateDesktopConfig(patch: DesktopConfigPatch): DesktopConfig {
  const validatedPatch = DesktopConfigPatchSchema.parse(patch)
  const nextConfig = DesktopConfigSchema.parse({
    ...getDesktopConfig(),
    ...validatedPatch
  })

  desktopStore.set('config', nextConfig)
  return nextConfig
}

export function getDesktopLayoutState(): DesktopLayoutState {
  const storedLayoutState = desktopStore.get('layoutState')

  return DesktopLayoutStateSchema.parse({
    ...DEFAULT_DESKTOP_LAYOUT_STATE,
    ...storedLayoutState,
    shell: {
      ...DEFAULT_DESKTOP_LAYOUT_STATE.shell,
      ...storedLayoutState?.shell
    }
  })
}

export function saveDesktopLayoutState(state: DesktopLayoutState): DesktopLayoutState {
  const nextLayoutState = DesktopLayoutStateSchema.parse(state)
  desktopStore.set('layoutState', nextLayoutState)
  return nextLayoutState
}

export function getDesktopOverlayState(): DesktopOverlayState {
  const storedOverlayState = desktopStore.get('overlayState')

  return DesktopOverlayStateSchema.parse({
    ...DEFAULT_DESKTOP_OVERLAY_STATE,
    ...storedOverlayState
  })
}

export function saveDesktopOverlayState(state: DesktopOverlayState): DesktopOverlayState {
  const nextOverlayState = DesktopOverlayStateSchema.parse(state)
  desktopStore.set('overlayState', nextOverlayState)
  return nextOverlayState
}

export function updateDesktopOverlayMode(mode: DesktopOverlayMode): DesktopOverlayState {
  const nextMode = DesktopOverlayModeSchema.parse(mode)
  const nextOverlayState = {
    ...getDesktopOverlayState(),
    mode: nextMode
  }

  desktopStore.set('overlayState', nextOverlayState)
  return nextOverlayState
}

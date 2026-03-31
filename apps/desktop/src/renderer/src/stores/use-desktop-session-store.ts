import { create } from 'zustand'
import { type DesktopTaskStreamEvent } from '../../../shared/desktop-contract'

interface DesktopSessionStoreState {
  ready: boolean
  windowFocused: boolean
  windowFullscreen: boolean
  lastEvent: DesktopTaskStreamEvent | null
  eventHistory: DesktopTaskStreamEvent[]
  setWindowState: (state: { focused: boolean; fullscreen: boolean }) => void
  pushEvent: (event: DesktopTaskStreamEvent) => void
}

export const useDesktopSessionStore = create<DesktopSessionStoreState>((set) => ({
  ready: false,
  windowFocused: true,
  windowFullscreen: false,
  lastEvent: null,
  eventHistory: [],
  setWindowState: (nextState) =>
    set({
      windowFocused: nextState.focused,
      windowFullscreen: nextState.fullscreen
    }),
  pushEvent: (event) =>
    set((state) => ({
      ready: state.ready || event.type === 'desktop-ready',
      windowFocused:
        event.type === 'window-focus-changed' ? event.focused : state.windowFocused,
      windowFullscreen:
        event.type === 'window-fullscreen-changed' ? event.fullscreen : state.windowFullscreen,
      lastEvent: event,
      eventHistory: [...state.eventHistory.slice(-19), event]
    }))
}))

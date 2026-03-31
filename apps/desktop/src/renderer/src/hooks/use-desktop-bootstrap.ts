import { useEffect } from 'react'
import { useDesktopConfigStore } from '@/stores/use-desktop-config-store'
import { useDesktopLayoutStore } from '@/stores/use-desktop-layout-store'
import { useDesktopOverlayStore } from '@/stores/use-desktop-overlay-store'
import { useDesktopSessionStore } from '@/stores/use-desktop-session-store'

export function useDesktopBootstrap(): void {
  const setConfig = useDesktopConfigStore((state) => state.setConfig)
  const setLayoutState = useDesktopLayoutStore((state) => state.setLayoutState)
  const setOverlayState = useDesktopOverlayStore((state) => state.setOverlayState)
  const setOverlaySummary = useDesktopOverlayStore((state) => state.setOverlaySummary)
  const setOverlaySummaryError = useDesktopOverlayStore((state) => state.setOverlaySummaryError)
  const setWindowState = useDesktopSessionStore((state) => state.setWindowState)
  const pushEvent = useDesktopSessionStore((state) => state.pushEvent)

  useEffect(() => {
    let disposed = false

    const unsubscribeTaskStream = window.desktop.onTaskStreamEvent((event) => {
      pushEvent(event)
    })
    const unsubscribeOverlaySummary = window.desktop.onOverlaySummaryChanged((summary) => {
      if (disposed) return
      setOverlaySummary(summary)
      setOverlaySummaryError(null)
    })

    void Promise.allSettled([
      window.desktop.getConfig(),
      window.desktop.getLayoutState(),
      window.desktop.getOverlayState(),
      window.desktop.getOverlaySummary(),
      window.desktop.getWindowState()
    ]).then((results) => {
      if (disposed) return

      const [configResult, layoutResult, overlayStateResult, overlaySummaryResult, windowStateResult] = results

      if (configResult.status === 'fulfilled') {
        setConfig(configResult.value)
      }

      if (layoutResult.status === 'fulfilled') {
        setLayoutState(layoutResult.value)
      }

      if (overlayStateResult.status === 'fulfilled') {
        setOverlayState(overlayStateResult.value)
      }

      if (overlaySummaryResult.status === 'fulfilled') {
        setOverlaySummary(overlaySummaryResult.value)
      } else {
        const message =
          overlaySummaryResult.reason instanceof Error
            ? overlaySummaryResult.reason.message
            : String(overlaySummaryResult.reason)
        setOverlaySummaryError(message)
      }

      if (windowStateResult.status === 'fulfilled') {
        setWindowState(windowStateResult.value)
      }
    })

    return () => {
      disposed = true
      unsubscribeTaskStream()
      unsubscribeOverlaySummary()
    }
  }, [pushEvent, setConfig, setLayoutState, setOverlayState, setOverlaySummary, setOverlaySummaryError, setWindowState])
}

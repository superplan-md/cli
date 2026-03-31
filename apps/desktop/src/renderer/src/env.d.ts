/// <reference types="vite/client" />

import type { DesktopApi } from '../../shared/desktop-contract'

declare global {
  interface Window {
    desktop: DesktopApi
  }
}

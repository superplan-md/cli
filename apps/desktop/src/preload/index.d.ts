import { ElectronAPI } from '@electron-toolkit/preload'
import { DesktopApi } from '../shared/desktop-contract'

declare global {
  interface Window {
    electron: ElectronAPI
    desktop: DesktopApi
  }
}

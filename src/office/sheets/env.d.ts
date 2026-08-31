import type { DesktopApi } from './shared/desktop-api'

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}

export {}

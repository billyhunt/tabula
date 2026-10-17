import type { TabulaApi } from '../src/shared/ipc'

// page.evaluate callbacks run in the renderer, where the preload exposes this.
declare global {
  interface Window {
    tabula: TabulaApi
  }
}

/// <reference types="vite/client" />
import type { TabulaApi } from '../shared/ipc'

declare global {
  interface Window {
    tabula: TabulaApi
  }
}

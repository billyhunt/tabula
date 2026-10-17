/// <reference types="vite/client" />
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { TabulaApi } from '../shared/ipc'

declare global {
  interface Window {
    tabula: TabulaApi
    /** Dev builds only: the editor, for scripts driving the app over CDP. */
    __excalidraw?: ExcalidrawImperativeAPI
  }
}

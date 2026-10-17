// Must be imported before Excalidraw. Excalidraw resolves its fonts against
// this path, and a relative "./" would resolve against window.location.origin,
// which is "null" under file:// in the packaged app.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL('.', window.location.href).href

export {}

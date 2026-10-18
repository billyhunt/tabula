import { app, dialog, ipcMain } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { Channels, type LibraryInstall } from '../shared/ipc'
import { createWindow, editorWindows, focusedWindow } from './windows'

/**
 * Excalidraw's library, kept for every window in one file under userData, and
 * libraries installed from libraries.excalidraw.com.
 *
 * Installing: "Browse libraries" sends the site our return URL
 * (tabula://library, registered in electron-builder.yml). Its "Add to
 * Excalidraw" button opens tabula://library#addLibrary=<url>&token=<id>,
 * macOS hands that to `handleLibraryUrl`, and main downloads the library
 * (the page's CSP keeps the window off the network). The window then asks
 * before adding it, unless the token shows it started the browse itself.
 */

const libraryFile = () => path.join(app.getPath('userData'), 'library.excalidrawlib')

// The stored file, as last read or written: a save that would write the same
// bytes is skipped, which also ends the echo between windows.
let stored: string | null = null

const ItemsSchema = z.array(z.unknown()).max(10_000)

const LibraryFileSchema = z.object({
  type: z.literal('excalidrawlib'),
  libraryItems: z.array(z.unknown()).optional(),
  // Version 1 files keep their items here.
  library: z.array(z.unknown()).optional(),
})

const loadLibrary = async (): Promise<unknown[] | null> => {
  // What was last saved, even if its write hasn't landed yet; else the file.
  // A save that lands while the file is being read wins over what was read.
  let text = stored
  if (text === null) {
    const disk = await readFile(libraryFile(), 'utf8').catch(() => null)
    text = stored ?? disk
  }
  if (text === null) return null
  stored = text
  try {
    const parsed = LibraryFileSchema.safeParse(JSON.parse(text))
    return parsed.success ? (parsed.data.libraryItems ?? parsed.data.library ?? null) : null
  } catch {
    // Unreadable: start empty; the next save replaces it.
    return null
  }
}

// Writes queue in call order so the file ends with the newest library.
let writing: Promise<void> = Promise.resolve()

const saveLibrary = (items: unknown[], from: Electron.WebContents) => {
  const text = JSON.stringify({ type: 'excalidrawlib', version: 2, source: 'tabula', libraryItems: items })
  if (text === stored) return writing
  stored = text
  writing = writing
    .catch(() => undefined)
    .then(async () => {
      // Written beside, then renamed: a crash mid-write never leaves half a library.
      const temp = `${libraryFile()}.tmp`
      await writeFile(temp, text, 'utf8')
      await rename(temp, libraryFile())
    })
  // Other windows show the same library.
  for (const win of editorWindows()) {
    if (win.webContents !== from) win.webContents.send(Channels.libraryChanged, items)
  }
  return writing
}

// ── Installing ──────────────────────────────────────────────────────────────

const MAX_LIBRARY_BYTES = 20 * 1024 * 1024

/** Libraries come from Excalidraw's own sites, as excalidraw.com allows by default. */
const isAllowedLibraryUrl = (url: URL) =>
  url.protocol === 'https:' &&
  (url.hostname === 'excalidraw.com' || url.hostname.endsWith('.excalidraw.com'))

/** A library link that didn't work: say so, rather than nothing happening. */
const reportInstallProblem = (detail: string) => {
  console.error('library install:', detail)
  const show = () =>
    void dialog.showMessageBox({ type: 'warning', message: "Tabula couldn't add that library.", detail })
  // A link that launched the app arrives before it is ready to show anything.
  if (app.isReady()) show()
  else void app.whenReady().then(show)
}

// Downloaded and waiting for a window to take them.
const pending: LibraryInstall[] = []

/** Tells a window there are libraries to take, opening one if none is. */
const announceInstalls = () => {
  if (!app.isReady()) return // The first window takes them once it loads.
  const win = focusedWindow() ?? createWindow()
  if (win.webContents.isLoading()) return // It takes them when ready.
  win.webContents.send(Channels.libraryInstallReady)
  if (win.isMinimized()) win.restore()
  win.focus()
}

/** Handles a tabula://library#addLibrary=…&token=… link from the browser. */
export const handleLibraryUrl = async (link: string) => {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return
  }
  if (url.protocol !== 'tabula:') return
  const params = new URLSearchParams(url.hash.slice(1))
  const source = params.get('addLibrary')
  if (!source) return
  let libraryUrl: URL
  try {
    libraryUrl = new URL(source)
  } catch {
    reportInstallProblem(`The link didn't contain a library address: ${source}`)
    return
  }
  if (!isAllowedLibraryUrl(libraryUrl)) {
    reportInstallProblem(`Libraries can only come from excalidraw.com, not ${libraryUrl.host}.`)
    return
  }
  try {
    // No redirects: the allowlist only vouches for the URL it checked.
    const response = await fetch(libraryUrl, { redirect: 'error' })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    // Read with a cap, whatever content-length claims.
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > MAX_LIBRARY_BYTES) throw new Error('library too large')
      chunks.push(chunk)
    }
    const json = Buffer.concat(chunks).toString('utf8')
    LibraryFileSchema.parse(JSON.parse(json))
    pending.push({ json, token: params.get('token') })
    announceInstalls()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    reportInstallProblem(`Downloading ${libraryUrl.href} failed: ${reason}`)
  }
}

export const registerLibraryIpc = () => {
  ipcMain.handle(Channels.libraryLoad, () => loadLibrary())
  ipcMain.handle(Channels.librarySave, (event, items: unknown) =>
    saveLibrary(ItemsSchema.parse(items), event.sender),
  )
  ipcMain.handle(Channels.libraryTakeInstalls, (event) => {
    // Only a drawing window takes them; hidden helpers never ask.
    if (!editorWindows().some((win) => win.webContents === event.sender)) return []
    return pending.splice(0)
  })
}

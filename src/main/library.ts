import { app, ipcMain } from 'electron'
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
  const text = await readFile(libraryFile(), 'utf8').catch(() => null)
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
    console.error('library install: not a URL:', source)
    return
  }
  if (!isAllowedLibraryUrl(libraryUrl)) {
    console.error('library install: refused', libraryUrl.href)
    return
  }
  try {
    const response = await fetch(libraryUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > MAX_LIBRARY_BYTES) throw new Error('library too large')
    const json = await response.text()
    if (json.length > MAX_LIBRARY_BYTES) throw new Error('library too large')
    LibraryFileSchema.parse(JSON.parse(json))
    pending.push({ json, token: params.get('token') })
    announceInstalls()
  } catch (err) {
    console.error(`library install from ${libraryUrl.href} failed:`, err)
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

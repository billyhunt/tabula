import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Channels, type MenuCommand, type PendingFile } from '../shared/ipc'
import { createClaims } from './claims'
import { RENDERER_URL } from './rendererProtocol'

const here = path.dirname(fileURLToPath(import.meta.url))

// How long a closing window gets to write its drawing before we ask.
const FLUSH_TIMEOUT_MS = 10_000

const FlushResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string().nullable() }),
])

// Set by ⌘Q, so a window that stopped the quit to save can resume it.
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

/**
 * Has the window save what autosave would before it closes. Resolves true
 * when it may close: saved, or nothing to save. Otherwise (autosave off, or
 * the save failed) the user chooses between keeping the window and losing
 * the edits.
 */
const saveBeforeClose = async (win: BrowserWindow): Promise<boolean> => {
  const answer = await new Promise<unknown>((resolve) => {
    const onDone = (event: Electron.IpcMainEvent, result: unknown) => {
      if (event.sender === win.webContents) finish(result)
    }
    const timer = setTimeout(() => finish(null), FLUSH_TIMEOUT_MS)
    const finish = (result: unknown) => {
      clearTimeout(timer)
      ipcMain.off(Channels.flushDone, onDone)
      resolve(result)
    }
    ipcMain.on(Channels.flushDone, onDone)
    win.webContents.send(Channels.flushRequest)
  })
  const parsed = FlushResultSchema.safeParse(answer)
  if (parsed.success && parsed.data.ok) return true
  const autosaveOff = parsed.success && !parsed.data.ok && parsed.data.error === null
  const detail = !parsed.success
    ? "The drawing didn't answer in time."
    : parsed.data.ok
      ? undefined
      : (parsed.data.error ?? 'Autosave is off. Save it first (⌘S) to keep the changes.')
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: autosaveOff ? 'This drawing has unsaved changes.' : "Tabula couldn't save this drawing.",
    detail,
    buttons: ['Cancel', 'Close Without Saving'],
    defaultId: 0,
    cancelId: 0,
  })
  return response === 1
}

const claims = createClaims<BrowserWindow>()

/** Ends the claim; the file the window represents takes over. */
export const releaseClaim = (win: BrowserWindow) => claims.release(win)

/** Marks `win` as having `file` loaded into it by an agent, until the editor reports it. */
export const claimForLoad = (win: BrowserWindow, file: string) => claims.loading(win, file)

/** Whether `win` has a claimed file the editor has not yet confirmed. */
export const hasPendingFile = (win: BrowserWindow) => claims.fileOf(win) !== undefined

export const createWindow = (filePath?: string) => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#f2f0eb',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  win.on('enter-full-screen', () => win.webContents.send(Channels.fullscreen, true))
  win.on('focus', () => {
    lastFocused = win
  })
  // Unsaved edits are written before the window goes, quit included. One
  // save-and-ask at a time: closing again while it runs waits for it.
  let saved = false
  let closing = false
  win.on('close', (event) => {
    if (saved || !win.isDocumentEdited() || win.webContents.isCrashed()) return
    event.preventDefault()
    if (closing) return
    closing = true
    void saveBeforeClose(win).then((mayClose) => {
      closing = false
      if (!mayClose) {
        quitting = false
        return
      }
      saved = true
      if (quitting) app.quit()
      else if (!win.isDestroyed()) win.close()
    })
  })
  win.on('closed', () => {
    editors.delete(win)
    if (lastFocused === win) lastFocused = null
  })
  editors.add(win)
  lastFocused = win
  win.on('leave-full-screen', () => win.webContents.send(Channels.fullscreen, false))

  // Links in drawings open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  // A reload before the editor reported its file asks for the file again.
  win.webContents.on('did-start-loading', () => claims.reloaded(win))

  if (filePath) claims.expect(win, filePath)

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void win.loadURL(RENDERER_URL)
  }
  return win
}

/**
 * The drawing this window was made to open, read from disk; null when it has
 * none or already took it on this page load. The editor asks once it is ready
 * to listen, so the file cannot arrive before it can be loaded. A file that
 * cannot be read ends the claim and comes back as an error for the editor to
 * show, so the window is just an empty one.
 */
export const takePendingFile = async (win: BrowserWindow): Promise<PendingFile | null> => {
  const file = claims.take(win)
  if (file === undefined) return null
  try {
    const contents = await readFile(file, 'utf8')
    app.addRecentDocument(file)
    return { path: file, contents }
  } catch (err) {
    releaseClaim(win)
    return { path: file, error: err instanceof Error ? err.message : String(err) }
  }
}

// Drawing windows only. Hidden helpers (the PDF printer) are BrowserWindows
// too, but must never receive menu commands or agent calls.
const editors = new Set<BrowserWindow>()

/** Open drawing windows, oldest first. */
export const editorWindows = (): BrowserWindow[] => [...editors]

const realPath = (file: string) => {
  try {
    return realpathSync.native(file)
  } catch {
    return path.normalize(file)
  }
}

/**
 * The drawing window showing `target`, if any: by the file it was claimed to
 * open while the editor has not confirmed it, else by the file it represents.
 * Two windows on one file would autosave over each other.
 */
export const windowOnFile = (target: string): BrowserWindow | undefined => {
  const wanted = realPath(target)
  return editorWindows().find((win) => {
    const shown = claims.fileOf(win) ?? win.getRepresentedFilename()
    return shown !== '' && realPath(shown) === wanted
  })
}

// Agents act while the user sits in a terminal, when no window has focus, so
// "the window" means the one focused last, not merely any open window.
let lastFocused: BrowserWindow | null = null

/** The window menu commands and agents act on. */
export const focusedWindow = (): BrowserWindow | undefined => {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && editors.has(focused)) return focused
  return lastFocused ?? editorWindows()[0]
}

export const sendCommand = (cmd: MenuCommand) => {
  const win = focusedWindow()
  if (win) win.webContents.send(Channels.menuCommand, cmd)
  else if (cmd === 'new') createWindow()
}

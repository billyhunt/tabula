import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Channels, type MenuCommand, type OpenedFile } from '../shared/ipc'
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
 * when it may close: saved, nothing to save, or autosave is off. When the
 * save fails, the user chooses between keeping the window and losing edits.
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
  if (parsed.success && (parsed.data.ok || parsed.data.error === null)) return true
  const detail = parsed.success && !parsed.data.ok ? parsed.data.error : "The drawing didn't answer in time."
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: "Tabula couldn't save this drawing.",
    detail: detail ?? undefined,
    buttons: ['Cancel', 'Close Without Saving'],
    defaultId: 0,
    cancelId: 0,
  })
  return response === 1
}

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
  // Unsaved edits are written before the window goes, quit included.
  let saved = false
  win.on('close', (event) => {
    if (saved || !win.isDocumentEdited() || win.webContents.isCrashed()) return
    event.preventDefault()
    void saveBeforeClose(win).then((mayClose) => {
      if (!mayClose) {
        quitting = false
        return
      }
      saved = true
      if (quitting) app.quit()
      else win.close()
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

  if (filePath) {
    win.webContents.once('did-finish-load', () => void openInWindow(win, filePath))
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void win.loadURL(RENDERER_URL)
  }
  return win
}

/** Reads a drawing from disk and hands it to the window to load. */
export const openInWindow = async (win: BrowserWindow, filePath: string) => {
  const file: OpenedFile = { path: filePath, contents: await readFile(filePath, 'utf8') }
  win.webContents.send(Channels.fileOpened, file)
  app.addRecentDocument(filePath)
}

// Drawing windows only. Hidden helpers (the PDF printer) are BrowserWindows
// too, but must never receive menu commands or agent calls.
const editors = new Set<BrowserWindow>()

/** Open drawing windows, oldest first. */
export const editorWindows = (): BrowserWindow[] => [...editors]

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

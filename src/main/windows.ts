import { app, BrowserWindow, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Channels, type MenuCommand, type OpenedFile } from '../shared/ipc'
import { RENDERER_URL } from './rendererProtocol'

const here = path.dirname(fileURLToPath(import.meta.url))

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
  win.on('closed', () => {
    if (lastFocused === win) lastFocused = null
  })
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

// Agents act while the user sits in a terminal, when no window has focus, so
// "the window" means the one focused last, not merely any open window.
let lastFocused: BrowserWindow | null = null

/** The window menu commands and agents act on. */
export const focusedWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? lastFocused ?? BrowserWindow.getAllWindows()[0]

export const sendCommand = (cmd: MenuCommand) => {
  const win = focusedWindow()
  if (win) win.webContents.send(Channels.menuCommand, cmd)
  else if (cmd === 'new') createWindow()
}

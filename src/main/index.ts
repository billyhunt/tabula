import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Channels, type MenuCommand, type OpenedFile } from '../shared/ipc'

const here = path.dirname(fileURLToPath(import.meta.url))
// Obsidian Excalidraw (.excalidraw.md) is the native format; plain
// .excalidraw files still open and save in their own format.
const FILTERS = [{ name: 'Drawing', extensions: ['md', 'excalidraw'] }]

// Save As opens where the last drawing was saved, so once a drawing lands in
// an Obsidian vault, new ones default there too.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

const lastSaveDir = (): string => {
  try {
    const dir = JSON.parse(readFileSync(settingsFile(), 'utf8')).lastSaveDir
    if (typeof dir === 'string' && existsSync(dir)) return dir
  } catch {
    // No settings yet, or unreadable: fall through to the default.
  }
  return app.getPath('documents')
}

const rememberSaveDir = (filePath: string) =>
  writeFile(settingsFile(), JSON.stringify({ lastSaveDir: path.dirname(filePath) }), 'utf8')

app.setName('Tabula')

// Files handed to us by Finder before the first window exists.
const pendingOpens: string[] = []

const createWindow = (filePath?: string) => {
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
  win.on('leave-full-screen', () => win.webContents.send(Channels.fullscreen, false))

  // Links in drawings open in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (filePath) {
    win.webContents.once('did-finish-load', () => void sendFile(win, filePath))
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    void win.loadFile(path.join(here, '../dist/index.html'))
  }
  return win
}

const sendFile = async (win: BrowserWindow, filePath: string) => {
  const file: OpenedFile = { path: filePath, contents: await readFile(filePath, 'utf8') }
  win.webContents.send(Channels.fileOpened, file)
  app.addRecentDocument(filePath)
}

const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

const command = (cmd: MenuCommand) => () => {
  const win = focused()
  if (win) win.webContents.send(Channels.menuCommand, cmd)
  else if (cmd === 'new') createWindow()
}

const buildMenu = () => {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'New Drawing', accelerator: 'CmdOrCtrl+N', click: command('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: command('open') },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: command('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: command('save-as') },
        { type: 'separator' },
        // Shown for discoverability only: Excalidraw handles ⇧⌘E itself.
        {
          label: 'Export Image…',
          accelerator: 'CmdOrCtrl+Shift+E',
          registerAccelerator: false,
          click: command('export-image'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    // Keys reach the page first, and Excalidraw claims its shortcuts there,
    // so these roles only act in text fields and dialogs.
    { role: 'editMenu' },
    // Not the stock viewMenu: its ⌘+ / ⌘− / ⌘0 zoom the whole page, which
    // would shadow Excalidraw's canvas zoom on the same keys. Reload has no
    // shortcut because it throws away unsaved work.
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: '' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const registerIpc = () => {
  ipcMain.handle(Channels.openFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: FILTERS })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    app.addRecentDocument(filePath)
    return { path: filePath, contents: await readFile(filePath, 'utf8') } satisfies OpenedFile
  })

  ipcMain.handle(Channels.saveFile, async (_event, filePath: string, contents: string) => {
    await writeFile(filePath, contents, 'utf8')
    return { path: filePath }
  })

  ipcMain.handle(Channels.pickSavePath, async (event, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const defaultPath = path.isAbsolute(suggestedName)
      ? suggestedName
      : path.join(lastSaveDir(), suggestedName)
    const result = await dialog.showSaveDialog(win!, { defaultPath, filters: FILTERS })
    if (result.canceled || !result.filePath) return null
    app.addRecentDocument(result.filePath)
    await rememberSaveDir(result.filePath)
    return result.filePath
  })

  ipcMain.on(Channels.setDirty, (event, dirty: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setDocumentEdited(dirty)
  })

  ipcMain.on(Channels.setTitle, (event, filePath: string | null) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setRepresentedFilename(filePath ?? '')
    win.setTitle(filePath ? path.basename(filePath) : 'Untitled')
  })
}

// Finder: double-clicking a .excalidraw file, or dropping it on the Dock icon.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) createWindow(filePath)
  else pendingOpens.push(filePath)
})

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  if (pendingOpens.length) pendingOpens.splice(0).forEach((p) => createWindow(p))
  else createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

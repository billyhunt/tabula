import { app, BrowserWindow } from 'electron'
import { registerFileIpc } from './files'
import { installMenu } from './menu'
import { createWindow } from './windows'

app.setName('Tabula')

// Files handed to us by Finder before the first window exists.
const pendingOpens: string[] = []

// Finder: double-clicking a .excalidraw file, or dropping it on the Dock icon.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) createWindow(filePath)
  else pendingOpens.push(filePath)
})

app.whenReady().then(() => {
  installMenu()
  registerFileIpc()
  // Feature IPC registers here.
  if (pendingOpens.length) pendingOpens.splice(0).forEach((p) => createWindow(p))
  else createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

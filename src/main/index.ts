import { app, BrowserWindow } from 'electron'
import { registerAgentIpc } from './agent/ipc'
import { startMcpController } from './agent/mcp'
import { registerFileIpc } from './files'
import { registerExportIpc } from './exports'
import { installMenu } from './menu'
import { registerRendererScheme, serveRenderer } from './rendererProtocol'
import { createWindow } from './windows'
import { registerVersionIpc } from './versions'

app.setName('Tabula')
// End-to-end tests run against a throwaway profile, never the real settings,
// versions or MCP token.
if (process.env.TABULA_USER_DATA) app.setPath('userData', process.env.TABULA_USER_DATA)
registerRendererScheme()

// Files handed to us by Finder before the first window exists.
const pendingOpens: string[] = []

// Finder: double-clicking a .excalidraw file, or dropping it on the Dock icon.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) createWindow(filePath)
  else pendingOpens.push(filePath)
})

app.whenReady().then(() => {
  serveRenderer()
  installMenu()
  registerFileIpc()
  // Feature IPC registers here.
  registerExportIpc()
  registerVersionIpc()
  registerAgentIpc()
  startMcpController()
  if (pendingOpens.length) pendingOpens.splice(0).forEach((p) => createWindow(p))
  else createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

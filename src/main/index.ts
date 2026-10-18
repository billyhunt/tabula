import { app } from 'electron'
import path from 'node:path'
import { registerAgentIpc } from './agent/ipc'
import { startMcpController } from './agent/mcp'
import { registerFileIpc } from './files'
import { handleLibraryUrl, registerLibraryIpc } from './library'
import { registerExportIpc } from './exports'
import { installMenu } from './menu'
import { registerRendererScheme, serveRenderer } from './rendererProtocol'
import { createWindow, editorWindows } from './windows'
import { registerVersionIpc } from './versions'

app.setName('Tabula')
// End-to-end tests run against a throwaway profile, never the real settings,
// versions, MCP token or Documents folder (where untitled drawings autosave).
if (process.env.TABULA_USER_DATA) {
  app.setPath('userData', process.env.TABULA_USER_DATA)
  app.setPath('documents', path.join(process.env.TABULA_USER_DATA, 'Documents'))
}
registerRendererScheme()

// Files handed to us by Finder before the first window exists.
const pendingOpens: string[] = []

// Finder: double-clicking a .excalidraw file, or dropping it on the Dock icon.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (app.isReady()) createWindow(filePath)
  else pendingOpens.push(filePath)
})

// tabula://library#addLibrary=… from libraries.excalidraw.com's "Add to
// Excalidraw". May arrive before ready, when it is what launched the app.
app.on('open-url', (event, url) => {
  event.preventDefault()
  void handleLibraryUrl(url)
})

app.whenReady().then(() => {
  serveRenderer()
  installMenu()
  registerFileIpc()
  // Feature IPC registers here.
  registerExportIpc()
  registerVersionIpc()
  registerLibraryIpc()
  registerAgentIpc()
  startMcpController()
  if (pendingOpens.length) pendingOpens.splice(0).forEach((p) => createWindow(p))
  else createWindow()
  app.on('activate', () => {
    if (editorWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

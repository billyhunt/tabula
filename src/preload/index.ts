import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channels, type MenuCommand, type OpenedFile, type TabulaApi } from '../shared/ipc'

// Subscribes to a main-to-renderer channel and returns the unsubscribe.
const listen = <T>(channel: string, handler: (payload: T) => void) => {
  const wrapped = (_event: IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const api: TabulaApi = {
  openFile: () => ipcRenderer.invoke(Channels.openFile),
  saveFile: (path, contents) => ipcRenderer.invoke(Channels.saveFile, path, contents),
  pickSavePath: (suggestedName) => ipcRenderer.invoke(Channels.pickSavePath, suggestedName),
  setDirty: (dirty) => ipcRenderer.send(Channels.setDirty, dirty),
  setTitle: (path) => ipcRenderer.send(Channels.setTitle, path),
  onMenuCommand: (handler) => listen<MenuCommand>(Channels.menuCommand, handler),
  onFileOpened: (handler) => listen<OpenedFile>(Channels.fileOpened, handler),
  onFullscreen: (handler) => listen<boolean>(Channels.fullscreen, handler),
}

contextBridge.exposeInMainWorld('tabula', api)

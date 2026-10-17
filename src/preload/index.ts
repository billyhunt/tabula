import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  Channels,
  type AgentActivity,
  type AgentRequest,
  type AskEvent,
  type MenuCommand,
  type OpenedFile,
  type TabulaApi,
  type TextToDiagramChunk,
} from '../shared/ipc'
import type { Settings } from '../shared/settings'

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

  settings: {
    get: () => ipcRenderer.invoke(Channels.settingsGet),
    update: (patch) => ipcRenderer.invoke(Channels.settingsUpdate, patch),
    onChange: (handler) => listen<Settings>(Channels.settingsChanged, handler),
  },

  exports: {
    save: (request) => ipcRenderer.invoke(Channels.exportSave, request),
    savePdf: (request) => ipcRenderer.invoke(Channels.exportPdf, request),
    copyImage: (png) => ipcRenderer.invoke(Channels.clipboardImage, png),
    copyText: (text) => ipcRenderer.invoke(Channels.clipboardText, text),
  },

  versions: {
    list: (path) => ipcRenderer.invoke(Channels.versionsList, path),
    read: (path, id) => ipcRenderer.invoke(Channels.versionsRead, path, id),
  },

  agent: {
    onRequest: (handler) => listen<AgentRequest>(Channels.agentRequest, handler),
    respond: (response) => ipcRenderer.send(Channels.agentResponse, response),
    onActivity: (handler) => listen<AgentActivity>(Channels.agentActivity, handler),
    status: () => ipcRenderer.invoke(Channels.agentStatus),
    setupCommand: () => ipcRenderer.invoke(Channels.agentSetupCommand),
    resetToken: () => ipcRenderer.invoke(Channels.agentResetToken),
    ask: (request) => ipcRenderer.invoke(Channels.agentAsk, request),
    onAskEvent: (handler) => listen<AskEvent>(Channels.agentAskEvent, handler),
    cancel: (runId) => ipcRenderer.send(Channels.agentCancel, runId),
    textToDiagram: (runId, messages) =>
      ipcRenderer.invoke(Channels.agentTextToDiagram, runId, messages),
    onTextToDiagramChunk: (handler) =>
      listen<TextToDiagramChunk>(Channels.agentTextToDiagramChunk, handler),
  },
}

contextBridge.exposeInMainWorld('tabula', api)

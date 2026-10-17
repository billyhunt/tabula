import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Channels, type OpenedFile } from '../shared/ipc'
import type { SettingsPatch } from '../shared/settings'
import { getSettings, updateSettings } from './settings'
import { snapshotVersion } from './versions'

// Obsidian Excalidraw (.excalidraw.md) is the native format; plain
// .excalidraw files still open and save in their own format.
const FILTERS = [{ name: 'Drawing', extensions: ['md', 'excalidraw'] }]

/**
 * Save dialogs open where the last drawing was saved, so once a drawing lands
 * in an Obsidian vault, new ones default there too.
 */
export const saveDialogPath = (suggestedName: string): string => {
  if (path.isAbsolute(suggestedName)) return suggestedName
  const dir = getSettings().lastSaveDir
  return path.join(dir && existsSync(dir) ? dir : app.getPath('documents'), suggestedName)
}

/**
 * Writes a drawing to disk. The single place drawings are written, so every
 * save -- manual, autosave or agent -- first keeps what it replaces.
 */
export const writeDrawing = async (filePath: string, contents: string) => {
  const current = await readFile(filePath, 'utf8').catch(() => null)
  if (current !== null && current !== contents) {
    // History is a safety net, not a precondition: a failed snapshot must
    // never cost the user their save.
    await snapshotVersion(filePath, current).catch((err: unknown) =>
      console.error('version snapshot failed:', err),
    )
  }
  await writeFile(filePath, contents, 'utf8')
}

export const registerFileIpc = () => {
  ipcMain.handle(Channels.openFile, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: FILTERS })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    app.addRecentDocument(filePath)
    return { path: filePath, contents: await readFile(filePath, 'utf8') } satisfies OpenedFile
  })

  ipcMain.handle(Channels.saveFile, async (_event, filePath: string, contents: string) => {
    await writeDrawing(filePath, contents)
    return { path: filePath }
  })

  ipcMain.handle(Channels.pickSavePath, async (event, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: saveDialogPath(suggestedName),
      filters: FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    app.addRecentDocument(result.filePath)
    await updateSettings({ lastSaveDir: path.dirname(result.filePath) })
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

  ipcMain.handle(Channels.settingsGet, () => getSettings())
  ipcMain.handle(Channels.settingsUpdate, (_event, patch: SettingsPatch) => updateSettings(patch))
}

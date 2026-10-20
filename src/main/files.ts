import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Channels, type OpenedFile } from '../shared/ipc'
import type { SettingsPatch } from '../shared/settings'
import { getSettings, updateSettings } from './settings'
import { snapshotVersion } from './versions'
import { releaseClaim } from './windows'

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

// Paths handed out but maybe not written yet, so two windows starting in the
// same minute never get the same file.
const handedOut = new Set<string>()

/**
 * Where autosave puts a drawing that was never saved: a new file in
 * Documents/Tabula named for when it was started, never one in use.
 */
export const untitledDrawingPath = async (now = new Date()): Promise<string> => {
  const dir = untitledFolder()
  await mkdir(dir, { recursive: true })
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}.${pad(now.getMinutes())}`
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, `Untitled ${stamp}${n > 1 ? ` ${n}` : ''}.excalidraw.md`)
    if (existsSync(candidate) || handedOut.has(candidate)) continue
    handedOut.add(candidate)
    return candidate
  }
}

const untitledFolder = () => path.join(app.getPath('documents'), 'Tabula')

/**
 * Every autosave file Tabula has allocated and not yet retired, kept in
 * userData so it survives restarts. This, not the file's name, is what makes
 * a path an "untitled autosave": a drawing the user saved under a name that
 * happens to look like one is theirs, and must never be deleted.
 *
 * Each entry also records the file's inode once Tabula first writes it, so a
 * file that later appears at the same path (the autosave moved away, a user
 * file put in its place) doesn't count as Tabula's.
 */
type Registry = Map<string, number | null>

const registryFile = () => path.join(app.getPath('userData'), 'untitled-drawings.json')

const readRegistry = async (): Promise<Registry> => {
  try {
    const raw: unknown = JSON.parse(await readFile(registryFile(), 'utf8'))
    const entries = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? Object.entries(raw) : []
    return new Map(
      entries.filter((e): e is [string, number | null] => e[1] === null || typeof e[1] === 'number'),
    )
  } catch {
    return new Map()
  }
}

// Reads and read-modify-writes run one at a time, and the file is replaced
// in one rename, so no reader ever sees a half-written registry.
let registryQueue: Promise<unknown> = Promise.resolve()

const withRegistry = <T>(use: (registry: Registry) => T | Promise<T>): Promise<T> => {
  const run = registryQueue
    .catch(() => undefined)
    .then(async () => {
      const registry = await readRegistry()
      const before = JSON.stringify([...registry])
      const result = await use(registry)
      if (JSON.stringify([...registry]) !== before) {
        const temp = `${registryFile()}.${process.pid}.tmp`
        await writeFile(temp, JSON.stringify(Object.fromEntries(registry), null, 2), 'utf8')
        await rename(temp, registryFile())
      }
      return result
    })
  registryQueue = run
  return run
}

const inodeOf = async (filePath: string) => (await stat(filePath).catch(() => null))?.ino ?? null

/**
 * Whether the file at `filePath` is still the autosave Tabula allocated
 * there: registered, and either not written yet or the same file it wrote.
 */
const ownsAutosave = async (registry: Registry, filePath: string) => {
  if (!registry.has(filePath)) return false
  const recorded = registry.get(filePath) ?? null
  const current = await inodeOf(filePath)
  return current === null ? recorded === null : current === recorded
}

/** Whether `filePath` is an autosave file Tabula allocated and still owns. */
export const isUntitledDrawing = (filePath: string) =>
  path.isAbsolute(filePath)
    ? withRegistry((registry) => ownsAutosave(registry, path.normalize(filePath)))
    : Promise.resolve(false)

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
  // An autosave's first write fixes which file it is.
  const target = path.normalize(filePath)
  await withRegistry(async (registry) => {
    if (registry.has(target) && registry.get(target) === null) registry.set(target, await inodeOf(target))
  })
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
    const fromUntitled = await isUntitledDrawing(suggestedName)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      // An untitled autosave's own name and folder aren't a suggestion worth
      // making; offer a plain name where drawings were last saved.
      defaultPath: saveDialogPath(fromUntitled ? 'Untitled.excalidraw.md' : suggestedName),
      filters: FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    // Chosen in a Save dialog, the file is the user's now, even if it is an
    // autosave file saved over under its own name.
    await withRegistry((registry) => registry.delete(path.normalize(result.filePath)))
    app.addRecentDocument(result.filePath)
    await updateSettings({ lastSaveDir: path.dirname(result.filePath) })
    return result.filePath
  })

  ipcMain.handle(Channels.untitledPath, async () => {
    const filePath = await untitledDrawingPath()
    await withRegistry((registry) => registry.set(filePath, null))
    app.addRecentDocument(filePath)
    return filePath
  })

  ipcMain.handle(Channels.isUntitledPath, async (_event, filePath: unknown) =>
    typeof filePath === 'string' && (await isUntitledDrawing(filePath)),
  )

  // Only ever removes an autosave file Tabula allocated itself (see the
  // registry), never a path the renderer merely claims is one.
  ipcMain.handle(Channels.retireUntitled, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return
    const target = path.normalize(filePath)
    // Checked and removed inside the registry's queue, so nothing can claim
    // or replace the file between the check and the delete.
    await withRegistry(async (registry) => {
      const owned = await ownsAutosave(registry, target)
      registry.delete(target)
      if (owned) await rm(target, { force: true })
    })
  })

  ipcMain.on(Channels.setDirty, (event, dirty: boolean) => {
    BrowserWindow.fromWebContents(event.sender)?.setDocumentEdited(dirty)
  })

  ipcMain.on(Channels.setTitle, (event, filePath: string | null) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setRepresentedFilename(filePath ?? '')
    // The editor now reports its own file; a claim on it has done its job.
    if (filePath) releaseClaim(win)
    win.setTitle(filePath ? path.basename(filePath) : 'Untitled')
  })

  ipcMain.handle(Channels.settingsGet, () => getSettings())
  ipcMain.handle(Channels.settingsUpdate, (_event, patch: SettingsPatch) => updateSettings(patch))
}

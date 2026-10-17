import { app, ipcMain } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Channels, type DrawingVersion } from '../shared/ipc'

/**
 * A local history of every state a drawing has been in.
 *
 * Snapshots live under userData rather than beside the drawing. Writing them
 * into the user's folder would put noise in their Obsidian vault or git
 * repository, and the whole point is that this is invisible until wanted.
 *
 * What is stored is the content being REPLACED, not the content being
 * written: the live file is already the newest state, so the useful thing to
 * keep is whatever a save is about to overwrite.
 */

/** A hard ceiling, reached only after a very long editing session. */
export const MAX_VERSIONS_PER_FILE = 500

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * The versions to delete, given every version of one file.
 *
 * Recent history is kept in full and older history is thinned, rather than
 * spacing snapshots apart as they are taken. Throttling at write time means a
 * small edit and its reversal leave no trace, so the obvious way to check the
 * feature -- change something, look at the history -- would show nothing.
 *
 * Everything from the last hour survives; the previous day keeps one version
 * per hour; older than that, one per day. The newest version of each bucket
 * is its keeper. Survivors beyond the cap go too, oldest first.
 */
export const versionsToPrune = (
  versions: readonly DrawingVersion[],
  now: number,
): DrawingVersion[] => {
  const newestFirst = [...versions].sort((a, b) => b.savedAt - a.savedAt)
  const seen = new Set<string>()
  const kept: DrawingVersion[] = []
  const doomed: DrawingVersion[] = []

  for (const version of newestFirst) {
    const age = now - version.savedAt
    if (age <= HOUR) {
      kept.push(version)
      continue
    }
    const bucket =
      age <= DAY ? `h${Math.floor(version.savedAt / HOUR)}` : `d${Math.floor(version.savedAt / DAY)}`
    if (seen.has(bucket)) {
      doomed.push(version)
    } else {
      seen.add(bucket)
      kept.push(version)
    }
  }

  return [...doomed, ...kept.slice(MAX_VERSIONS_PER_FILE)]
}

const VERSION_FILE = /^(\d+)-([0-9a-f]{8})\.snapshot$/

const DRAWING_FILE = /\.(md|excalidraw)$/i

/**
 * Only drawings the app could have written get a history. The path comes from
 * the renderer, so it is checked before it decides which directory is read.
 */
const assertDrawingPath = async (input: unknown): Promise<string> => {
  if (typeof input !== 'string' || !path.isAbsolute(input) || !DRAWING_FILE.test(input)) {
    throw new Error('EINVAL: not a drawing path')
  }
  const stats = await fs.stat(input)
  if (!stats.isFile()) throw new Error('EINVAL: not a file')
  return input
}

/** A stable directory per drawing, without putting its path in a filename. */
const dirFor = (filePath: string) =>
  path.join(
    app.getPath('userData'),
    'versions',
    crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex'),
  )

/**
 * The newest stamp handed out per directory.
 *
 * Snapshots are named by millisecond, and two saves can land inside the same
 * one -- a manual save racing an autosave, say. That would leave their order
 * undefined, and if their content hashes also matched, the second would
 * overwrite the first. Stamps are therefore forced to increase.
 */
const lastStamp = new Map<string, number>()

const nextStamp = (dir: string) => {
  const stamp = Math.max(Date.now(), (lastStamp.get(dir) ?? 0) + 1)
  lastStamp.set(dir, stamp)
  return stamp
}

/** Every version of a drawing, newest first. */
const entriesFor = async (filePath: string): Promise<DrawingVersion[]> => {
  const dir = dirFor(filePath)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }

  const versions: DrawingVersion[] = []
  for (const name of names) {
    const match = VERSION_FILE.exec(name)
    if (!match) continue
    try {
      const { size } = await fs.stat(path.join(dir, name))
      versions.push({ id: name, savedAt: Number(match[1]), hash: match[2], bytes: size })
    } catch {
      // Pruned between readdir and stat.
    }
  }
  return versions.sort((a, b) => b.savedAt - a.savedAt)
}

/**
 * Records `content` as a past state of `filePath`.
 *
 * The only thing skipped is a repeat of the newest snapshot, so a save that
 * changed nothing does not add an entry.
 */
export const snapshotVersion = async (filePath: string, content: string): Promise<void> => {
  if (content.length === 0) return

  const drawing = await assertDrawingPath(filePath)
  const dir = dirFor(drawing)
  const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 8)
  if ((await entriesFor(drawing))[0]?.hash === hash) return

  await fs.mkdir(dir, { recursive: true })
  // Keeps the originating path discoverable for maintenance and cleanup,
  // since the directory name is only a hash.
  await fs
    .writeFile(path.join(dir, 'origin.json'), JSON.stringify({ path: drawing }, null, 2))
    .catch(() => undefined)
  await fs.writeFile(path.join(dir, `${nextStamp(dir)}-${hash}.snapshot`), content, 'utf8')

  for (const version of versionsToPrune(await entriesFor(drawing), Date.now())) {
    await fs.rm(path.join(dir, version.id), { force: true }).catch(() => undefined)
  }
}

export const registerVersionIpc = () => {
  ipcMain.handle(Channels.versionsList, async (_event, filePath: unknown) =>
    entriesFor(await assertDrawingPath(filePath)),
  )

  ipcMain.handle(Channels.versionsRead, async (_event, filePath: unknown, id: unknown) => {
    const drawing = await assertDrawingPath(filePath)
    // The id becomes a filename, so it is matched against the exact shape
    // rather than merely checked for separators.
    if (typeof id !== 'string' || !VERSION_FILE.test(id)) {
      throw new Error('EINVAL: not a version id')
    }
    return fs.readFile(path.join(dirFor(drawing), id), 'utf8')
  })
}

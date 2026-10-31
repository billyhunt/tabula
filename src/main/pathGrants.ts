import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

/**
 * The drawing paths this session may write.
 *
 * A drawing's path reaches main from the renderer on every save, and the
 * renderer is web content: it must never be able to make main write to a
 * place the user didn't choose. So main remembers each path it learned
 * itself -- from an Open or Save dialog, a Finder open, an agent's checked
 * path, or its own autosave location -- and refuses to save to any other.
 *
 * Paths are stored by real location (symlinks and `..` resolved), so a link
 * or a dotted path can't be used to name a granted file by another route.
 * A file that doesn't exist yet (a Save dialog's choice) is its folder's real
 * location plus its name.
 *
 * Kept free of Electron so it can be tested on its own.
 */

/** Drawings are saved as .excalidraw.md (Obsidian) or .excalidraw. */
const DRAWING_EXTENSION = /\.excalidraw(\.md)?$/i

/**
 * `filePath` as the drawing save dialog should name it: a name without a
 * drawing extension gets `.excalidraw.md` (a bare `.md` is swapped for it),
 * as the dialog's own "md" filter would otherwise leave a path no save may
 * write to.
 */
export const withDrawingExtension = (filePath: string): string => {
  if (DRAWING_EXTENSION.test(filePath)) return filePath
  return /\.md$/i.test(filePath) ? `${filePath.slice(0, -3)}.excalidraw.md` : `${filePath}.excalidraw.md`
}

/**
 * Where `filePath` really is, or null when it can't be placed: relative,
 * unresolvable, a dangling symlink (writing would create its target), or in a
 * folder that doesn't exist. The path goes to the OS as given, so symlinks
 * are resolved before any `..` that follows them.
 */
export const canonicalPath = async (filePath: unknown): Promise<string | null> => {
  if (typeof filePath !== 'string' || filePath.includes('\0') || !path.isAbsolute(filePath)) return null
  try {
    return await realpath(filePath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return null
  }
  // Missing, or a link to something missing. Only the former is a new file.
  if (await lstat(filePath).then(() => true, () => false)) return null
  const name = path.basename(filePath)
  if (name === '' || name === '.' || name === '..') return null
  try {
    return path.join(await realpath(path.dirname(filePath)), name)
  } catch {
    return null
  }
}

export class PathGrants {
  private readonly granted = new Set<string>()

  /** Allows saving to `filePath`. False, granting nothing, when it can't be placed. */
  async grant(filePath: string): Promise<boolean> {
    const real = await canonicalPath(filePath)
    if (real === null) return false
    this.granted.add(real)
    return true
  }

  async has(filePath: unknown): Promise<boolean> {
    const real = await canonicalPath(filePath)
    return real !== null && this.granted.has(real)
  }

  /**
   * Throws unless `filePath` may be written as a drawing: granted, and named
   * as a drawing both as given and where it really is.
   */
  async assertCanSaveDrawing(filePath: unknown): Promise<void> {
    const real = await canonicalPath(filePath)
    if (typeof filePath !== 'string' || real === null || !this.granted.has(real)) {
      throw new Error(
        `EPERM: Tabula only saves to files chosen in its Open or Save dialogs: ${String(filePath)}`,
      )
    }
    if (!DRAWING_EXTENSION.test(filePath) || !DRAWING_EXTENSION.test(real)) {
      throw new Error(`EPERM: Drawings are saved as .excalidraw.md or .excalidraw: ${filePath}`)
    }
  }
}

/** The grants for this session. */
export const pathGrants = new PathGrants()

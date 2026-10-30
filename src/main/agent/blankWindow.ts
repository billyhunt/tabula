import type { BrowserWindow } from 'electron'

export interface BlankWindow<W = BrowserWindow> {
  win: W
  /** True when the window was opened for this call. */
  created: boolean
}

/** What choosing a window needs from the app; faked in tests. */
export interface BlankWindowDeps<W> {
  /** The window agents act on now. */
  current: () => Promise<W>
  /** Opens a window. */
  create: () => W
  /** Resolves once a window's editor is listening; rejects if it never does. */
  editorReady: (win: W) => Promise<void>
  /** A window made to open a file that its editor has not yet confirmed. */
  hasPendingFile: (win: W) => boolean
  /** Whether a window holds no file and no drawing; rejects if it cannot answer. */
  isBlank: (win: W) => Promise<boolean>
}

/**
 * Picks the window for a drawing of the agent's own, so the user's open
 * drawing is never replaced: the current window when it holds nothing yet,
 * else a new one (always a new one with `fresh`).
 */
export const makeBlankWindow =
  <W extends { isDestroyed(): boolean; close(): void }>(deps: BlankWindowDeps<W>) =>
  async (options?: { fresh?: boolean }): Promise<BlankWindow<W>> => {
    if (!options?.fresh) {
      const current = await deps.current()
      // A window that cannot answer (stuck in a dialog, say) counts as occupied:
      // a new window is safe, replacing what is in it is not.
      const blank = !deps.hasPendingFile(current) && (await deps.isBlank(current).catch(() => false))
      if (blank) return { win: current, created: false }
    }
    const win = deps.create()
    try {
      await deps.editorReady(win)
    } catch (err) {
      if (!win.isDestroyed()) win.close()
      throw err
    }
    return { win, created: true }
  }

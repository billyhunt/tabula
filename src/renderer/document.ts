import type { OpenedFile } from '../shared/ipc'

/**
 * What features (autosave, versions, agents) may do to the open drawing.
 * App owns the state; features act through this so the dirty flag, title
 * and Obsidian envelope stay consistent.
 */
export interface DocumentController {
  /** Path of the open drawing, or null while it is untitled. */
  filePath: string | null
  dirty: boolean
  /** Replaces the canvas with a file's contents and marks it saved. */
  load(file: OpenedFile): Promise<void>
  /**
   * Replaces the canvas with `contents` (in the format `formatPath` implies)
   * but keeps the current path and leaves the drawing unsaved. Used to
   * restore an old version: the user decides whether to save it.
   */
  restore(contents: string, formatPath: string): Promise<void>
  /** Saves to the current path, or asks for one. Resolves to the saved path. */
  save(): Promise<string | null>
  saveAs(): Promise<string | null>
  /** Saves to `path` without a dialog and makes it the current path. */
  saveTo(path: string): Promise<string>
  newDrawing(options?: { force?: boolean }): void
  /** The scene as file contents in the format `targetPath` implies. */
  serialize(targetPath: string): string
}

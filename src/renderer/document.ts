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
  /**
   * Saves without a dialog, to `path` (which becomes the current file), or
   * with null to the drawing's current file as of when the save runs, so a
   * queued save follows a Save As that lands first.
   */
  saveTo(path: string | null): Promise<string>
  /**
   * Saves unsaved edits the way autosave does, without a dialog: to the
   * current path, or for a drawing never saved, to a new file in
   * Documents/Tabula. Resolves true once nothing is left unsaved, false when
   * autosave is off and there are unsaved edits.
   */
  flush(): Promise<boolean>
  /** Starts a blank drawing, first saving or confirming unsaved edits unless forced. */
  newDrawing(options?: { force?: boolean }): Promise<void>
  /** The scene as file contents in the format `targetPath` implies. */
  serialize(targetPath: string): string
}

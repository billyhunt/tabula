/** Channel names and payload types shared by main, preload and renderer. */

export const Channels = {
  openFile: 'file:open',
  saveFile: 'file:save',
  pickSavePath: 'file:pick-save-path',
  readFile: 'file:read',
  setDirty: 'window:set-dirty',
  setTitle: 'window:set-title',
  menuCommand: 'menu:command',
  fileOpened: 'file:opened',
  fullscreen: 'window:fullscreen',
} as const

export type MenuCommand = 'new' | 'open' | 'save' | 'save-as' | 'export-image'

export interface OpenedFile {
  path: string
  contents: string
}

export interface SaveResult {
  path: string
}

export interface TabulaApi {
  openFile(): Promise<OpenedFile | null>
  saveFile(path: string, contents: string): Promise<SaveResult>
  /** Shows the Save dialog and returns the chosen path; writes nothing. */
  pickSavePath(suggestedName: string): Promise<string | null>
  setDirty(dirty: boolean): void
  setTitle(path: string | null): void
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  onFileOpened(handler: (file: OpenedFile) => void): () => void
  onFullscreen(handler: (fullscreen: boolean) => void): () => void
}

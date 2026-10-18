/** Channel names and payload types shared by main, preload and renderer. */
import type { Provider } from './providers'
import type { Settings, SettingsPatch } from './settings'

export const Channels = {
  openFile: 'file:open',
  saveFile: 'file:save',
  pickSavePath: 'file:pick-save-path',
  untitledPath: 'file:untitled-path',
  /** Main asks the window to save before it closes; the window answers on flushDone. */
  flushRequest: 'window:flush-request',
  flushDone: 'window:flush-done',
  setDirty: 'window:set-dirty',
  setTitle: 'window:set-title',
  menuCommand: 'menu:command',
  fileOpened: 'file:opened',
  fullscreen: 'window:fullscreen',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',

  exportSave: 'export:save',
  exportPdf: 'export:pdf',
  clipboardImage: 'clipboard:image',
  clipboardText: 'clipboard:text',

  versionsList: 'versions:list',
  versionsRead: 'versions:read',

  libraryLoad: 'library:load',
  librarySave: 'library:save',
  /** Main to the other windows: the library changed; here it is. */
  libraryChanged: 'library:changed',
  libraryTakeInstalls: 'library:take-installs',
  /** Main to a window: libraries are waiting to be installed. */
  libraryInstallReady: 'library:install-ready',

  agentRequest: 'agent:request',
  agentResponse: 'agent:response',
  agentActivity: 'agent:activity',
  agentStatus: 'agent:status',
  agentSetupCommand: 'agent:setup-command',
  agentResetToken: 'agent:reset-token',
  agentSetKey: 'agent:set-key',
  agentModels: 'agent:models',
  agentAsk: 'agent:ask',
  agentAskReset: 'agent:ask-reset',
  agentAskEvent: 'agent:ask-event',
  agentCancel: 'agent:cancel',
  agentTextToDiagram: 'agent:text-to-diagram',
  agentTextToDiagramChunk: 'agent:text-to-diagram-chunk',
} as const

/** Commands the application menu sends to the focused window. */
export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'save-as'
  | 'export-image'
  | 'export-png'
  | 'export-svg'
  | 'export-pdf'
  | 'export-pdf-frames'
  | 'export-mermaid'
  | 'copy-png'
  | 'copy-svg'
  | 'copy-mermaid'
  | 'import-mermaid'
  | 'browse-versions'
  | 'ask'
  | 'text-to-diagram'
  | 'settings'

export interface OpenedFile {
  path: string
  contents: string
}

export interface SaveResult {
  path: string
}

// ── Exports ────────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'svg' | 'mermaid'

export interface ExportSaveRequest {
  format: ExportFormat
  /** File name for the Save dialog, e.g. "Board.png". */
  suggestedName: string
  /** PNG bytes, or SVG / Mermaid text. */
  data: Uint8Array | string
}

/** One PDF page: a standalone SVG document and its size in CSS pixels. */
export interface PdfPage {
  svg: string
  width: number
  height: number
}

export interface ExportPdfRequest {
  suggestedName: string
  pages: PdfPage[]
}

// ── Versions ───────────────────────────────────────────────────────────────

/** A past state of a drawing file, kept under userData. */
export interface DrawingVersion {
  id: string
  savedAt: number
  hash: string
  bytes: number
}

// ── Agent ──────────────────────────────────────────────────────────────────

/** Main asks the window to run one canvas tool. */
export interface AgentRequest {
  id: string
  tool: string
  args: unknown
}

/** What a canvas tool returns. Any combination of the fields may be set. */
export interface AgentToolResult {
  text?: string
  json?: unknown
  image?: { mimeType: 'image/png'; base64: string }
}

export type AgentResponse =
  | { id: string; ok: true; result: AgentToolResult }
  | { id: string; ok: false; error: string }

/** Drives the "agent connected / working" badge in the title bar. */
export interface AgentActivity {
  source: 'mcp' | 'ask'
  active: boolean
  /** e.g. the MCP client name, or the tool being run. */
  label?: string
}

/** A model the chosen provider offers, as Settings and the chat's model menu show it. */
export interface ModelInfo {
  id: string
  /** Short display name, such as "Sonnet 5.5". */
  label: string
}

export interface AgentStatus {
  mcp: {
    enabled: boolean
    running: boolean
    port: number
    url: string
    error: string | null
  }
  /** The provider chosen in Settings. */
  provider: Provider
  /** Where each provider's key comes from; null when it has none. */
  keys: Record<Provider, 'env' | 'saved' | null>
  /** True when the chosen provider has a key. */
  keyConfigured: boolean
  model: string
}

export interface AskRequest {
  prompt: string
}

export type AskEvent =
  | { runId: string; type: 'text'; text: string }
  | { runId: string; type: 'tool'; tool: string; summary: string }
  | { runId: string; type: 'done' }
  | { runId: string; type: 'error'; error: string }

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface TextToDiagramChunk {
  runId: string
  chunk: string
}

/** The window's answer when main asks it to save before closing. */
export type FlushResult =
  | { ok: true }
  /** `error` is null when autosave is off, so nothing was saved by design. */
  | { ok: false; error: string | null }

/** A library downloaded from libraries.excalidraw.com, waiting for a window. */
export interface LibraryInstall {
  /** The .excalidrawlib file's text. */
  json: string
  /** The id of the editor that opened "Browse libraries", if the site passed it back. */
  token: string | null
}

// ── Preload surface ────────────────────────────────────────────────────────

export interface TabulaApi {
  openFile(): Promise<OpenedFile | null>
  /** Writes the file, first snapshotting whatever it replaces. */
  saveFile(path: string, contents: string): Promise<SaveResult>
  /** Shows the Save dialog and returns the chosen path; writes nothing. */
  pickSavePath(suggestedName: string): Promise<string | null>
  /** A new, unused path for autosaving a drawing that was never saved. */
  untitledPath(): Promise<string>
  /**
   * Main asks before closing the window: the handler saves what autosave
   * would and resolves once it is on disk.
   */
  onFlushRequest(handler: () => Promise<FlushResult>): () => void
  setDirty(dirty: boolean): void
  setTitle(path: string | null): void
  onMenuCommand(handler: (command: MenuCommand) => void): () => void
  onFileOpened(handler: (file: OpenedFile) => void): () => void
  onFullscreen(handler: (fullscreen: boolean) => void): () => void

  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    onChange(handler: (settings: Settings) => void): () => void
  }

  exports: {
    /** Shows a Save dialog and writes the data; null when cancelled. */
    save(request: ExportSaveRequest): Promise<string | null>
    /** Shows a Save dialog and prints the pages to a vector PDF. */
    savePdf(request: ExportPdfRequest): Promise<string | null>
    copyImage(png: Uint8Array): Promise<void>
    copyText(text: string): Promise<void>
  }

  versions: {
    list(path: string): Promise<DrawingVersion[]>
    read(path: string, id: string): Promise<string>
  }

  /** Excalidraw's library, shared by every window and kept under userData. */
  library: {
    load(): Promise<unknown[] | null>
    save(items: readonly unknown[]): Promise<void>
    /** Another window changed the library. */
    onChanged(handler: (items: unknown[]) => void): () => void
    /** Libraries installed from the browser since the last call. */
    takeInstalls(): Promise<LibraryInstall[]>
    onInstallReady(handler: () => void): () => void
  }

  agent: {
    onRequest(handler: (request: AgentRequest) => void): () => void
    respond(response: AgentResponse): void
    onActivity(handler: (activity: AgentActivity) => void): () => void
    status(): Promise<AgentStatus>
    /** The `claude mcp add …` command, including the connection token. */
    setupCommand(): Promise<string>
    resetToken(): Promise<void>
    /** Encrypts and saves the key for `provider`; null removes it. */
    setKey(provider: Provider, key: string | null): Promise<void>
    /** The models the chosen provider offers; rejects without a key (Anthropic) or offline. */
    models(): Promise<ModelInfo[]>
    ask(request: AskRequest): Promise<{ runId: string }>
    /** Stops any running Ask and forgets this window's chat. */
    resetChat(): Promise<void>
    onAskEvent(handler: (event: AskEvent) => void): () => void
    cancel(runId: string): void
    /** Streams Mermaid for Excalidraw's Text to diagram dialog. */
    textToDiagram(runId: string, messages: LLMMessage[]): Promise<string>
    onTextToDiagramChunk(handler: (chunk: TextToDiagramChunk) => void): () => void
  }
}

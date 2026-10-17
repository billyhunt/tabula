/** Channel names and payload types shared by main, preload and renderer. */
import type { Settings, SettingsPatch } from './settings'

export const Channels = {
  openFile: 'file:open',
  saveFile: 'file:save',
  pickSavePath: 'file:pick-save-path',
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

  agentRequest: 'agent:request',
  agentResponse: 'agent:response',
  agentActivity: 'agent:activity',
  agentStatus: 'agent:status',
  agentSetupCommand: 'agent:setup-command',
  agentResetToken: 'agent:reset-token',
  agentAsk: 'agent:ask',
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

export interface AgentStatus {
  mcp: {
    enabled: boolean
    running: boolean
    port: number
    url: string
    error: string | null
  }
  /** True when an API key source is configured (env var or 1Password ref). */
  keyConfigured: boolean
  keySource: 'env' | '1password' | null
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

// ── Preload surface ────────────────────────────────────────────────────────

export interface TabulaApi {
  openFile(): Promise<OpenedFile | null>
  /** Writes the file, first snapshotting whatever it replaces. */
  saveFile(path: string, contents: string): Promise<SaveResult>
  /** Shows the Save dialog and returns the chosen path; writes nothing. */
  pickSavePath(suggestedName: string): Promise<string | null>
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

  agent: {
    onRequest(handler: (request: AgentRequest) => void): () => void
    respond(response: AgentResponse): void
    onActivity(handler: (activity: AgentActivity) => void): () => void
    status(): Promise<AgentStatus>
    /** The `claude mcp add …` command, including the connection token. */
    setupCommand(): Promise<string>
    resetToken(): Promise<void>
    ask(request: AskRequest): Promise<{ runId: string }>
    onAskEvent(handler: (event: AskEvent) => void): () => void
    cancel(runId: string): void
    /** Streams Mermaid for Excalidraw's Text to diagram dialog. */
    textToDiagram(runId: string, messages: LLMMessage[]): Promise<string>
    onTextToDiagramChunk(handler: (chunk: TextToDiagramChunk) => void): () => void
  }
}

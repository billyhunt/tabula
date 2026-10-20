import { app, type BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { blankState, CANVAS_TOOLS, findCanvasTool, parseToolArgs } from '../../shared/agentTools'
import type { AgentStatus } from '../../shared/ipc'
import { getSettings, onSettingsChanged } from '../settings'
import { createWindow, focusedWindow, hasPendingFile } from '../windows'
import { callCanvasTool, reportActivity } from './bridge'
import { checkMcpRequest } from './mcpChecks'
import { FILE_TOOLS, type BlankWindow, type ToolWindows } from './mcpFileTools'

/**
 * The local MCP server: lets agents such as Claude Code draw on the open
 * canvas. Off until the user turns it on; listens on 127.0.0.1 only and needs
 * a bearer token kept in userData.
 */

const MCP_PATH = '/mcp'
const MAX_BODY_BYTES = 16 * 1024 * 1024

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

// ── Token ──────────────────────────────────────────────────────────────────

const tokenFile = () => path.join(app.getPath('userData'), 'mcp-token')

const writeNewToken = async () => {
  const token = randomBytes(32).toString('base64url')
  await writeFile(tokenFile(), token, { encoding: 'utf8', mode: 0o600 })
  // mode only applies when the file is created; make sure of it on replace.
  await chmod(tokenFile(), 0o600)
  return token
}

const readOrCreateToken = async () => {
  const stored = (await readFile(tokenFile(), 'utf8').catch(() => '')).trim()
  return /^[A-Za-z0-9_-]{43}$/.test(stored) ? stored : writeNewToken()
}

let tokenPromise: Promise<string> | null = null

const loadToken = () => {
  tokenPromise ??= readOrCreateToken().catch((err: unknown) => {
    tokenPromise = null
    throw err
  })
  return tokenPromise
}

// ── Tools ──────────────────────────────────────────────────────────────────

// Parsing through the SDK's own schema checks each one is a valid tool input
// schema (an object schema) and gives it the SDK's type.
const TOOL_LIST: Tool[] = CANVAS_TOOLS.map((spec) => {
  const { $schema: _, ...schema } = z.toJSONSchema(spec.input, { io: 'input' })
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: ToolSchema.shape.inputSchema.parse(schema),
  }
})

const INSTRUCTIONS =
  'Tabula is the user’s whiteboard (an Excalidraw canvas) open on their Mac. Call get_scene ' +
  'before changing existing elements, and screenshot to check your work. Each change is one ' +
  'undo step for the user.'

// The initialize request names the client; later stateless requests don't.
let clientName: string | null = null
const initializeMessage = z.object({
  method: z.literal('initialize'),
  params: z.object({ clientInfo: z.object({ name: z.string().min(1) }) }),
})

let running = 0

/** Waits for a window's editor to come up: it listens for tools only then. */
const editorReady = async (win: BrowserWindow) => {
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      await callCanvasTool(win, 'ping', {}, 1_000)
      return
    } catch (err) {
      if (win.isDestroyed() || Date.now() > deadline) throw err
    }
  }
}

/** The window agents act on; opens one (and waits for its editor) if none. */
const canvasWindow = async (): Promise<BrowserWindow> => {
  const existing = focusedWindow()
  if (existing && !existing.webContents.isLoading()) return existing
  const win = existing ?? createWindow()
  await editorReady(win)
  return win
}

/**
 * A window for a drawing of the agent's own, so the user's open drawing is
 * never replaced: the current window when it holds nothing yet, else a new
 * one (always a new one with `fresh`). It is the most recently focused window
 * afterwards, but later calls follow focus, so it is only the agent's own
 * until the user clicks another window.
 */
const blankWindow = async (options?: { fresh?: boolean }): Promise<BlankWindow> => {
  if (!options?.fresh) {
    const current = await canvasWindow()
    // A window that cannot answer (stuck in a dialog, say) counts as occupied:
    // a new window is safe, replacing what is in it is not.
    const blank =
      !hasPendingFile(current) &&
      (await callCanvasTool(current, 'isBlank', {}, 5_000).then(
        ({ json }) => blankState.parse(json).blank,
        () => false,
      ))
    if (blank) return { win: current, created: false }
  }
  const win = createWindow()
  try {
    await editorReady(win)
  } catch (err) {
    if (!win.isDestroyed()) win.close()
    throw err
  }
  return { win, created: true }
}

const WINDOWS: ToolWindows = { current: canvasWindow, blank: blankWindow }

const callTool = async (name: string, args: unknown): Promise<CallToolResult> => {
  const spec = findCanvasTool(name)
  if (!spec) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true }
  running += 1
  reportActivity({ source: 'mcp', active: true, label: clientName ?? name })
  try {
    const fileTool = FILE_TOOLS[name]
    const result = fileTool
      ? await fileTool(args, WINDOWS)
      : await callCanvasTool(await canvasWindow(), name, parseToolArgs(name, spec.input, args))
    const content: CallToolResult['content'] = []
    if (result.text) content.push({ type: 'text', text: result.text })
    if (result.json !== undefined) content.push({ type: 'text', text: JSON.stringify(result.json) })
    if (result.image) {
      content.push({ type: 'image', data: result.image.base64, mimeType: result.image.mimeType })
    }
    return { content }
  } catch (err) {
    return { content: [{ type: 'text', text: errorMessage(err) }], isError: true }
  } finally {
    running -= 1
    if (running === 0) reportActivity({ source: 'mcp', active: false, label: clientName ?? name })
  }
}

// ── HTTP ───────────────────────────────────────────────────────────────────

const replyError = (
  res: ServerResponse,
  status: number,
  message: string,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const handleRequest = async (req: IncomingMessage, res: ServerResponse, port: number) => {
  const check = checkMcpRequest(req.headers, port, await loadToken())
  if (!check.ok) {
    const headers: Record<string, string> = check.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}
    return replyError(res, check.status, check.message, headers)
  }
  if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== MCP_PATH) {
    return replyError(res, 404, `The MCP endpoint is ${MCP_PATH}`)
  }
  // Stateless: no sessions, so no server-sent stream to GET or session to DELETE.
  if (req.method !== 'POST') return replyError(res, 405, 'Method not allowed', { Allow: 'POST' })

  let body: unknown
  try {
    body = await readJson(req)
  } catch (err) {
    return replyError(res, 400, `Invalid request body: ${errorMessage(err)}`)
  }
  const initialize = initializeMessage.safeParse(body)
  if (initialize.success) clientName = initialize.data.params.clientInfo.name

  // Stateless mode needs a fresh server and transport per request. The
  // low-level Server (not McpServer) leaves argument validation to us, so
  // agents get the same one-sentence errors as in the chat.
  const server = new Server(
    { name: 'tabula', version: app.getVersion() },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  )
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOL_LIST }))
  server.setRequestHandler(CallToolRequestSchema, (request) =>
    callTool(request.params.name, request.params.arguments),
  )
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

// ── Controller ─────────────────────────────────────────────────────────────

let httpServer: HttpServer | null = null
let listeningPort: number | null = null
let lastError: string | null = null
let queue: Promise<void> = Promise.resolve()

/** Runs server changes one at a time; a failed step doesn't block later ones. */
const serialized = (step: () => Promise<void>) => {
  const run = queue.then(step)
  queue = run.catch(() => {})
  return run
}

const stopServer = async () => {
  const server = httpServer
  if (!server) return
  httpServer = null
  listeningPort = null
  const { promise, resolve } = Promise.withResolvers<void>()
  server.close(() => resolve())
  server.closeAllConnections()
  await promise
}

/** Starts listening; failures (such as a busy port) end up in `lastError`. */
const startServer = async (port: number) => {
  const server = createServer((req, res) => {
    handleRequest(req, res, port).catch((err: unknown) => {
      if (!res.headersSent) replyError(res, 500, errorMessage(err))
      else res.end()
    })
  })
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  server.once('error', reject)
  server.listen(port, '127.0.0.1', () => resolve())
  try {
    await promise
    await loadToken()
  } catch (err) {
    server.close()
    const busy = err instanceof Error && 'code' in err && err.code === 'EADDRINUSE'
    lastError = busy
      ? `Port ${port} is already in use; choose another port`
      : `Couldn't start the MCP server: ${errorMessage(err)}`
    return
  }
  server.off('error', reject)
  server.on('error', (err) => console.error('MCP server error:', err))
  httpServer = server
  listeningPort = port
  lastError = null
}

/** Brings the server in line with the settings. */
const reconcile = () =>
  serialized(async () => {
    const { mcpEnabled, mcpPort } = getSettings().agent
    const wanted = mcpEnabled ? mcpPort : null
    if (wanted !== null && wanted === listeningPort) return
    await stopServer()
    lastError = null
    if (wanted !== null) await startServer(wanted)
  })

/** Starts the server if enabled and follows the settings from then on. */
export const startMcpController = () => {
  void reconcile()
  onSettingsChanged(() => void reconcile())
}

export const mcpStatus = (): AgentStatus['mcp'] => {
  const { mcpEnabled, mcpPort } = getSettings().agent
  return {
    enabled: mcpEnabled,
    running: listeningPort !== null,
    port: mcpPort,
    url: `http://127.0.0.1:${mcpPort}${MCP_PATH}`,
    error: lastError,
  }
}

/** The command that registers Tabula with Claude Code, token included. */
export const mcpSetupCommand = async (): Promise<string> => {
  const token = await loadToken()
  const { url } = mcpStatus()
  return `claude mcp add --transport http tabula ${url} --header "Authorization: Bearer ${token}"`
}

/** Replaces the token, dropping every client connected with the old one. */
export const resetMcpToken = (): Promise<void> =>
  serialized(async () => {
    tokenPromise = writeNewToken()
    await tokenPromise
    if (listeningPort === null) return
    const port = listeningPort
    await stopServer()
    await startServer(port)
  })

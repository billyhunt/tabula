import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import {
  Channels,
  type AgentActivity,
  type AgentResponse,
  type AgentToolResult,
} from '../../shared/ipc'

/**
 * Runs canvas tools inside a window. The scene lives in the renderer, so
 * both the MCP server and the Ask bar reach it through here.
 */

interface Pending {
  resolve: (result: AgentToolResult) => void
  reject: (error: Error) => void
  win: BrowserWindow
  /** Clears the timeout and the window-closed listener. */
  settle: () => void
}

const pending = new Map<string, Pending>()
let listening = false

const listen = () => {
  if (listening) return
  listening = true
  ipcMain.on(Channels.agentResponse, (event, response: AgentResponse) => {
    const entry = pending.get(response.id)
    // Only the window that was asked may answer.
    if (!entry || entry.win.webContents !== event.sender) return
    pending.delete(response.id)
    entry.settle()
    if (response.ok) entry.resolve(response.result)
    else entry.reject(new Error(response.error))
  })
}

export const callCanvasTool = (
  win: BrowserWindow,
  tool: string,
  args: unknown,
  timeoutMs = 30_000,
): Promise<AgentToolResult> => {
  listen()
  if (win.isDestroyed()) return Promise.reject(new Error('The Tabula window is closed'))
  const id = randomUUID()
  const { promise, resolve, reject } = Promise.withResolvers<AgentToolResult>()
  const fail = (message: string) => {
    if (!pending.delete(id)) return
    settle()
    reject(new Error(message))
  }
  const timer = setTimeout(
    () => fail(`Canvas tool ${tool} timed out after ${timeoutMs / 1000}s`),
    timeoutMs,
  )
  const onClosed = () => fail('The Tabula window closed')
  const settle = () => {
    clearTimeout(timer)
    win.off('closed', onClosed)
  }
  win.once('closed', onClosed)
  pending.set(id, { resolve, reject, win, settle })
  win.webContents.send(Channels.agentRequest, { id, tool, args })
  return promise
}

/** Tells every window an agent started or stopped working. */
export const reportActivity = (activity: AgentActivity) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.agentActivity, activity)
  }
}

import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { z } from 'zod'
import { Channels, type AgentStatus, type AskEvent } from '../../shared/ipc'
import { getSettings } from '../settings'
import { anthropicClient, describeError, isAbort, keyStatus } from './anthropic'
import { runAsk } from './ask'
import { mcpSetupCommand, mcpStatus, resetMcpToken } from './mcp'
import { streamMermaid } from './textToDiagram'

const AskRequestSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) })
const RunIdSchema = z.uuid()
const MessagesSchema = z
  .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(40_000) }))
  .min(1)
  .max(20)

interface Run {
  controller: AbortController
  sender: WebContents
  /** Aborts the run if its window goes away first. */
  onDestroyed: () => void
}

// Ask runs and Text to diagram streams, so agentCancel stops either.
const runs = new Map<string, Run>()
// The Ask run each window has going; one at a time per window.
const activeAsk = new Map<WebContents, string>()

const startRun = (runId: string, sender: WebContents): AbortController => {
  const controller = new AbortController()
  // A closed window can't see the answer; stop paying for it.
  const onDestroyed = () => controller.abort()
  sender.once('destroyed', onDestroyed)
  runs.set(runId, { controller, sender, onDestroyed })
  return controller
}

const endRun = (runId: string) => {
  const run = runs.get(runId)
  if (!run) return
  runs.delete(runId)
  run.sender.off('destroyed', run.onDestroyed)
}

export const registerAgentIpc = () => {
  ipcMain.handle(
    Channels.agentStatus,
    (): AgentStatus => ({ mcp: mcpStatus(), ...keyStatus(), model: getSettings().agent.model }),
  )
  ipcMain.handle(Channels.agentSetupCommand, () => mcpSetupCommand())
  ipcMain.handle(Channels.agentResetToken, () => resetMcpToken())

  ipcMain.handle(Channels.agentAsk, (event, request: unknown) => {
    const { prompt } = AskRequestSchema.parse(request)
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)
    if (!win) throw new Error('Ask needs a Tabula window')

    // A new question replaces the one still running in this window.
    const previous = activeAsk.get(sender)
    if (previous) runs.get(previous)?.controller.abort()

    const runId = randomUUID()
    const { signal } = startRun(runId, sender)
    activeAsk.set(sender, runId)
    const send = (event: AskEvent) => {
      if (!sender.isDestroyed()) sender.send(Channels.agentAskEvent, event)
    }
    void runAsk(win, prompt, signal, (update) => send({ ...update, runId })).finally(() => {
      endRun(runId)
      if (activeAsk.get(sender) === runId) activeAsk.delete(sender)
    })
    return { runId }
  })

  ipcMain.on(Channels.agentCancel, (event, runId: unknown) => {
    const parsed = RunIdSchema.safeParse(runId)
    if (!parsed.success) return
    const run = runs.get(parsed.data)
    // Only the window that started a run may stop it.
    if (run?.sender === event.sender) run.controller.abort()
  })

  ipcMain.handle(
    Channels.agentTextToDiagram,
    async (event, runId: unknown, messages: unknown): Promise<string> => {
      const id = RunIdSchema.parse(runId)
      const conversation = MessagesSchema.parse(messages)
      if (runs.has(id)) throw new Error('That Text to diagram run is already going')
      const sender = event.sender
      const { signal } = startRun(id, sender)
      try {
        const client = await anthropicClient()
        return await streamMermaid(
          client,
          getSettings().agent.model,
          conversation,
          signal,
          (chunk) => {
            if (!sender.isDestroyed()) {
              sender.send(Channels.agentTextToDiagramChunk, { runId: id, chunk })
            }
          },
        )
      } catch (err) {
        // ipcRenderer.invoke only carries the message across.
        throw new Error(isAbort(err) || signal.aborted ? 'Aborted' : describeError(err))
      } finally {
        endRun(id)
      }
    },
  )
}

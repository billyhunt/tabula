import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { z } from 'zod'
import { Channels, type AgentStatus, type AskEvent } from '../../shared/ipc'
import { keyProblem, PROVIDERS } from '../../shared/providers'
import { activeModel } from '../../shared/settings'
import { getSettings } from '../settings'
import { anthropicClient, describeError, isAbort, keyStatus, listModels } from './anthropic'
import { resetChat, runAsk } from './ask'
import { saveKey } from './keyStore'
import { mcpSetupCommand, mcpStatus, resetMcpToken } from './mcp'
import { streamMermaid } from './textToDiagram'

const AskRequestSchema = z.object({ prompt: z.string().trim().min(1).max(20_000) })
const RunIdSchema = z.uuid()
const ProviderSchema = z.enum(PROVIDERS)
const KeySchema = z.string().trim().min(1).max(1000).nullable()
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
    (): AgentStatus => ({
      mcp: mcpStatus(),
      ...keyStatus(),
      model: activeModel(getSettings().agent),
    }),
  )
  ipcMain.handle(Channels.agentSetupCommand, () => mcpSetupCommand())
  ipcMain.handle(Channels.agentResetToken, () => resetMcpToken())
  ipcMain.handle(Channels.agentSetKey, async (_event, provider: unknown, key: unknown) => {
    const parsedProvider = ProviderSchema.parse(provider)
    const parsedKey = KeySchema.parse(key)
    // The dialog checks too; this keeps a bad key out of storage regardless.
    const problem = parsedKey === null ? null : keyProblem(parsedProvider, parsedKey)
    if (problem) throw new Error(problem)
    await saveKey(parsedProvider, parsedKey)
  })

  ipcMain.handle(Channels.agentModels, async () => {
    try {
      return await listModels()
    } catch (err) {
      // invoke only carries the message; make it the readable one.
      throw new Error(describeError(err))
    }
  })

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

  ipcMain.handle(Channels.agentAskReset, (event) => {
    const running = activeAsk.get(event.sender)
    if (running) runs.get(running)?.controller.abort()
    resetChat(event.sender)
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
        const client = anthropicClient()
        return await streamMermaid(
          client,
          activeModel(getSettings().agent),
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

import { TTDDialog, type SavedChats, type TTDPersistenceAdapter } from '@excalidraw/excalidraw'
import type { TTTDDialog } from '@excalidraw/excalidraw/components/TTDDialog/types'
import type { RequestError } from '@excalidraw/excalidraw/errors'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { z } from 'zod'
import { useMenuCommand } from '../menuCommands'
import { remoteErrorMessage } from './remoteError'

const STORAGE_KEY = 'tabula.textToDiagram.chats'

const ChatMessageSchema = z.object({
  id: z.string(),
  // JSON turns the Date into a string; revive it.
  timestamp: z.coerce.date(),
  isGenerating: z.boolean().optional(),
  error: z.string().optional(),
  errorDetails: z.string().optional(),
  errorType: z.enum(['parse', 'network', 'other']).optional(),
  lastAttemptAt: z.number().optional(),
  type: z.enum(['user', 'assistant', 'warning']),
  warningType: z.enum(['messageLimitExceeded', 'rateLimitExceeded']).optional(),
  content: z.string().optional(),
})

const SavedChatsSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    messages: z.array(ChatMessageSchema),
    currentPrompt: z.string(),
    timestamp: z.number(),
  }),
)

/** The dialog's chat history, kept in this window's localStorage. */
const persistenceAdapter: TTDPersistenceAdapter = {
  loadChats: async (): Promise<SavedChats> => {
    try {
      const parsed = SavedChatsSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'))
      return parsed.success ? parsed.data : []
    } catch {
      return []
    }
  },
  saveChats: async (chats) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats))
  },
}

/** Streams Mermaid from Claude in main; chunks arrive tagged with our runId. */
const onTextSubmit: TTTDDialog.onTextSubmit = async ({
  messages,
  onChunk,
  onStreamCreated,
  signal,
}) => {
  const runId = crypto.randomUUID()
  const stopListening = window.tabula.agent.onTextToDiagramChunk((chunk) => {
    if (chunk.runId === runId) onChunk?.(chunk.chunk)
  })
  const cancel = () => window.tabula.agent.cancel(runId)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    onStreamCreated?.()
    const generatedResponse = await window.tabula.agent.textToDiagram(runId, messages)
    return { generatedResponse, error: null }
  } catch (err) {
    // Excalidraw's RequestError class isn't exported at runtime, so build an
    // Error of the same shape; the dialog reads its name, message and status.
    const message = remoteErrorMessage(err)
    const error: RequestError = Object.assign(new Error(message), {
      status: 500,
      data: null,
      toObject: () => ({ name: 'RequestError', status: 500, message }),
    })
    return { error }
  } finally {
    stopListening()
    signal?.removeEventListener('abort', cancel)
  }
}

/**
 * Excalidraw's Text to diagram dialog, answered by Claude. Its Mermaid tab is
 * also how Import Mermaid works, so it must always be rendered.
 */
export const TextToDiagram = ({ api }: { api: ExcalidrawImperativeAPI | null }) => {
  useMenuCommand('text-to-diagram', () =>
    api?.updateScene({ appState: { openDialog: { name: 'ttd', tab: 'text-to-diagram' } } }),
  )
  return <TTDDialog onTextSubmit={onTextSubmit} persistenceAdapter={persistenceAdapter} />
}

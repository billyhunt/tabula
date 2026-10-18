import type Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow, WebContents } from 'electron'
import { CANVAS_TOOLS } from '../../shared/agentTools'
import type { AskEvent } from '../../shared/ipc'
import { activeModel } from '../../shared/settings'
import { getSettings } from '../settings'
import { anthropicClient, describeError, isAbort } from './anthropic'
import {
  compactHistory,
  humanizeTool,
  runAskLoop,
  toolDefinitions,
  type ModelTurn,
} from './askLoop'
import { callCanvasTool, reportActivity } from './bridge'

type WithoutRunId<E> = E extends AskEvent ? Omit<E, 'runId'> : never
/** An AskEvent before the caller stamps it with its run. */
export type AskUpdate = WithoutRunId<AskEvent>

const SYSTEM_PROMPT = `You are Tabula's drawing assistant, in a chat panel beside the Excalidraw board the user has open. You work directly on the board, using the canvas tools.

How to work:
- The user can change the board between messages. Call get_scene at the start of every request to see what is on it now and what is selected; don't rely on an earlier read.
- If elements are selected, the request is about the selection ("tidy this", "turn these notes into a flowchart"): act on those elements and leave the rest alone.
- Earlier messages in the chat are context: "make it bigger" or "undo that colour" refers to what you did or discussed before.
- For flowcharts, sequence, class, ER and state diagrams, prefer import_mermaid. Use add_elements for freeform layouts, sketches and anything Mermaid can't express.
- Leave clear space between shapes (gaps of at least 60px) and keep labels short.
- Use the Alethia palette: ink #1e1e1e for strokes and text, hot orange #ff3b00 only for emphasis, and transparent or paper (#f2f0eb) fills.
- Never delete or rewrite things the user didn't ask you to remove or change.
- When layout matters, call screenshot to check the result and fix overlaps before finishing.
- If the request is a question about the board, answer it without changing anything.
- After a change, finish with one or two short sentences saying what changed. No lists or headings.`

// Past runs replayed to the model, roughly 50k tokens; older ones drop off.
const MAX_HISTORY_CHARS = 200_000

interface Chat {
  /** Finished runs, oldest first; each opens with a prompt and ends with a reply. */
  runs: Anthropic.MessageParam[][]
}

// One chat per window, gone with the window.
const chats = new WeakMap<WebContents, Chat>()

/** Starts the window's next Ask on a clean slate. */
export const resetChat = (sender: WebContents) => {
  chats.set(sender, { runs: [] })
}

const streamTurn =
  (client: Anthropic): ModelTurn =>
  async (params, signal, onText) => {
    const stream = client.messages.stream(params, { signal })
    stream.on('text', onText)
    return stream.finalMessage()
  }

/**
 * Runs one Ask in `win`: Claude drives the window's canvas tools until it is
 * done, seeing the window's earlier exchanges. Always finishes with exactly
 * one 'done' or 'error' event, and adds the run to the chat either way.
 */
export const runAsk = async (
  win: BrowserWindow,
  prompt: string,
  signal: AbortSignal,
  emit: (update: AskUpdate) => void,
): Promise<void> => {
  const sender = win.webContents
  const chat = chats.get(sender) ?? { runs: [] }
  chats.set(sender, chat)
  let run: Anthropic.MessageParam[] = []
  reportActivity({ source: 'ask', active: true, label: 'Thinking' })
  try {
    const client = anthropicClient()
    await runAskLoop({
      prompt,
      history: chat.runs.flat(),
      model: activeModel(getSettings().agent),
      system: SYSTEM_PROMPT,
      tools: toolDefinitions(CANVAS_TOOLS),
      turn: streamTurn(client),
      runTool: (name, input) => callCanvasTool(win, name, input),
      onText: (text) => emit({ type: 'text', text }),
      onToolStart: (name) => reportActivity({ source: 'ask', active: true, label: humanizeTool(name) }),
      onTool: (tool, summary) => emit({ type: 'tool', tool, summary }),
      onCommit: (messages) => {
        run = messages
      },
      signal,
    })
    emit({ type: 'done' })
  } catch (err) {
    const stopped = isAbort(err) || signal.aborted
    const error = stopped ? 'Stopped.' : describeError(err)
    emit({ type: 'error', error })
    // The next prompt has to follow a reply; this one says how the run ended.
    if (run.at(-1)?.role === 'user') {
      const note = stopped ? '(Stopped by the user.)' : `(This request failed: ${error})`
      run = [...run, { role: 'assistant', content: note }]
    }
  } finally {
    reportActivity({ source: 'ask', active: false })
    // A reset while this ran started a new chat; this run belongs to the old one.
    if (run.length && chats.get(sender) === chat) {
      chat.runs = compactHistory([...chat.runs, run], MAX_HISTORY_CHARS)
    }
  }
}

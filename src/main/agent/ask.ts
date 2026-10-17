import type Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import { CANVAS_TOOLS } from '../../shared/agentTools'
import type { AskEvent } from '../../shared/ipc'
import { getSettings } from '../settings'
import { anthropicClient, describeError, isAbort } from './anthropic'
import { humanizeTool, runAskLoop, toolDefinitions, type ModelTurn } from './askLoop'
import { callCanvasTool, reportActivity } from './bridge'

type WithoutRunId<E> = E extends AskEvent ? Omit<E, 'runId'> : never
/** An AskEvent before the caller stamps it with its run. */
export type AskUpdate = WithoutRunId<AskEvent>

const SYSTEM_PROMPT = `You are Tabula's drawing assistant. You work directly on the Excalidraw board the user has open, using the canvas tools.

How to work:
- Always call get_scene first to see what is on the board and what is selected.
- If elements are selected, the request is about the selection ("tidy this", "turn these notes into a flowchart"): act on those elements and leave the rest alone.
- For flowcharts, sequence, class, ER and state diagrams, prefer import_mermaid. Use add_elements for freeform layouts, sketches and anything Mermaid can't express.
- Leave clear space between shapes (gaps of at least 60px) and keep labels short.
- Use the Alethia palette: ink #1e1e1e for strokes and text, hot orange #ff3b00 only for emphasis, and transparent or paper (#f2f0eb) fills.
- Never delete or rewrite things the user didn't ask you to remove or change.
- When layout matters, call screenshot to check the result and fix overlaps before finishing.
- Finish with one or two short sentences saying what changed. No lists or headings.`

const streamTurn =
  (client: Anthropic): ModelTurn =>
  async (params, signal, onText) => {
    const stream = client.messages.stream(params, { signal })
    stream.on('text', onText)
    return stream.finalMessage()
  }

/**
 * Runs one Ask in `win`: Claude drives the window's canvas tools until it is
 * done. Always finishes with exactly one 'done' or 'error' event.
 */
export const runAsk = async (
  win: BrowserWindow,
  prompt: string,
  signal: AbortSignal,
  emit: (update: AskUpdate) => void,
): Promise<void> => {
  reportActivity({ source: 'ask', active: true, label: 'Thinking' })
  try {
    const client = await anthropicClient()
    await runAskLoop({
      prompt,
      model: getSettings().agent.model,
      system: SYSTEM_PROMPT,
      tools: toolDefinitions(CANVAS_TOOLS),
      turn: streamTurn(client),
      runTool: (name, input) => callCanvasTool(win, name, input),
      onText: (text) => emit({ type: 'text', text }),
      onToolStart: (name) => reportActivity({ source: 'ask', active: true, label: humanizeTool(name) }),
      onTool: (tool, summary) => emit({ type: 'tool', tool, summary }),
      signal,
    })
    emit({ type: 'done' })
  } catch (err) {
    emit({ type: 'error', error: isAbort(err) || signal.aborted ? 'Stopped.' : describeError(err) })
  } finally {
    reportActivity({ source: 'ask', active: false })
  }
}

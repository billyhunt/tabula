/**
 * The Ask bar's tool loop, free of Electron so it can run against a fake
 * model and fake canvas in tests. src/main/agent/ask.ts wires it to the
 * Anthropic SDK and the window's canvas tools.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { CanvasToolSpec } from '../../shared/agentTools'
import type { AgentToolResult } from '../../shared/ipc'

export const MAX_TURNS = 16

export interface ModelReply {
  content: Anthropic.ContentBlock[]
  stop_reason: Anthropic.StopReason | null
}

/** One streamed model response; text deltas go to `onText` as they arrive. */
export type ModelTurn = (
  params: Anthropic.MessageStreamParams,
  signal: AbortSignal,
  onText: (delta: string) => void,
) => Promise<ModelReply>

export interface AskLoopOptions {
  prompt: string
  model: string
  system: string
  tools: Anthropic.Tool[]
  turn: ModelTurn
  runTool: (name: string, input: unknown) => Promise<AgentToolResult>
  onText: (delta: string) => void
  onToolStart: (name: string) => void
  onTool: (name: string, summary: string) => void
  signal: AbortSignal
  maxTurns?: number
}

export class TurnLimitError extends Error {
  override name = 'TurnLimitError'
}

/** The tools Claude in the app may use, in the Messages API's shape. */
export const toolDefinitions = (specs: readonly CanvasToolSpec[]): Anthropic.Tool[] =>
  specs
    .filter((spec) => spec.availability === 'all')
    .map((spec) => {
      // Input mode: fields with defaults stay optional for the model.
      const schema = z.toJSONSchema(spec.input, { io: 'input' })
      delete schema.$schema
      return {
        name: spec.name,
        description: spec.description,
        input_schema: { ...schema, type: 'object' },
      }
    })

/** "add_elements" → "Add elements", for steps whose tool gave no summary. */
export const humanizeTool = (name: string) => {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Canvas tools lead their text with a one-line, past-tense summary. */
export const summarizeTool = (name: string, result: AgentToolResult) => {
  const first = result.text?.trim().split('\n', 1)[0]?.trim()
  return first && first.length <= 80 ? first : humanizeTool(name)
}

export const toolResultContent = (
  result: AgentToolResult,
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> => {
  const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = []
  if (result.text) content.push({ type: 'text', text: result.text })
  if (result.json !== undefined) content.push({ type: 'text', text: JSON.stringify(result.json) })
  if (result.image) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: result.image.mimeType, data: result.image.base64 },
    })
  }
  // The API rejects an empty tool_result list; say it worked.
  if (!content.length) content.push({ type: 'text', text: 'Done.' })
  return content
}

/**
 * Runs model turns until Claude stops asking for tools. Tool calls run one at
 * a time, in order: each may depend on the scene the previous one left.
 * Throws the abort reason when cancelled and TurnLimitError past the cap.
 */
export const runAskLoop = async (options: AskLoopOptions): Promise<void> => {
  const { signal, maxTurns = MAX_TURNS } = options
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: options.prompt }]

  for (let turn = 0; turn < maxTurns; turn++) {
    signal.throwIfAborted()
    const response = await options.turn(
      {
        model: options.model,
        max_tokens: 16_000,
        // A breakpoint after the system prompt caches tools + system across
        // runs; the top-level one caches the growing conversation per turn.
        system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
        tools: options.tools,
        messages,
        cache_control: { type: 'ephemeral' },
      },
      signal,
      options.onText,
    )
    messages.push({ role: 'assistant', content: response.content })

    const calls = response.content.filter((block) => block.type === 'tool_use')
    if (response.stop_reason !== 'tool_use' || !calls.length) return

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const call of calls) {
      signal.throwIfAborted()
      options.onToolStart(call.name)
      try {
        const result = await options.runTool(call.name, call.input)
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: toolResultContent(result),
        })
        options.onTool(call.name, summarizeTool(call.name, result))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.push({ type: 'tool_result', tool_use_id: call.id, content: message, is_error: true })
        options.onTool(call.name, `${humanizeTool(call.name)} failed: ${message}`)
      }
    }
    messages.push({ role: 'user', content: results })
  }
  throw new TurnLimitError(
    `Stopped after ${maxTurns} steps without finishing. Ask again to carry on from here.`,
  )
}

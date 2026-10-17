import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  TurnLimitError,
  runAskLoop,
  toolDefinitions,
  type AskLoopOptions,
  type ModelReply,
  type ModelTurn,
} from '../src/main/agent/askLoop'
import { fenceFilter } from '../src/main/agent/textToDiagram'
import type { AgentToolResult } from '../src/shared/ipc'

const text = (t: string): Anthropic.TextBlock => ({ type: 'text', text: t, citations: null })

const toolUse = (id: string, name: string, input: unknown): Anthropic.ToolUseBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
  caller: { type: 'direct' },
})

/** A model that plays back canned replies and records what it was sent. */
const scripted = (replies: ModelReply[]) => {
  const seen: Anthropic.MessageParam[][] = []
  const turn: ModelTurn = async (params, _signal, onText) => {
    // The loop mutates its history; keep what this turn saw.
    seen.push(structuredClone(params.messages))
    const reply = replies.shift()
    if (!reply) throw new Error('model called more often than scripted')
    for (const block of reply.content) if (block.type === 'text') onText(block.text)
    return reply
  }
  return { turn, seen }
}

const options = (overrides: Partial<AskLoopOptions>): AskLoopOptions => ({
  prompt: 'Draw a box',
  model: 'claude-test',
  system: 'system',
  tools: [],
  turn: scripted([{ content: [text('Hi.')], stop_reason: 'end_turn' }]).turn,
  runTool: async () => ({ text: 'ok' }),
  onText: () => {},
  onToolStart: () => {},
  onTool: () => {},
  signal: new AbortController().signal,
  ...overrides,
})

describe('runAskLoop', () => {
  it('feeds tool results, including screenshots, back to the model', async () => {
    const screenshot: AgentToolResult = {
      text: 'Took a screenshot',
      image: { mimeType: 'image/png', base64: 'iVBORw0K' },
    }
    const { turn, seen } = scripted([
      {
        content: [text('Looking.'), toolUse('t1', 'get_scene', {}), toolUse('t2', 'screenshot', {})],
        stop_reason: 'tool_use',
      },
      { content: [text('Added a box.')], stop_reason: 'end_turn' },
    ])
    const runTool = vi.fn(async (name: string) =>
      name === 'get_scene' ? { text: 'Read the scene', json: { elements: [] } } : screenshot,
    )
    const onTool = vi.fn()
    const deltas: string[] = []

    await runAskLoop(options({ turn, runTool, onTool, onText: (d) => deltas.push(d) }))

    expect(runTool.mock.calls.map((c) => c[0])).toEqual(['get_scene', 'screenshot'])
    expect(onTool.mock.calls).toEqual([
      ['get_scene', 'Read the scene'],
      ['screenshot', 'Took a screenshot'],
    ])
    expect(deltas.join('')).toBe('Looking.Added a box.')

    const second = seen[1]
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(second[2].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 't1',
        content: [
          { type: 'text', text: 'Read the scene' },
          { type: 'text', text: '{"elements":[]}' },
        ],
      },
      {
        type: 'tool_result',
        tool_use_id: 't2',
        content: [
          { type: 'text', text: 'Took a screenshot' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } },
        ],
      },
    ])
  })

  it('reports a failing tool to the model as an error result and carries on', async () => {
    const { turn, seen } = scripted([
      { content: [toolUse('t1', 'add_elements', { bad: true })], stop_reason: 'tool_use' },
      { content: [text('Sorry.')], stop_reason: 'end_turn' },
    ])
    const onTool = vi.fn()
    await runAskLoop(
      options({
        turn,
        onTool,
        runTool: async () => {
          throw new Error('elements must be an array')
        },
      }),
    )
    expect(seen[1][2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: 'elements must be an array', is_error: true },
    ])
    expect(onTool).toHaveBeenCalledWith('add_elements', 'Add elements failed: elements must be an array')
  })

  it('stops at the turn cap', async () => {
    const turn = vi.fn<ModelTurn>(async () => ({
      content: [toolUse('t', 'get_scene', {})],
      stop_reason: 'tool_use',
    }))
    await expect(runAskLoop(options({ turn, maxTurns: 3 }))).rejects.toBeInstanceOf(TurnLimitError)
    expect(turn).toHaveBeenCalledTimes(3)
  })

  it('stops before the next tool once cancelled', async () => {
    const controller = new AbortController()
    const { turn } = scripted([
      {
        content: [toolUse('t1', 'add_elements', {}), toolUse('t2', 'add_elements', {})],
        stop_reason: 'tool_use',
      },
    ])
    const runTool = vi.fn(async () => {
      controller.abort()
      return { text: 'Added 1 element' }
    })
    await expect(
      runAskLoop(options({ turn, runTool, signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(runTool).toHaveBeenCalledTimes(1)
  })
})

describe('toolDefinitions', () => {
  it('offers only in-app tools, as input JSON schemas', () => {
    const tools = toolDefinitions([
      {
        name: 'zoom_to_fit',
        description: 'Zoom',
        input: z.strictObject({ padding: z.number().default(40) }),
        availability: 'all',
      },
      { name: 'open_file', description: 'Open', input: z.strictObject({}), availability: 'mcp' },
    ])
    expect(tools.map((t) => t.name)).toEqual(['zoom_to_fit'])
    const schema = tools[0].input_schema
    expect(schema.type).toBe('object')
    expect(schema).not.toHaveProperty('$schema')
    // A field with a default is optional for the model.
    expect(schema.required ?? []).not.toContain('padding')
  })
})

describe('fenceFilter', () => {
  const run = (chunks: string[]) => {
    const filter = fenceFilter()
    return chunks.map((c) => filter.push(c)).join('') + filter.end()
  }

  it('passes bare Mermaid through unchanged, however it is chunked', () => {
    const mermaid = 'flowchart TD\n  A[Start] --> B[End]'
    expect(run([mermaid])).toBe(mermaid)
    expect(run(mermaid.split(''))).toBe(mermaid)
  })

  it('drops a code fence and any prose after it, even split across chunks', () => {
    expect(run(['``', '`mer', 'maid\nflowchart TD\n  A --> B\n`', '``\nHope this helps!'])).toBe(
      'flowchart TD\n  A --> B\n',
    )
  })
})

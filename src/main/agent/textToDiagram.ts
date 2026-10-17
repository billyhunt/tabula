import type Anthropic from '@anthropic-ai/sdk'
import type { LLMMessage } from '../../shared/ipc'

const SYSTEM_PROMPT = `You turn descriptions into Mermaid diagrams for Excalidraw.
Reply with only a Mermaid definition: no code fences, no prose, no comments.
Prefer flowchart (flowchart TD or LR) unless the request is clearly a sequence, class, ER or state diagram.
Keep node labels short. If the conversation already has a diagram, return the full updated definition.`

/**
 * Drops a Markdown code fence from streamed text. The dialog previews the
 * streamed chunks themselves, so fences have to go before they are sent, not
 * just from the final answer. An opening ```lang line is skipped, and
 * everything from a closing ``` line on is dropped, prose included.
 */
export const fenceFilter = () => {
  let pending = ''
  let started = false
  let closed = false

  const emitLines = (text: string) => {
    let out = ''
    for (const line of text.split(/(?<=\n)/)) {
      if (line.trim() === '```') {
        closed = true
        break
      }
      out += line
    }
    return out
  }

  return {
    push(chunk: string): string {
      if (closed) return ''
      pending += chunk
      if (!started) {
        const head = pending.trimStart()
        // Still could be the start of a fence: wait for more.
        if (head.length < 3 && '```'.startsWith(head)) return ''
        if (head.startsWith('```')) {
          const newline = head.indexOf('\n')
          if (newline < 0) return ''
          pending = head.slice(newline + 1)
        }
        started = true
      }
      // Hold back the unfinished last line: it may turn out to be a fence.
      const lastBreak = pending.lastIndexOf('\n')
      if (lastBreak < 0) return ''
      const complete = pending.slice(0, lastBreak + 1)
      pending = pending.slice(lastBreak + 1)
      return emitLines(complete)
    },
    end(): string {
      if (closed) return ''
      const rest = started || !pending.trimStart().startsWith('```') ? pending : ''
      pending = ''
      return emitLines(rest)
    },
  }
}

/**
 * Streams a Mermaid-only answer for Excalidraw's Text to diagram dialog and
 * returns the whole definition, exactly as streamed, once the model is done.
 */
export const streamMermaid = async (
  client: Anthropic,
  model: string,
  messages: LLMMessage[],
  signal: AbortSignal,
  onChunk: (chunk: string) => void,
): Promise<string> => {
  // The dialog sends its recent history, which can open on an assistant turn
  // or hold empty failed answers; the API wants a user turn first.
  const turns = messages.filter((m) => m.content.trim())
  while (turns[0]?.role === 'assistant') turns.shift()
  const stream = client.messages.stream(
    {
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: turns,
    },
    { signal },
  )
  const filter = fenceFilter()
  let text = ''
  const send = (chunk: string) => {
    if (!chunk) return
    text += chunk
    onChunk(chunk)
  }
  stream.on('text', (delta) => send(filter.push(delta)))
  await stream.finalMessage()
  send(filter.end())
  return text
}

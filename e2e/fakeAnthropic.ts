/**
 * A stand-in for the Anthropic Messages API, so end-to-end tests can drive
 * the chat and Text to diagram without a real key. Launch the app with
 * ANTHROPIC_BASE_URL set to `url` and a key from the environment or Settings.
 *
 * Each request gets the next scripted reply, streamed as SSE the way the SDK
 * expects; once the script runs out, the model just says "Done."
 */
import http from 'node:http'

export interface FakeReply {
  text?: string
  toolUses?: { name: string; input: unknown }[]
}

export interface FakeAnthropic {
  url: string
  /** Every request body received, in order. */
  requests: unknown[]
  close(): Promise<void>
}

const sseEvents = (reply: FakeReply, n: number) => {
  const tools = reply.toolUses ?? []
  const events: Array<{ type: string } & Record<string, unknown>> = [
    {
      type: 'message_start',
      message: {
        id: `msg_fake_${n}`,
        type: 'message',
        role: 'assistant',
        model: 'fake',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
  ]
  let index = 0
  if (reply.text) {
    events.push(
      { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text: reply.text } },
      { type: 'content_block_stop', index },
    )
    index++
  }
  for (const [i, tool] of tools.entries()) {
    events.push(
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: `toolu_fake_${n}_${i}`, name: tool.name, input: {} },
      },
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input) },
      },
      { type: 'content_block_stop', index },
    )
    index++
  }
  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: tools.length ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  )
  return events
}

/** What GET /v1/models answers, newest first like Anthropic's. */
export const MODEL_LIST = {
  data: [
    { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-01T00:00:00Z' },
    { type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-08-01T00:00:00Z' },
  ],
  has_more: false,
  first_id: 'claude-opus-5-5',
  last_id: 'claude-sonnet-5-5',
}

export const startFakeAnthropic = async (script: FakeReply[]): Promise<FakeAnthropic> => {
  const replies = [...script]
  const requests: unknown[] = []
  const server = http.createServer((req, res) => {
    // The chat's model menu and Settings list models; that isn't a scripted turn.
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(MODEL_LIST))
      return
    }
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString()))
    req.on('end', () => {
      requests.push(JSON.parse(body || 'null'))
      const reply = replies.shift() ?? { text: 'Done.' }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of sseEvents(reply, requests.length)) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      }
      res.end()
    })
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fake Anthropic did not bind a port')
  const { port } = address
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => {
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      return closed.promise
    },
  }
}

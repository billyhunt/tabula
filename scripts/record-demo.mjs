#!/usr/bin/env node
/**
 * Records docs/demo.gif, the README's look at the chat drawing on the board.
 *
 *   npm run build && node scripts/record-demo.mjs
 *
 * The app is the real built app with a throwaway profile. The model is not:
 * a local stand-in for the Anthropic API streams a scripted reply, so the
 * recording is repeatable and needs no key. Everything after the reply --
 * the tool calls, the Mermaid conversion, the drawing, the chat UI -- is
 * Tabula running as it does for a live model. The README says so.
 */
import { _electron as electron } from '@playwright/test'
import gifenc from 'gifenc'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pngjs from 'pngjs'

// Both are CommonJS packages.
const { GIFEncoder, applyPalette, quantize } = gifenc
const { PNG } = pngjs

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'docs', 'demo.gif')
// Wide enough for Excalidraw to dock the chat sidebar (it floats, and closes
// on a canvas click, in narrower windows).
const SIZE = { width: 1320, height: 760 }

const PROMPT = 'Sketch how a photo gets from upload to the gallery, with a quality check'

const FLOW = [
  'flowchart LR',
  '  upload[Upload photo] --> check{OK?}',
  '  check -->|sharp| tag[Auto-tag with AI]',
  '  check -->|blurry| retake[Ask for a retake]',
  '  retake --> upload',
  '  tag --> store[(Cloud storage)]',
  '  store --> gallery[Gallery]',
].join('\n')

// The scripted model: one reply per request, streamed word by word.
const REPLIES = [
  { text: "I'll check what's on the board first.", tool: { name: 'get_scene', input: {} } },
  {
    text: 'The board is empty, so I\'ll lay the flow out left to right as a flowchart.',
    tool: { name: 'import_mermaid', input: { mermaid: FLOW } },
  },
  { text: 'Fitting it in view.', tool: { name: 'zoom_to_fit', input: {} } },
  {
    text:
      'Done: upload, a quality check that sends blurry photos back for a retake, ' +
      'AI tagging, cloud storage and the gallery. Every box is an editable shape.',
  },
]

const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const startModel = async () => {
  let turn = 0
  const server = http.createServer((req, res) => {
    req.resume()
    // Settings lists the provider's models; only message requests are turns.
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: [{ type: 'model', id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-01-01T00:00:00Z' }],
          has_more: false,
          first_id: 'claude-sonnet-5-5',
          last_id: 'claude-sonnet-5-5',
        }),
      )
      return
    }
    req.on('end', async () => {
      const reply = REPLIES[Math.min(turn++, REPLIES.length - 1)]
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      sse(res, 'message_start', {
        message: { id: `msg_${turn}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
      })
      sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
      for (const word of reply.text.split(/(?<= )/)) {
        sse(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: word } })
        await pause(55)
      }
      sse(res, 'content_block_stop', { index: 0 })
      if (reply.tool) {
        await pause(250)
        sse(res, 'content_block_start', { index: 1, content_block: { type: 'tool_use', id: `toolu_${turn}`, name: reply.tool.name, input: {} } })
        sse(res, 'content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.tool.input) } })
        sse(res, 'content_block_stop', { index: 1 })
      }
      sse(res, 'message_delta', { delta: { stop_reason: reply.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
      sse(res, 'message_stop', {})
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

const model = await startModel()
const profile = mkdtempSync(path.join(os.tmpdir(), 'tabula-demo-'))
// Frames are captured continuously; identical ones are merged into one
// longer frame when encoding.
const frames = []
let recording = false
let capture = Promise.resolve()
let app
try {
  app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      TABULA_USER_DATA: profile,
      ANTHROPIC_BASE_URL: model.url,
      ANTHROPIC_API_KEY: 'demo',
      OPENROUTER_API_KEY: '',
    },
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
  }, SIZE)
  await page.waitForSelector('.ask-input')
  await page.evaluate(() => document.fonts.ready)
  await pause(800)

  recording = true
  capture = (async () => {
    while (recording) {
      const started = Date.now()
      frames.push({ at: started, png: await page.screenshot({ scale: 'css' }) })
      await pause(Math.max(0, 110 - (Date.now() - started)))
    }
  })()

  await pause(700)
  await page.locator('.ask-input').click()
  await page.keyboard.type(PROMPT, { delay: 28 })
  await pause(400)
  await page.keyboard.press('Enter')
  await page.locator('.ask-run .ask-text').filter({ hasText: 'Every box is an editable shape.' }).waitFor({ timeout: 30_000 })
  // Deselect, so the last frames show the drawing rather than selection boxes.
  await page.mouse.click(SIZE.width / 2, SIZE.height - 40)
  await pause(3000)
} finally {
  // Whatever happened, leave nothing behind: no app, no server, no profile.
  recording = false
  await capture.catch(() => undefined)
  await app?.close().catch(() => undefined)
  await new Promise((resolve) => model.server.close(resolve))
  rmSync(profile, { recursive: true, force: true })
}

// One palette for the whole GIF, from a sample of frames, keeps colours
// steady between frames and the file small.
const decoded = frames.map((f) => ({ at: f.at, png: PNG.sync.read(f.png) }))
const { width, height } = decoded[0].png
const sample = new Uint8Array(width * height * 4 * 4)
for (let i = 0; i < 4; i++) {
  const frame = decoded[Math.floor(((decoded.length - 1) * i) / 3)].png
  sample.set(frame.data, i * width * height * 4)
}
const palette = quantize(sample, 256)

const gif = GIFEncoder()
for (let i = 0; i < decoded.length; i++) {
  const { png, at } = decoded[i]
  const next = decoded[i + 1]
  if (next && Buffer.compare(png.data, next.png.data) === 0) {
    next.at = at // merge: the next frame starts when this one did
    continue
  }
  const delay = next ? next.at - at : 2500
  gif.writeFrame(applyPalette(png.data, palette), width, height, { palette, delay })
}
gif.finish()
writeFileSync(OUT, gif.bytes())
console.log(`Wrote ${path.relative(root, OUT)}: ${width}x${height}, ${(gif.bytes().length / 1e6).toFixed(1)} MB`)

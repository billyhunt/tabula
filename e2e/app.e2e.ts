/**
 * Drives the built app end to end: drawing and text editing, the MCP server
 * an external agent would use, every export format, saving and versions,
 * the Ask bar against a fake Anthropic API, and Text to diagram.
 *
 * Run with `npm run test:e2e` (builds first). Set TABULA_E2E_APP to a
 * packaged app's binary (…/Tabula.app/Contents/MacOS/Tabula) to run the same
 * checks against the packaged build. Uses a throwaway profile, so real
 * settings, versions and the MCP token are never touched.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { startFakeAnthropic, type FakeAnthropic } from './fakeAnthropic'

const MCP_PORT = 47_391

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let fake: FakeAnthropic
let mcp: Client
let tmp: string
const consoleErrors: string[] = []

const sendCommand = (cmd: string) =>
  app.evaluate(({ BrowserWindow }, command) => {
    BrowserWindow.getAllWindows()[0].webContents.send('menu:command', command)
  }, cmd)

interface ToolContent {
  type: string
  text?: string
  data?: string
}

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const result = await mcp.callTool({ name, arguments: args })
  const content = result.content as ToolContent[]
  if (result.isError) throw new Error(`${name} failed: ${content.map((c) => c.text).join(' ')}`)
  return content
}

const sceneJson = async () => {
  const json = (await call('get_scene')).find((c) => c.text?.startsWith('{'))
  return JSON.parse(json?.text ?? '{}') as {
    elements: { id: string; type: string; label?: string; text?: string }[]
  }
}

test.beforeAll(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'tabula-e2e-'))
  fake = await startFakeAnthropic([
    { text: 'Looking. ', toolUses: [{ name: 'get_scene', input: {} }] },
    {
      toolUses: [
        {
          name: 'add_elements',
          input: {
            elements: [
              { type: 'rectangle', id: 'asked', x: 900, y: 0, width: 180, height: 80, label: { text: 'From Ask' } },
            ],
          },
        },
      ],
    },
    { text: 'Added a box.' },
    { text: 'flowchart TD\n  A[Start] --> B[End]' },
  ])
  const packaged = process.env.TABULA_E2E_APP
  app = await electron.launch({
    ...(packaged
      ? { executablePath: packaged }
      : { args: ['.'], cwd: path.resolve(import.meta.dirname, '..') }),
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      TABULA_USER_DATA: path.join(tmp, 'profile'),
      ANTHROPIC_BASE_URL: fake.url,
      ANTHROPIC_API_KEY: 'test-key',
    },
  })
  page = await app.firstWindow()
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  await page.waitForSelector('.excalidraw')
})

test.afterAll(async () => {
  await mcp?.close()
  await app?.close()
  await fake?.close()
})

test('the editor loads its bundled fonts and edits text inside a shape', async () => {
  await expect(page.getByText('Tabula rasa.')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('20px Excalifont'))).toBe(true)

  await page.mouse.click(1100, 700)
  await page.keyboard.press('r')
  await page.mouse.move(250, 450)
  await page.mouse.down()
  await page.mouse.move(450, 600, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await page.mouse.dblclick(350, 525)
  const editor = page.locator('textarea.excalidraw-wysiwyg')
  await expect(editor).toBeVisible()
  await page.keyboard.type('Hello box')
  // The caret sits in the middle of the shape, not offset from it.
  const box = await editor.boundingBox()
  expect(box).not.toBeNull()
  expect(Math.abs(box!.y + box!.height / 2 - 525)).toBeLessThan(6)
  expect(Math.abs(box!.x + box!.width / 2 - 350)).toBeLessThan(6)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: path.join(tmp, 'text-edit.png') })
})

test('the MCP server refuses unauthenticated and browser requests', async () => {
  await page.evaluate((port) => window.tabula.settings.update({ agent: { mcpEnabled: true, mcpPort: port } }), MCP_PORT)
  await expect
    .poll(async () => (await page.evaluate(() => window.tabula.agent.status())).mcp.running)
    .toBe(true)
  const url = `http://127.0.0.1:${MCP_PORT}/mcp`
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(401)

  const command = await page.evaluate(() => window.tabula.agent.setupCommand())
  const token = /Bearer ([^"]+)"/.exec(command)?.[1]
  expect(token).toBeTruthy()
  const auth = { ...headers, authorization: `Bearer ${token}` }
  expect((await fetch(url, { method: 'POST', headers: { ...auth, origin: 'https://evil.example' }, body })).status).toBe(403)

  mcp = new Client({ name: 'tabula-e2e', version: '1.0.0' })
  await mcp.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
})

test('an agent draws, exports every format, and saves over MCP', async () => {
  const tools = (await mcp.listTools()).tools.map((t) => t.name)
  expect(tools).toEqual(expect.arrayContaining(['get_scene', 'add_elements', 'import_mermaid', 'export', 'save']))

  await call('add_elements', {
    elements: [
      { type: 'rectangle', id: 'idea', x: 0, y: 0, width: 160, height: 80, label: { text: 'Idea "one"' } },
      { type: 'diamond', id: 'check', x: 300, y: 0, width: 160, height: 100, label: { text: 'Good?' } },
      { type: 'arrow', id: 'go', start: { id: 'idea' }, end: { id: 'check' }, label: { text: 'test' } },
    ],
  })
  const scene = await sceneJson()
  expect(scene.elements.some((e) => e.type === 'diamond')).toBe(true)

  const mmd = path.join(tmp, 'board.mmd')
  await call('export', { format: 'mermaid', path: mmd })
  const mermaid = readFileSync(mmd, 'utf8')
  expect(mermaid).toMatch(/^flowchart (LR|TD)/)
  expect(mermaid).toContain('-->|"test"|')
  expect(mermaid).toContain('#quot;one#quot;')

  const svgPath = path.join(tmp, 'board.svg')
  await call('export', { format: 'svg', path: svgPath })
  const svg = readFileSync(svgPath, 'utf8')
  expect(svg).not.toMatch(/https?:\/\/[^"')]*\.woff2/)
  expect(svg).toContain('font/woff2;base64')

  const pngPath = path.join(tmp, 'board.png')
  await call('export', { format: 'png', path: pngPath })
  expect(readFileSync(pngPath).subarray(1, 4).toString()).toBe('PNG')

  const pdfPath = path.join(tmp, 'board.pdf')
  await call('export', { format: 'pdf', path: pdfPath })
  const pdfBytes = readFileSync(pdfPath)
  const pdf = pdfBytes.toString('latin1')
  expect(pdf.startsWith('%PDF')).toBe(true)
  // Vector, not a screenshot. Chromium only emits images for the mask that
  // hides an arrow under its label: a greyscale alpha mask plus a flat fill.
  // A rasterized drawing would be a full-colour image with many colours.
  for (const match of pdf.matchAll(/<<([^>]*\/Subtype \/Image[^>]*)>>\s*stream\r?\n/g)) {
    if (match[1].includes('/DeviceGray')) continue
    const start = match.index + match[0].length
    const raw = pdfBytes.subarray(start, pdf.indexOf('endstream', start))
    expect(new Set(inflateSync(raw)).size).toBe(1)
  }
  expect(pdf).toContain('/FontFile')

  const shot = await call('screenshot')
  expect(shot.some((c) => c.type === 'image' && (c.data?.length ?? 0) > 1000)).toBe(true)

  const drawing = path.join(tmp, 'Board.excalidraw.md')
  await call('save', { path: drawing })
  const saved = readFileSync(drawing, 'utf8')
  expect(saved).toContain('excalidraw-plugin')
  await expect(page.locator('.titlebar-name')).toContainText('BOARD.EXCALIDRAW.MD', { ignoreCase: true })

  await call('import_mermaid', { mermaid: 'flowchart LR\n  X[Imported] --> Y[Too]', x: 0, y: 300 })
  const labels = (await sceneJson()).elements.map((e) => e.label ?? e.text)
  expect(labels).toEqual(expect.arrayContaining(['Imported', 'Too']))

  // The second save snapshots the first, which shows up in the history.
  await call('save')
  const versions = await page.evaluate((p) => window.tabula.versions.list(p), drawing)
  expect(versions.length).toBeGreaterThanOrEqual(1)
  await sendCommand('browse-versions')
  await expect(page.locator('.versions-row').first()).toBeVisible()
  await expect(page.locator('.versions-preview-image svg')).toBeVisible()
  await page.screenshot({ path: path.join(tmp, 'versions.png') })
  await page.keyboard.press('Escape')
  await expect(page.locator('.versions-dialog')).toBeHidden()
})

test('the Ask bar runs Claude with the canvas tools', async () => {
  await sendCommand('ask')
  const input = page.locator('.ask-input')
  await expect(input).toBeVisible()
  await input.fill('Add a box that says From Ask')
  await input.press('Enter')
  await expect(page.locator('.ask-text').last()).toContainText('Added a box.')
  await page.screenshot({ path: path.join(tmp, 'ask.png') })

  const labels = (await sceneJson()).elements.map((e) => e.label ?? e.text)
  expect(labels).toContain('From Ask')
  // The model saw the result of its tool call.
  expect(JSON.stringify(fake.requests[1])).toContain('tool_result')
  await page.keyboard.press('Escape')
})

test('Text to diagram streams Mermaid from Claude', async () => {
  const mermaid = await page.evaluate(() =>
    window.tabula.agent.textToDiagram(crypto.randomUUID(), [{ role: 'user', content: 'start to end' }]),
  )
  expect(mermaid).toContain('A[Start] --> B[End]')
})

test('settings open from the menu, and nothing hit the CSP', async () => {
  await sendCommand('settings')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.screenshot({ path: path.join(tmp, 'settings.png') })
  await page.keyboard.press('Escape')
  // Two known, harmless reports. Excalidraw always lists esm.sh after the
  // bundled copy of each font, and Chromium reports that second source even
  // though the bundled font loads (checked by document.fonts above). And
  // font subsetting for SVG export needs eval, which the CSP keeps off, so
  // exports embed whole font files instead (tens of KB). Anything else the
  // CSP blocked is a real problem.
  const blocked = consoleErrors.filter((e) => e.includes('Content Security Policy'))
  const unexpected = blocked.filter(
    (e) => !e.includes("'https://esm.sh/@excalidraw/") && !e.startsWith('Skipped glyph subsetting'),
  )
  expect(unexpected).toEqual([])
  console.log(`e2e artefacts in ${tmp}`)
})

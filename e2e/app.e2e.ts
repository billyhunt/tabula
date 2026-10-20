/**
 * Drives the built app end to end: drawing and text editing, the MCP server
 * an external agent would use, every export format, saving and versions,
 * the chat against a fake Anthropic API, and Text to diagram.
 *
 * Run with `npm run test:e2e` (builds first). Set TABULA_E2E_APP to a
 * packaged app's binary (…/Tabula.app/Contents/MacOS/Tabula) to run the same
 * checks against the packaged build. Uses a throwaway profile, so real
 * settings, versions and the MCP token are never touched.
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { startFakeAnthropic, type FakeAnthropic } from './fakeAnthropic'
import { z } from 'zod'

const MCP_PORT = 47_391

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let fake: FakeAnthropic
let mcp: Client
let tmp: string
const consoleErrors: string[] = []

// The window the tests drive. An agent's new_drawing and open_file open one of
// their own, so tests follow it with inNewWindow.
let winId: number

const sendCommand = (cmd: string) =>
  app.evaluate(
    ({ BrowserWindow }, { id, command }) => {
      BrowserWindow.fromId(id)?.webContents.send('menu:command', command)
    },
    { id: winId, command: cmd },
  )

/**
 * Runs `open`, which opens a drawing in a new window, or in the current one if
 * that is still blank, and makes that window the one the tests drive.
 */
const inNewWindow = async (open: () => Promise<unknown>) => {
  const listIds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
  const idsBefore = await listIds()
  const pagesBefore = app.windows()
  await open()
  const fresh = (await listIds()).filter((id) => !idsBefore.includes(id))
  expect(fresh.length).toBeLessThanOrEqual(1)
  if (fresh.length === 0) return
  winId = fresh[0]
  await expect.poll(() => app.windows().some((p) => !pagesBefore.includes(p))).toBe(true)
  page = app.windows().find((p) => !pagesBefore.includes(p)) as Page
  await page.waitForSelector('.excalidraw')
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.setContentSize(1280, 820), winId)
}

/** Makes main's Save dialog answer `filePath` without showing, counting calls. */
const stubSaveDialog = (filePath: string) =>
  app.evaluate(({ dialog }, answer) => {
    Reflect.set(globalThis, 'saveDialogCalls', 0)
    dialog.showSaveDialog = (async () => {
      Reflect.set(globalThis, 'saveDialogCalls', Number(Reflect.get(globalThis, 'saveDialogCalls')) + 1)
      return { canceled: false, filePath: answer }
    }) as typeof dialog.showSaveDialog
  }, filePath)

const saveDialogCalls = () => app.evaluate(() => Number(Reflect.get(globalThis, 'saveDialogCalls')))

const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText())

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
    { text: 'It says From Ask.' },
    { text: 'Fresh start.' },
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
      // No key from the environment: the chat test adds one through Settings.
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
    },
  })
  page = await app.firstWindow()
  winId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)
  // Every window the app opens, so errors in the ones the tests open count too.
  const watch = (p: Page) =>
    p.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
  app.windows().forEach(watch)
  app.on('window', watch)
  await page.waitForSelector('.excalidraw')
  // The tests click at fixed points and expect the chat docked, which needs
  // a window this size. CI machines have small screens, where macOS would
  // otherwise shrink the window to fit.
  const sizes = await app.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1280, 820)
    return { screen: screen.getPrimaryDisplay().workAreaSize, window: win.getContentSize() }
  })
  console.log(`e2e window ${sizes.window.join('x')} on a ${sizes.screen.width}x${sizes.screen.height} work area`)
})

test.afterAll(async () => {
  await mcp?.close()
  await app?.close()
  await fake?.close()
})

test('the editor loads its bundled fonts and edits text inside a shape', async () => {
  await expect(page.getByText('Tabula rasa.')).toBeVisible()
  // Excalidraw registers its font faces asynchronously after startup, so
  // wait until the bundled Excalifont is registered and has loaded.
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await document.fonts.load('20px Excalifont', 'Tabula')).some((face) => face.status === 'loaded'),
      ),
    )
    .toBe(true)

  // An empty spot left of the chat sidebar. Everything the tests click stays
  // above y = 650: CI screens are 677px tall.
  await page.mouse.click(880, 600)
  await page.keyboard.press('r')
  await page.mouse.move(250, 330)
  await page.mouse.down()
  await page.mouse.move(450, 480, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await page.mouse.dblclick(350, 405)
  const editor = page.locator('textarea.excalidraw-wysiwyg')
  await expect(editor).toBeVisible()
  await page.keyboard.type('Hello box')
  // New text uses Tabula's default font, not Excalidraw's, from the bundled copy.
  expect(await editor.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Comic Shanns')
  const comicShanns = await page.evaluate(async () => {
    const faces = await document.fonts.load('20px "Comic Shanns"', 'Hello box')
    return faces.map((face) => face.status)
  })
  expect(comicShanns.length).toBeGreaterThan(0)
  expect(comicShanns.every((status) => status === 'loaded')).toBe(true)
  // The caret sits in the middle of the shape, not offset from it. Polled:
  // the editor re-measures once the font it was waiting for arrives.
  const offCentre = async () => {
    const box = await editor.boundingBox()
    if (!box) return Infinity
    return Math.max(Math.abs(box.y + box.height / 2 - 405), Math.abs(box.x + box.width / 2 - 350))
  }
  await expect.poll(offCentre).toBeLessThan(6)
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
  // A diagram type that would only come in as a picture is refused with a
  // reason, so the agent rewrites it instead of hand-placing everything.
  const before = (await sceneJson()).elements.length
  await expect(
    call('import_mermaid', { mermaid: 'gantt\n  title Launch\n  section Build\n  Code :a1, 2026-10-01, 3d' }),
  ).rejects.toThrow('Rewrite it as a flowchart')
  expect((await sceneJson()).elements).toHaveLength(before)

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

test('the chat asks for a key, then runs Claude with the canvas tools and remembers the conversation', async () => {
  // Open in the sidebar from the start.
  const input = page.locator('.ask-input')
  await expect(input).toBeVisible()

  // No key yet: sending opens Settings at the key, and the message waits.
  await input.fill('Add a box that says From Ask')
  await input.press('Enter')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByText('Add your API key.')).toBeVisible()
  const keyField = settings.getByLabel('Anthropic API key')
  await expect(keyField).toBeFocused()
  await keyField.fill('sk-ant-e2e-key')
  await keyField.press('Enter')
  await expect(settings).toContainText('A key is saved')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // The message waited; with the key in, Enter sends it.
  await expect(input).toHaveValue('Add a box that says From Ask')
  await input.press('Enter')
  await expect(page.locator('.ask-text').last()).toContainText('Added a box.')
  expect(fake.requests[0]).toMatchObject({ model: 'claude-sonnet-5-5' })

  const labels = (await sceneJson()).elements.map((e) => e.label ?? e.text)
  expect(labels).toContain('From Ask')
  // The model saw the result of its tool call.
  expect(JSON.stringify(fake.requests[1])).toContain('tool_result')

  // The model menu offers the models ticked in Settings.
  await page.getByRole('button', { name: 'Sonnet 5.5' }).click()
  const menu = page.getByRole('menu', { name: 'Model' })
  await menu.getByRole('menuitem', { name: 'Choose models…' }).click()
  const opus = settings.getByRole('checkbox', { name: /Opus 5\.5/ })
  await opus.click()
  // Ticked once the setting round-trips through main.
  await expect(opus).toBeChecked()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Sonnet 5.5' }).click()
  await expect(menu.getByRole('menuitemradio')).toHaveText(['Opus 5.5', 'Sonnet 5.5'])
  await expect(menu.getByRole('menuitemradio', { name: 'Sonnet 5.5' })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('menuitemradio', { name: 'Opus 5.5' }).click()
  await expect(page.getByRole('button', { name: 'Opus 5.5' })).toBeVisible()

  // A follow-up, on the newly chosen model, carries the earlier exchange.
  await input.fill('What does the box say?')
  await input.press('Enter')
  await expect(page.locator('.ask-text').last()).toContainText('It says From Ask.')
  await expect(page.locator('.ask-run')).toHaveCount(2)
  await page.screenshot({ path: path.join(tmp, 'ask.png') })
  expect(fake.requests.at(-1)).toMatchObject({ model: 'claude-opus-5-5' })
  const followUp = JSON.stringify(fake.requests.at(-1))
  expect(followUp).toContain('Add a box that says From Ask')
  expect(followUp).toContain('Added a box.')
  expect(followUp).toContain('What does the box say?')

  // New chat starts from nothing.
  await page.getByRole('button', { name: 'New chat' }).click()
  await expect(page.locator('.ask-run')).toHaveCount(0)
  await input.fill('Hello')
  await input.press('Enter')
  await expect(page.locator('.ask-text').last()).toContainText('Fresh start.')
  expect(JSON.stringify(fake.requests.at(-1))).not.toContain('From Ask')

  // View ▸ Show Chat hides it; ⌘J brings it back with the cursor in the box.
  await page.evaluate(() => window.tabula.settings.update({ showChat: false }))
  await expect(input).toBeHidden()
  await sendCommand('ask')
  await expect(input).toBeFocused()
  await input.press('Escape')
  await expect(input).not.toBeFocused()
})

test('Text to diagram streams Mermaid from Claude', async () => {
  const mermaid = await page.evaluate(() =>
    window.tabula.agent.textToDiagram(crypto.randomUUID(), [{ role: 'user', content: 'start to end' }]),
  )
  expect(mermaid).toContain('A[Start] --> B[End]')
})

test('a long conversation scrolls, and its text can be copied or saved', async () => {
  await sendCommand('ask')
  const input = page.locator('.ask-input')
  await expect(input).toBeVisible()
  const long = Array.from({ length: 120 }, (_, i) => `Line ${i + 1} of a long message`).join('\n')
  await input.fill(long)
  await input.press('Enter')
  await expect(page.locator('.ask-run').last()).toContainText('Done.')

  // The conversation scrolls inside the sidebar; the message box stays on screen.
  const chatLog = page.locator('.chat-log')
  const sizes = await chatLog.evaluate((el) => ({ content: el.scrollHeight, shown: el.clientHeight }))
  expect(sizes.content).toBeGreaterThan(sizes.shown)
  const composer = await page.locator('.chat-composer').boundingBox()
  const windowHeight = await page.evaluate(() => innerHeight)
  expect(composer).not.toBeNull()
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(windowHeight)

  // Text selected in the conversation copies as text, not as Excalidraw shapes.
  await expect(chatLog).toHaveCSS('user-select', 'text')
  await page.locator('.ask-prompt').last().evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    getSelection()?.removeAllRanges()
    getSelection()?.addRange(range)
  })
  await page.keyboard.press('Meta+C')
  await expect.poll(clipboardText).toContain('Line 120 of a long message')

  // Copy and Save… hand over the whole conversation as Markdown.
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect.poll(clipboardText).toContain('## You')
  expect(await clipboardText()).toContain('## Claude')
  const saved = path.join(tmp, 'chat.md')
  await stubSaveDialog(saved)
  await page.getByRole('button', { name: 'Save…' }).click()
  await expect.poll(() => existsSync(saved) && readFileSync(saved, 'utf8')).toContain('Line 1 of a long message')
  expect(readFileSync(saved, 'utf8')).toMatch(/^# Chat/)
})

test("text from every source uses Tabula's font, including Excalidraw's Mermaid dialog", async () => {
  await sendCommand('import-mermaid')
  const dialog = page.locator('.ttd-dialog')
  await expect(dialog).toBeVisible()
  const editor = dialog.locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('flowchart LR\n  P[From dialog] --> Q[Also]')
  await expect(dialog.locator('.ttd-dialog-output-canvas-content canvas')).toBeVisible()
  await dialog.getByRole('button', { name: /insert/i }).click()
  await expect(dialog).toBeHidden()

  // Typed text, add_elements labels, the chat's box, import_mermaid and the dialog.
  await call('save')
  const drawing = path.join(tmp, 'Board.excalidraw.md')
  const json = /```json\n([\s\S]*?)```/.exec(readFileSync(drawing, 'utf8'))?.[1] ?? '{}'
  const SavedScene = z.object({
    elements: z.array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
        fontFamily: z.number().optional(),
        isDeleted: z.boolean().optional(),
      }),
    ),
  })
  const texts = SavedScene.parse(JSON.parse(json)).elements.filter(
    (e) => e.type === 'text' && !e.isDeleted,
  )
  expect(texts.map((e) => e.text)).toEqual(
    expect.arrayContaining(['Hello box', 'Good?', 'From Ask', 'Imported', 'From dialog']),
  )
  expect(texts.filter((e) => e.fontFamily !== 8)).toEqual([])
})

test("an agent's new_drawing leaves the open drawing alone, and reuses a window that is still blank", async () => {
  const drawn = (await sceneJson()).elements.length
  expect(drawn).toBeGreaterThan(0)
  const drawnId = winId
  const focus = (id: number) =>
    app.evaluate(({ BrowserWindow }, target) => BrowserWindow.fromId(target)?.focus(), id)

  await inNewWindow(() => call('new_drawing'))
  const blankId = winId
  expect(blankId).not.toBe(drawnId)
  expect((await sceneJson()).elements).toHaveLength(0)

  // Nothing drawn yet, so asking again reuses the window instead of piling up more.
  const windows = app.windows().length
  await call('new_drawing')
  expect(app.windows()).toHaveLength(windows)

  // The first drawing was not replaced.
  await focus(drawnId)
  await expect.poll(async () => (await sceneJson()).elements.length).toBe(drawn)

  // Later calls draw in the new window once it is the one in front.
  await focus(blankId)
  await call('add_elements', { elements: [{ type: 'text', x: 0, y: 0, text: 'Second drawing' }] })
  await expect.poll(async () => (await sceneJson()).elements.length).toBe(1)
})

test("an agent's open_file refuses unreadable drawings, never opens a file twice, and never replaces a drawing", async () => {
  const countWindows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const shownFiles = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getRepresentedFilename()))
  const drawing = (text: string) =>
    JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'e2e',
      elements: [
        { id: text, type: 'rectangle', x: 0, y: 0, width: 100, height: 60, version: 1, versionNonce: 1, isDeleted: false },
      ],
      appState: {},
      files: {},
    })
  const before = await countWindows()
  expect((await sceneJson()).elements.length).toBeGreaterThan(0)

  // Valid JSON that is not a drawing, and text that is not JSON: both fail the call
  // (no dialog to stall on) and leave no stray window behind.
  for (const [name, body] of [
    ['empty-object.excalidraw', '{}'],
    ['garbled.excalidraw', 'not json at all'],
  ]) {
    const bad = path.join(tmp, name)
    writeFileSync(bad, body)
    await expect(call('open_file', { path: bad })).rejects.toThrow(/Not a drawing Tabula can open/)
    await expect.poll(countWindows).toBe(before)
  }

  // The window in front has a drawing, so the editor refuses to load over it.
  const loadFileInto = (id: number, contents: string) =>
    app.evaluate(
      ({ BrowserWindow, ipcMain }, args) =>
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          const requestId = `e2e-${Date.now()}`
          const onResponse = (_event: unknown, response: { id: string; ok: boolean; error?: string }) => {
            if (response.id !== requestId) return
            ipcMain.off('agent:response', onResponse)
            resolve(response)
          }
          ipcMain.on('agent:response', onResponse)
          BrowserWindow.fromId(args.id)?.webContents.send('agent:request', {
            id: requestId,
            tool: 'loadFile',
            args: { path: '/tmp/never-written.excalidraw', contents: args.contents },
          })
        }),
      { id, contents },
    )
  const drawn = (await sceneJson()).elements.length
  expect(await loadFileInto(winId, drawing('intruder'))).toMatchObject({
    ok: false,
    error: 'This window is no longer blank',
  })
  expect((await sceneJson()).elements).toHaveLength(drawn)

  // Concurrent opens, one file twice: each file ends up open in exactly one window.
  const fileA = path.join(tmp, 'open-twice-a.excalidraw')
  const fileB = path.join(tmp, 'open-twice-b.excalidraw')
  writeFileSync(fileA, drawing('a'))
  writeFileSync(fileB, drawing('b'))
  const results = await Promise.all([
    call('open_file', { path: fileA }),
    call('open_file', { path: fileB }),
    call('open_file', { path: fileA }),
  ])
  expect(results[2].some((c) => c.text?.includes('already open'))).toBe(true)
  await expect.poll(async () => (await shownFiles()).filter((f) => f === fileA || f === fileB).length).toBe(2)
  const shown = await shownFiles()
  expect(shown.filter((f) => f === fileA)).toHaveLength(1)
  expect(shown.filter((f) => f === fileB)).toHaveLength(1)
  expect(await countWindows()).toBe(before + 2)

  // Back to the drawing the later tests expect.
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.focus(), winId)
})

test('a drawing Finder could not open does not keep its path reserved', async () => {
  const listIds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.id))
  const file = path.join(tmp, 'finder-open.excalidraw')
  writeFileSync(file, '{}') // valid JSON, not a drawing: the window refuses it with an alert
  const idsBefore = await listIds()
  const pagesBefore = app.windows()
  await app.evaluate(({ app: electronApp }, target) => {
    electronApp.emit('open-file', { preventDefault() {} }, target)
  }, file)
  await expect.poll(async () => (await listIds()).length).toBe(idsBefore.length + 1)
  const [finderId] = (await listIds()).filter((id) => !idsBefore.includes(id))
  await expect.poll(() => app.windows().some((p) => !pagesBefore.includes(p))).toBe(true)
  const finderPage = app.windows().find((p) => !pagesBefore.includes(p)) as Page
  // The window refuses the file with a native alert; answer it here so it never
  // sits on the screen.
  finderPage.on('dialog', (dialog) => void dialog.dismiss())
  await finderPage.waitForSelector('.excalidraw')
  // Hand the window the file again now that its editor is certainly listening
  // (the first delivery can beat the listener), so it takes the failure path.
  await app.evaluate(
    ({ BrowserWindow }, args) => {
      BrowserWindow.fromId(args.id)?.webContents.send('file:opened', { path: args.file, contents: '{}' })
    },
    { id: finderId, file },
  )

  // Once the file is fixed an agent can open it. While the window's claim on
  // the path stood, the call answered "already open" and loaded nothing.
  writeFileSync(file, JSON.stringify({ type: 'excalidraw', version: 2, source: 'e2e', elements: [], appState: {}, files: {} }))
  await expect
    .poll(async () => (await call('open_file', { path: file })).some((c) => c.text?.startsWith('Opened')), { timeout: 10_000 })
    .toBe(true)
  // The failed window was reused, not a second one made.
  expect((await listIds()).length).toBe(idsBefore.length + 1)

  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.focus(), winId)
})

test('the Export image dialog opens on the whole board even with something selected', async () => {
  // add_elements leaves what it adds selected, which Excalidraw's dialog
  // would otherwise turn into an export of just that.
  await call('add_elements', { elements: [{ type: 'rectangle', x: 0, y: 100, width: 120, height: 60 }] })
  await expect.poll(async () => (await sceneJson()).elements.length).toBe(2)
  await sendCommand('export-image')
  const onlySelected = page.locator('input[name="exportOnlySelected"]')
  await expect(onlySelected).toBeAttached()
  await expect(onlySelected).not.toBeChecked()
  // Still there for exporting just the selection.
  await onlySelected.evaluate((el: HTMLInputElement) => el.click())
  await expect(onlySelected).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(onlySelected).toHaveCount(0)
})

test('an existing box takes a label from a double-click anywhere, or from the Label field', async () => {
  await inNewWindow(() => call('new_drawing'))
  const drawBox = async (x: number, y: number) => {
    // Focus the canvas (an empty spot left of the chat sidebar), so the R shortcut reaches it.
    await page.mouse.click(880, 600)
    await page.keyboard.press('r')
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 240, y + 140, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.press('Escape')
  }
  const labelOf = async (text: string) =>
    (await sceneJson()).elements.find((e) => e.type === 'rectangle' && e.label === text)

  // Near a corner, nowhere near the centre: Excalidraw alone would drop
  // loose text here.
  await drawBox(400, 250)
  await page.mouse.dblclick(420, 265)
  await expect(page.locator('textarea.excalidraw-wysiwyg')).toBeVisible()
  await page.keyboard.type('Corner')
  await page.keyboard.press('Escape')
  await expect.poll(() => labelOf('Corner')).toBeTruthy()

  // The Label field: select a box by its outline, type, press Return.
  await drawBox(700, 250)
  await page.mouse.click(700, 320)
  const field = page.locator('.tabula-label-input')
  await expect(field).toBeVisible()
  await expect(field).toHaveValue('')
  await field.fill('From the panel')
  await field.press('r') // a canvas shortcut, typed as text here
  await field.press('Enter')
  await expect.poll(() => labelOf('From the panelr')).toBeTruthy()
  await page.screenshot({ path: path.join(tmp, 'labels.png') })

  // The field shows an existing label, and emptying it removes the label.
  await page.mouse.click(400, 320)
  await expect(field).toHaveValue('Corner')
  await field.fill('')
  await field.press('Enter')
  await expect.poll(async () => (await sceneJson()).elements.some((e) => e.text === 'Corner')).toBe(false)
})

test('the library is saved, and comes back after the window reloads', async () => {
  // The labelled box from the previous test: select it by its outline, add it.
  await page.mouse.click(700, 320)
  await page.mouse.click(700, 320, { button: 'right' })
  await page.getByText('Add to library').click()
  const stored = path.join(tmp, 'profile', 'library.excalidrawlib')
  await expect.poll(() => existsSync(stored) && readFileSync(stored, 'utf8')).toContain('From the panelr')

  // With a selection the library also shows an "add" tile; clear it first.
  await page.mouse.click(880, 600)
  await page.getByRole('tab').nth(1).click()
  const units = page.locator('.library-unit')
  await expect(units).toHaveCount(1)

  await page.reload()
  await page.waitForSelector('.excalidraw')
  await page.getByRole('tab').nth(1).click()
  await expect(units).toHaveCount(1)
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

test('Save asks for a name for an untitled autosave, moves it there, then saves in place', async () => {
  const dir = path.join(tmp, 'profile', 'Documents', 'Tabula')
  await inNewWindow(() => call('new_drawing'))
  await call('add_elements', { elements: [{ type: 'text', x: 0, y: 0, text: 'Needs a name' }] })
  await expect(page.locator('.titlebar-name')).toContainText('Untitled 20', { ignoreCase: true, timeout: 10_000 })
  const untitled = readdirSync(dir).filter((f) => readFileSync(path.join(dir, f), 'utf8').includes('Needs a name'))
  expect(untitled).toHaveLength(1)

  const named = path.join(tmp, 'Named board.excalidraw.md')
  await stubSaveDialog(named)
  await sendCommand('save')
  await expect.poll(() => existsSync(named) && readFileSync(named, 'utf8')).toContain('Needs a name')
  await expect(page.locator('.titlebar-name')).toContainText('Named board', { ignoreCase: true })
  expect(await saveDialogCalls()).toBe(1)
  // Moved, not copied: the timestamped autosave file goes.
  await expect.poll(() => existsSync(path.join(dir, untitled[0]))).toBe(false)

  // Named now: Save writes in place without asking again.
  await call('add_elements', { elements: [{ type: 'text', x: 0, y: 100, text: 'Saved in place' }] })
  await sendCommand('save')
  await expect.poll(() => readFileSync(named, 'utf8')).toContain('Saved in place')
  expect(await saveDialogCalls()).toBe(1)

  // A file of the user's that only looks like an autosave is theirs: Save
  // writes it in place, and nothing deletes it.
  const lookalike = path.join(dir, 'Untitled 2026-01-01 10.00.excalidraw.md')
  writeFileSync(lookalike, readFileSync(named, 'utf8'))
  await inNewWindow(() => call('open_file', { path: lookalike }))
  await call('add_elements', { elements: [{ type: 'text', x: 0, y: 200, text: 'Still mine' }] })
  await sendCommand('save')
  await expect.poll(() => readFileSync(lookalike, 'utf8')).toContain('Still mine')
  expect(await saveDialogCalls()).toBe(1)
})

// Last: it closes the window.
test('untitled work autosaves to Documents/Tabula, and closing saves the last edit', async () => {
  const dir = path.join(tmp, 'profile', 'Documents', 'Tabula')
  const draftWith = (text: string) => () =>
    existsSync(dir) &&
    readdirSync(dir).some((f) => readFileSync(path.join(dir, f), 'utf8').includes(text))

  await inNewWindow(() => call('new_drawing'))
  await call('add_elements', { elements: [{ type: 'text', x: 0, y: 0, text: 'Autosaved draft' }] })
  await expect.poll(draftWith('Autosaved draft'), { timeout: 10_000 }).toBe(true)
  await expect(page.locator('.titlebar-name')).toContainText('Untitled 20', { ignoreCase: true })

  // Closed before autosave's pause is up: the close itself saves the edit.
  await call('add_elements', { elements: [{ type: 'text', x: 0, y: 100, text: 'Saved on close' }] })
  const edited = () =>
    app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isDocumentEdited() ?? false, winId)
  await expect.poll(edited).toBe(true)
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), winId)
  await expect.poll(draftWith('Saved on close'), { timeout: 10_000 }).toBe(true)
})

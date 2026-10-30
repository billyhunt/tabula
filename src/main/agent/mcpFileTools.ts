import { app, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  exportInput,
  newDrawingInput,
  openFileInput,
  parseToolArgs,
  renderedPdf,
  renderedText,
  saveInput,
  WINDOW_NOT_BLANK,
} from '../../shared/agentTools'
import type { AgentToolResult } from '../../shared/ipc'
import { writePdf } from '../exports'
import { windowOnFile } from '../windows'
import type { BlankWindow } from './blankWindow'
import { callCanvasTool } from './bridge'
import { checkExportPath, checkOpenPath, checkSavePath } from './mcpChecks'

/**
 * The MCP tools that touch files. Main checks the agent's paths and does the
 * file IO; the window only does scene work, through bridge-only tools. Each
 * handler validates its arguments before asking for a window, so a bad call
 * never opens one.
 */
export interface ToolWindows {
  /** The window agents act on now. */
  current: () => Promise<BrowserWindow>
  /** A window with nothing in it for a drawing of its own; `fresh` insists on a new one. */
  blank: (options?: { fresh?: boolean }) => Promise<BlankWindow>
}

/**
 * `open_file` and `new_drawing` calls run one at a time, so a second call for
 * the same file finds the first one's window instead of opening the file
 * twice, and a new drawing never shares a window a file is being opened into.
 */
let windowQueue: Promise<unknown> = Promise.resolve()

const inWindowQueue = <T>(work: () => Promise<T>): Promise<T> => {
  const run = windowQueue.then(work)
  windowQueue = run.catch(() => undefined)
  return run
}

const openFile = async (args: unknown, windows: ToolWindows): Promise<AgentToolResult> => {
  const { path: requested } = parseToolArgs('open_file', openFileInput, args)
  const target = await checkOpenPath(requested)
  // Two windows on one file would autosave over each other.
  const already = windowOnFile(target)
  if (already) {
    already.show()
    already.focus()
    return { text: `${path.basename(target)} is already open; brought its window to the front` }
  }
  const contents = await readFile(target, 'utf8')
  // The drawing that is open stays as it is: this one gets a window of its
  // own. Loading through the bridge (rather than a pending file the window
  // fetches) means the agent's next call already sees the new drawing.
  const openIn = async (slot: BlankWindow) => {
    try {
      await callCanvasTool(slot.win, 'loadFile', { path: target, contents }, 60_000)
    } catch (err) {
      // A file that would not load must not leave an empty window behind.
      if (slot.created && !slot.win.isDestroyed()) slot.win.close()
      throw err
    }
    return slot
  }
  let slot: BlankWindow
  try {
    slot = await openIn(await windows.blank())
  } catch (err) {
    // The window was blank a moment ago but has a drawing now: leave it be.
    if (!(err instanceof Error && err.message === WINDOW_NOT_BLANK)) throw err
    slot = await openIn(await windows.blank({ fresh: true }))
  }
  // The window reports its file as its title a moment after loading. Wait for
  // it, so the next queued call finds this window by that file.
  const deadline = Date.now() + 3_000
  while (!slot.win.isDestroyed() && slot.win.getRepresentedFilename() !== target && Date.now() < deadline) {
    await sleep(20)
  }
  app.addRecentDocument(target)
  return { text: `Opened ${path.basename(target)} in ${slot.created ? 'a new' : 'an empty'} window` }
}

type FileTool = (args: unknown, windows: ToolWindows) => Promise<AgentToolResult>

export const FILE_TOOLS: Record<string, FileTool> = {
  export: async (args, windows) => {
    const { format, path: requested, overwrite = false, dark } = parseToolArgs('export', exportInput, args)
    const target = await checkExportPath(format, requested, overwrite)
    const rendered = await callCanvasTool(await windows.current(), 'renderExport', { format, dark }, 120_000)
    // 'wx' keeps the no-overwrite promise even if the file appeared meanwhile.
    const flag = overwrite ? 'w' : 'wx'
    let warnings: string[] = []
    if (format === 'pdf') {
      await writePdf(renderedPdf.parse(rendered.json).pages, target, flag)
    } else if (format === 'png') {
      if (!rendered.image) throw new Error('The drawing could not be rendered')
      await writeFile(target, Buffer.from(rendered.image.base64, 'base64'), { flag })
    } else {
      const output = renderedText.parse(rendered.json)
      await writeFile(target, output.text, { encoding: 'utf8', flag })
      warnings = output.warnings
    }
    const notes = warnings.length ? `\nWarnings: ${warnings.join('; ')}` : ''
    return { text: `Exported ${format.toUpperCase()} to ${target}${notes}` }
  },

  open_file: (args, windows) => inWindowQueue(() => openFile(args, windows)),

  save: async (args, windows) => {
    const { path: requested } = parseToolArgs('save', saveInput, args)
    const target = requested === undefined ? undefined : await checkSavePath(requested)
    const result = await callCanvasTool(await windows.current(), 'saveDocument', { path: target }, 60_000)
    if (target) app.addRecentDocument(target)
    return result
  },

  new_drawing: async (args, windows) => {
    parseToolArgs('new_drawing', newDrawingInput, args)
    const { created } = await inWindowQueue(() => windows.blank())
    return { text: created ? 'Started a new drawing in a new window' : 'Started a new drawing in the empty window' }
  },
}

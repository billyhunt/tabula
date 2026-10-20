import { app, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
import { claimFile, releaseClaim, windowOnFile } from '../windows'
import { callCanvasTool } from './bridge'
import { checkExportPath, checkOpenPath, checkSavePath } from './mcpChecks'

/**
 * The MCP tools that touch files. Main checks the agent's paths and does the
 * file IO; the window only does scene work, through bridge-only tools. Each
 * handler validates its arguments before asking for a window, so a bad call
 * never opens one.
 */
export interface BlankWindow {
  win: BrowserWindow
  /** True when the window was opened for this call. */
  created: boolean
}

export interface ToolWindows {
  /** The window agents act on now. */
  current: () => Promise<BrowserWindow>
  /** A window with nothing in it for a drawing of its own; `fresh` insists on a new one. */
  blank: (options?: { fresh?: boolean }) => Promise<BlankWindow>
}

/**
 * `open_file` calls run one at a time, so a second call for the same file
 * finds the first one's window (or its claim on one) instead of opening the
 * file twice.
 */
let openQueue: Promise<unknown> = Promise.resolve()

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
  // own. Loading through the bridge (rather than the fileOpened event) means
  // the agent's next call already sees the new drawing.
  const openIn = async (slot: BlankWindow) => {
    claimFile(slot.win, target)
    try {
      await callCanvasTool(slot.win, 'loadFile', { path: target, contents }, 60_000)
    } catch (err) {
      releaseClaim(slot.win)
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

  open_file: (args, windows) => {
    const run = openQueue.then(() => openFile(args, windows))
    openQueue = run.catch(() => undefined)
    return run
  },

  save: async (args, windows) => {
    const { path: requested } = parseToolArgs('save', saveInput, args)
    const target = requested === undefined ? undefined : await checkSavePath(requested)
    const result = await callCanvasTool(await windows.current(), 'saveDocument', { path: target }, 60_000)
    if (target) app.addRecentDocument(target)
    return result
  },

  new_drawing: async (args, windows) => {
    parseToolArgs('new_drawing', newDrawingInput, args)
    const { created } = await windows.blank()
    return { text: created ? 'Started a new drawing in a new window' : 'Started a new drawing in the empty window' }
  },
}

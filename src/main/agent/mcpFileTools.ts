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
} from '../../shared/agentTools'
import type { AgentToolResult } from '../../shared/ipc'
import { writePdf } from '../exports'
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
  /** A window with nothing in it for a drawing of its own; `created` if it is new. */
  blank: () => Promise<{ win: BrowserWindow; created: boolean }>
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

  open_file: async (args, windows) => {
    const { path: requested } = parseToolArgs('open_file', openFileInput, args)
    const target = await checkOpenPath(requested)
    const contents = await readFile(target, 'utf8')
    // The drawing that is open stays as it is: this one gets a window of its
    // own. Loading through the bridge (rather than the fileOpened event)
    // means the agent's next call already sees the new drawing.
    const { win, created } = await windows.blank()
    try {
      await callCanvasTool(win, 'loadFile', { path: target, contents }, 60_000)
    } catch (err) {
      // A file that would not load must not leave an empty window behind.
      if (created && !win.isDestroyed()) win.close()
      throw err
    }
    app.addRecentDocument(target)
    return { text: `Opened ${path.basename(target)} in ${created ? 'a new' : 'an empty'} window` }
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

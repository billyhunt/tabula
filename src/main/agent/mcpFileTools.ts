import { app, type BrowserWindow } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  exportInput,
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
type FileTool = (args: unknown, window: () => Promise<BrowserWindow>) => Promise<AgentToolResult>

export const FILE_TOOLS: Record<string, FileTool> = {
  export: async (args, window) => {
    const { format, path: requested, overwrite = false, dark } = parseToolArgs('export', exportInput, args)
    const target = await checkExportPath(format, requested, overwrite)
    const rendered = await callCanvasTool(await window(), 'renderExport', { format, dark }, 120_000)
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

  open_file: async (args, window) => {
    const { path: requested, discardChanges } = parseToolArgs('open_file', openFileInput, args)
    const target = await checkOpenPath(requested)
    const contents = await readFile(target, 'utf8')
    // Loading through the bridge (rather than the fileOpened event) means the
    // agent's next call already sees the new drawing. The window refuses if
    // the drawing has unsaved changes, unless told to discard them.
    await callCanvasTool(await window(), 'loadFile', { path: target, contents, discardChanges }, 60_000)
    app.addRecentDocument(target)
    return { text: `Opened ${path.basename(target)}` }
  },

  save: async (args, window) => {
    const { path: requested } = parseToolArgs('save', saveInput, args)
    const target = requested === undefined ? undefined : await checkSavePath(requested)
    const result = await callCanvasTool(await window(), 'saveDocument', { path: target }, 60_000)
    if (target) app.addRecentDocument(target)
    return result
  },
}

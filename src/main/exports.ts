import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  type FileFilter,
  type WebContents,
} from 'electron'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { Channels, type ExportFormat, type PdfPage } from '../shared/ipc'
import { saveDialogPath } from './files'

const FILTERS: Record<ExportFormat | 'pdf', FileFilter> = {
  png: { name: 'PNG Image', extensions: ['png'] },
  svg: { name: 'SVG Image', extensions: ['svg'] },
  mermaid: { name: 'Mermaid Diagram', extensions: ['mmd'] },
  pdf: { name: 'PDF Document', extensions: ['pdf'] },
}

// A bare file name: the renderer suggests names, it doesn't choose folders.
const suggestedName = z
  .string()
  .min(1)
  .max(255)
  .refine((name) => !name.includes('/') && !name.includes('\\'), 'Expected a file name')

const exportSaveRequest = z.discriminatedUnion('format', [
  z.object({ format: z.literal('png'), suggestedName, data: z.instanceof(Uint8Array) }),
  z.object({ format: z.enum(['svg', 'mermaid']), suggestedName, data: z.string() }),
])

const pdfPage = z.object({
  svg: z.string().min(1),
  width: z.number().positive().finite(),
  height: z.number().positive().finite(),
})

const exportPdfRequest = z.object({ suggestedName, pages: z.array(pdfPage).min(1) })

const askSavePath = async (sender: WebContents, name: string, filter: FileFilter) => {
  const win = BrowserWindow.fromWebContents(sender)
  const options = { defaultPath: saveDialogPath(name), filters: [filter] }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

/**
 * The page document for printing: each SVG on a page of its own, sized to it
 * through a CSS named page. Sizes round up so rounding never spills a sliver
 * of a drawing onto an extra blank page.
 */
const pdfHtml = (pages: readonly PdfPage[]) => {
  const pageStyles = pages.map((page, i) => {
    const size = `${Math.ceil(page.width)}px ${Math.ceil(page.height)}px`
    return `@page p${i} { size: ${size}; margin: 0 }\n.p${i} { page: p${i}; width: ${Math.ceil(page.width)}px; height: ${Math.ceil(page.height)}px }`
  })
  const bodies = pages.map(
    (page, i) => `<div class="page p${i}">${page.svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '')}</div>`,
  )
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<style>
html, body { margin: 0; padding: 0 }
.page { overflow: hidden; break-inside: avoid }
.page + .page { break-before: page }
.page > svg { display: block; width: 100%; height: 100% }
${pageStyles.join('\n')}
</style>
</head>
<body>
${bodies.join('\n')}
</body>
</html>
`
}

/**
 * Prints SVG pages to a PDF. Chromium prints SVG as vector paths and real
 * text, so the PDF stays sharp and searchable.
 */
export const writePdf = async (pages: PdfPage[], filePath: string): Promise<void> => {
  // A file rather than a data: URL, which Chromium caps at 2 MB — embedded
  // fonts and images easily pass that.
  const htmlPath = path.join(app.getPath('temp'), `tabula-pdf-${randomUUID()}.html`)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  try {
    await writeFile(htmlPath, pdfHtml(pages), 'utf8')
    await win.loadFile(htmlPath)
    // Inlined fonts decode asynchronously; printing before they're ready
    // would set the text in a fallback font.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    await writeFile(filePath, pdf)
  } finally {
    win.destroy()
    await rm(htmlPath, { force: true })
  }
}

export const registerExportIpc = () => {
  ipcMain.handle(Channels.exportSave, async (event, payload: unknown) => {
    const request = exportSaveRequest.parse(payload)
    const filePath = await askSavePath(event.sender, request.suggestedName, FILTERS[request.format])
    if (!filePath) return null
    await writeFile(filePath, request.data)
    return filePath
  })

  ipcMain.handle(Channels.exportPdf, async (event, payload: unknown) => {
    const request = exportPdfRequest.parse(payload)
    const filePath = await askSavePath(event.sender, request.suggestedName, FILTERS.pdf)
    if (!filePath) return null
    await writePdf(request.pages, filePath)
    return filePath
  })

  // Electron 44's clipboard is the async, W3C-style one: no writeImage.
  ipcMain.handle(Channels.clipboardImage, async (_event, payload: unknown) => {
    const png = z.instanceof(Uint8Array).parse(payload)
    const image = new Blob([png], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': image })])
  })

  ipcMain.handle(Channels.clipboardText, async (_event, payload: unknown) => {
    await clipboard.writeText(z.string().parse(payload))
  })
}

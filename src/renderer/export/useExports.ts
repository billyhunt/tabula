import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { DocumentController } from '../document'
import { useMenuCommand } from '../menuCommands'
import { toMermaid } from '../mermaid/toMermaid'
import { exportScope, renderPdfPages, renderPng, renderSvg } from './render'

/** "Board" for ~/Vault/Board.excalidraw.md; "Untitled" before the first save. */
const exportBaseName = (filePath: string | null) =>
  filePath
    ?.split('/')
    .pop()
    ?.replace(/(\.excalidraw\.md|\.excalidraw|\.md)$/i, '') || 'Untitled'

/**
 * The Export, Copy As and Import Mermaid menu commands. Exports cover the
 * selection when there is one, else the whole board, and report in a toast.
 */
export const useExports = (api: ExcalidrawImperativeAPI | null, doc: DocumentController) => {
  /** Runs an export unless the canvas is empty; `action` returns the toast text. */
  const run = (action: (api: ExcalidrawImperativeAPI, name: string) => Promise<string | null>) => {
    if (!api) return
    if (!api.getSceneElements().length) {
      api.setToast({ message: 'Nothing to export: the canvas is empty.' })
      return
    }
    action(api, exportBaseName(doc.filePath)).then(
      (message) => {
        if (message) api.setToast({ message, closable: true, duration: 5000 })
      },
      (err: unknown) => {
        console.error(err)
        const reason = err instanceof Error ? err.message : String(err)
        api.setToast({ message: `Export failed: ${reason}`, closable: true, duration: 8000 })
      },
    )
  }

  const saved = (path: string | null) => (path ? `Saved ${path.split('/').pop()}` : null)

  const mermaid = (api: ExcalidrawImperativeAPI) => {
    const result = toMermaid(exportScope(api, true).elements)
    return { text: `${result.mermaid}\n`, notes: result.warnings.join(' ') }
  }

  useMenuCommand('export-png', () =>
    run(async (api, name) =>
      saved(
        await window.tabula.exports.save({
          format: 'png',
          suggestedName: `${name}.png`,
          data: await renderPng(api, { selectionOnly: true, scale: 2 }),
        }),
      ),
    ),
  )

  useMenuCommand('export-svg', () =>
    run(async (api, name) =>
      saved(
        await window.tabula.exports.save({
          format: 'svg',
          suggestedName: `${name}.svg`,
          data: await renderSvg(api, { selectionOnly: true }),
        }),
      ),
    ),
  )

  const exportPdf = (perFrame: boolean) =>
    run(async (api, name) =>
      saved(
        await window.tabula.exports.savePdf({
          suggestedName: `${name}.pdf`,
          pages: await renderPdfPages(api, { perFrame, selectionOnly: true }),
        }),
      ),
    )
  useMenuCommand('export-pdf', () => exportPdf(false))
  useMenuCommand('export-pdf-frames', () => exportPdf(true))

  useMenuCommand('export-mermaid', () =>
    run(async (api, name) => {
      const { text, notes } = mermaid(api)
      const path = await window.tabula.exports.save({
        format: 'mermaid',
        suggestedName: `${name}.mmd`,
        data: text,
      })
      return path ? `${saved(path)}. ${notes}`.trim() : null
    }),
  )

  useMenuCommand('copy-png', () =>
    run(async (api) => {
      await window.tabula.exports.copyImage(await renderPng(api, { selectionOnly: true, scale: 2 }))
      return 'Copied as PNG'
    }),
  )

  useMenuCommand('copy-svg', () =>
    run(async (api) => {
      await window.tabula.exports.copyText(await renderSvg(api, { selectionOnly: true }))
      return 'Copied as SVG'
    }),
  )

  useMenuCommand('copy-mermaid', () =>
    run(async (api) => {
      const { text, notes } = mermaid(api)
      await window.tabula.exports.copyText(text)
      return `Copied as Mermaid. ${notes}`.trim()
    }),
  )

  // Excalidraw's Text to diagram dialog, opened on its Mermaid tab.
  useMenuCommand('import-mermaid', () =>
    api?.updateScene({ appState: { openDialog: { name: 'ttd', tab: 'mermaid' } } }),
  )
}

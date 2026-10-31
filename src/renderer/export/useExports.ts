import { useEffect } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { DocumentController } from '../document'
import { useMenuCommand } from '../menuCommands'
import { toMermaid } from '../mermaid/toMermaid'
import { exportScope, renderPdfPages, renderPng, renderSvg } from './render'

/** The "Only selected" switch in Excalidraw's Export image dialog. */
const ONLY_SELECTED = 'input[name="exportOnlySelected"]'

/** "Board" for ~/Vault/Board.excalidraw.md; "Untitled" before the first save. */
const exportBaseName = (filePath: string | null) =>
  filePath
    ?.split('/')
    .pop()
    ?.replace(/(\.excalidraw\.md|\.excalidraw|\.md)$/i, '') || 'Untitled'

/**
 * The Export, Copy As and Import Mermaid menu commands. They cover the whole
 * board, never just the selection, and report in a toast. Excalidraw's Export
 * image dialog (⇧⌘E) opens covering the whole board too, with its "Only
 * selected" switch there to narrow it.
 */
export const useExports = (api: ExcalidrawImperativeAPI | null, doc: DocumentController) => {
  // Excalidraw switches "Only selected" on by itself whenever something is
  // selected, and agents leave what they add selected, so a dialog opened over
  // a few selected shapes exported just those. The dialog offers no option for
  // its starting state; switch it off as it appears.
  useEffect(() => {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          const input = node.matches(ONLY_SELECTED) ? node : node.querySelector(ONLY_SELECTED)
          if (input instanceof HTMLInputElement && input.checked) input.click()
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

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
    const result = toMermaid(exportScope(api).elements)
    return { text: `${result.mermaid}\n`, notes: result.warnings.join(' ') }
  }

  useMenuCommand('export-png', () =>
    run(async (api, name) =>
      saved(
        await window.tabula.exports.save({
          format: 'png',
          suggestedName: `${name}.png`,
          data: await renderPng(api, { scale: 2 }),
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
          data: await renderSvg(api),
        }),
      ),
    ),
  )

  const exportPdf = (perFrame: boolean) =>
    run(async (api, name) =>
      saved(
        await window.tabula.exports.savePdf({
          suggestedName: `${name}.pdf`,
          pages: await renderPdfPages(api, { perFrame }),
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
      await window.tabula.exports.copyImage(await renderPng(api, { scale: 2 }))
      return 'Copied as PNG'
    }),
  )

  useMenuCommand('copy-svg', () =>
    run(async (api) => {
      await window.tabula.exports.copyText(await renderSvg(api))
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

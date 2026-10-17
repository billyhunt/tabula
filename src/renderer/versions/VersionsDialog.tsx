import { useCallback, useEffect, useRef, useState } from 'react'
import { exportToSvg, getNonDeletedElements, loadFromBlob } from '@excalidraw/excalidraw'
import type { DrawingVersion } from '../../shared/ipc'
import type { DocumentController } from '../document'
import { isObsidianMarkdown, parseObsidian } from '../format/obsidian'
import { useMenuCommand } from '../menuCommands'
import { useSystemTheme } from '../useSystemTheme'

/**
 * While the dialog is open, every keydown goes to it and nowhere else.
 *
 * Excalidraw listens on window in the capture phase for some shortcuts (the
 * command palette, search), and listeners on one target run in registration
 * order. Registering here, when this module is first imported and before the
 * editor mounts, is the only way to run ahead of those and stop them.
 */
let trapKeys: ((event: KeyboardEvent) => void) | null = null
window.addEventListener(
  'keydown',
  (event) => {
    if (!trapKeys) return
    event.stopImmediatePropagation()
    trapKeys(event)
  },
  true,
)

const relativeTime = (epochMs: number): string => {
  const seconds = Math.round((Date.now() - epochMs) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Small drawings would otherwise all read "0.0 KB". */
const formatBytes = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Renders a version's file contents the way the canvas would show them. */
const renderPreview = async (contents: string, formatPath: string, dark: boolean) => {
  const json = isObsidianMarkdown(formatPath)
    ? JSON.stringify(parseObsidian(contents).scene)
    : contents
  const scene = await loadFromBlob(new Blob([json], { type: 'application/json' }), null, null)
  return exportToSvg({
    elements: getNonDeletedElements(scene.elements),
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: dark },
    files: scene.files,
    // The editor has already loaded its fonts into this document, so the
    // inline SVG can use them without the cost of embedding.
    skipInliningFonts: true,
  })
}

type Listing =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; versions: DrawingVersion[] }

type Preview =
  | { state: 'loading'; id: string }
  | { state: 'error'; id: string; message: string }
  | { state: 'ready'; id: string; contents: string; svg: SVGSVGElement }

/** File › Browse Versions…: past states of the open drawing, restorable. */
export const VersionsDialog = ({ doc }: { doc: DocumentController }) => {
  const [open, setOpen] = useState(false)
  const [listing, setListing] = useState<Listing>({ state: 'loading' })
  const [selected, setSelected] = useState(0)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const theme = useSystemTheme()
  const dialogRef = useRef<HTMLDivElement>(null)
  const previewHost = useRef<HTMLDivElement>(null)
  const selectedRow = useRef<HTMLButtonElement>(null)
  // Where focus was before opening, so closing hands the keyboard back to
  // the canvas rather than to <body>.
  const returnFocus = useRef<Element | null>(null)

  const filePath = doc.filePath
  const versions = listing.state === 'ready' ? listing.versions : []
  const current = versions[selected]

  useMenuCommand('browse-versions', () => {
    if (open) return
    returnFocus.current = document.activeElement
    setListing({ state: 'loading' })
    setSelected(0)
    setPreview(null)
    setRestoreError(null)
    setOpen(true)
  })

  const close = useCallback(() => {
    setOpen(false)
    const target = returnFocus.current
    if (target instanceof HTMLElement) target.focus()
  }, [])

  // Lists versions each time the dialog opens; a save while it is closed may
  // have added one.
  useEffect(() => {
    if (!open || !filePath) return
    let live = true
    window.tabula.versions
      .list(filePath)
      .then((list) => live && setListing({ state: 'ready', versions: list }))
      .catch((err: unknown) => live && setListing({ state: 'error', message: errorText(err) }))
    return () => {
      live = false
    }
  }, [open, filePath])

  useEffect(() => {
    if (!open || !filePath || !current) return
    let live = true
    const { id } = current
    setPreview({ state: 'loading', id })
    window.tabula.versions
      .read(filePath, id)
      .then(async (contents) => {
        const svg = await renderPreview(contents, filePath, theme === 'dark')
        if (live) setPreview({ state: 'ready', id, contents, svg })
      })
      .catch((err: unknown) => live && setPreview({ state: 'error', id, message: errorText(err) }))
    return () => {
      live = false
    }
  }, [open, filePath, current, theme])

  // exportToSvg hands back a DOM node, which React cannot render as a child.
  useEffect(() => {
    const host = previewHost.current
    if (!host) return
    host.replaceChildren(...(preview?.state === 'ready' ? [preview.svg] : []))
  }, [preview])

  // Focus follows the selection, so Enter and Space act on the row in view.
  // Until there are rows, the dialog itself holds focus to keep it off the
  // canvas behind.
  useEffect(() => {
    if (!open) return
    const row = selectedRow.current
    if (!row) {
      dialogRef.current?.focus()
      return
    }
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }, [open, selected, listing])

  const restore = useCallback(async () => {
    if (!filePath || !current) return
    setRestoreError(null)
    try {
      const contents =
        preview?.state === 'ready' && preview.id === current.id
          ? preview.contents
          : await window.tabula.versions.read(filePath, current.id)
      // Not a write: the restored drawing is unsaved and undoable, and saving
      // it snapshots the file it replaces, so nothing here is lost.
      await doc.restore(contents, filePath)
      close()
    } catch (err) {
      setRestoreError(errorText(err))
    }
  }, [filePath, current, preview, doc, close])

  useEffect(() => {
    if (!open) return
    trapKeys = (event) => {
      const last = versions.length - 1
      const move = (index: number) => {
        event.preventDefault()
        setSelected(Math.max(0, Math.min(last, index)))
      }
      switch (event.key) {
        case 'Escape':
          event.preventDefault()
          close()
          break
        case 'ArrowDown':
          move(selected + 1)
          break
        case 'ArrowUp':
          move(selected - 1)
          break
        case 'Home':
          move(0)
          break
        case 'End':
          move(last)
          break
        case 'Enter':
          // Enter on a focused button already clicks it.
          if (event.target instanceof HTMLButtonElement && !event.target.closest('.versions-list')) {
            break
          }
          event.preventDefault()
          void restore()
          break
        case 'Tab': {
          // Keeps focus inside the dialog rather than wandering to the
          // toolbar behind it.
          const buttons = [...(dialogRef.current?.querySelectorAll('button') ?? [])]
          const first = buttons[0]
          const final = buttons.at(-1)
          const active = document.activeElement
          if (!first || !final) break
          if (event.shiftKey && (active === first || active === dialogRef.current)) {
            event.preventDefault()
            final.focus()
          } else if (!event.shiftKey && active === final) {
            event.preventDefault()
            first.focus()
          }
          break
        }
      }
    }
    return () => {
      trapKeys = null
    }
  }, [open, versions.length, selected, close, restore])

  if (!open) return null

  const name = filePath ? (filePath.split('/').pop() ?? filePath) : 'Untitled'

  return (
    <div className="versions-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="versions-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="versions-title"
      >
        <header className="versions-header">
          <h2 id="versions-title">Versions</h2>
          <span className="versions-file">{name}</span>
        </header>

        {!filePath ? (
          <p className="versions-empty">
            Versions start once this drawing is saved. Each later save keeps the state it
            replaces.
          </p>
        ) : listing.state === 'loading' ? (
          <p className="versions-empty">Loading…</p>
        ) : listing.state === 'error' ? (
          <p className="versions-empty">Couldn’t read the history: {listing.message}</p>
        ) : versions.length === 0 ? (
          <p className="versions-empty">
            No earlier versions yet. One is kept each time a save replaces this file.
          </p>
        ) : (
          <div className="versions-body">
            <div className="versions-list" role="listbox" aria-label="Versions">
              {versions.map((version, index) => (
                <button
                  key={version.id}
                  ref={index === selected ? selectedRow : undefined}
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  className={`versions-row${index === selected ? ' is-selected' : ''}`}
                  onClick={() => setSelected(index)}
                  onDoubleClick={() => void restore()}
                >
                  <span className="versions-relative">{relativeTime(version.savedAt)}</span>
                  <span className="versions-meta">
                    <span>
                      {new Date(version.savedAt).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                    <span>{formatBytes(version.bytes)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="versions-preview">
              <div ref={previewHost} className="versions-preview-image" />
              {preview?.state === 'loading' && <p className="versions-note">Rendering…</p>}
              {preview?.state === 'error' && (
                <p className="versions-note">Couldn’t preview this version: {preview.message}</p>
              )}
            </div>
          </div>
        )}

        {restoreError && <p className="versions-error">Couldn’t restore: {restoreError}</p>}

        <footer className="versions-footer">
          <button type="button" className="versions-button" onClick={close}>
            Close
          </button>
          {filePath && versions.length > 0 && (
            <button
              type="button"
              className="versions-button is-primary"
              onClick={() => void restore()}
            >
              Restore
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

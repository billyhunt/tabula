import { useEffect } from 'react'

/**
 * Escape closes the topmost Excalidraw dialog even when focus is not in it.
 *
 * Excalidraw's dialogs close on an Escape keydown that reaches them, so only
 * while focus is inside. Exporting from the Export image dialog (PNG, SVG,
 * Copy to clipboard) drops focus to the page body, and Escape went to the
 * canvas instead; a failed export opens an error dialog on top while focus
 * stays on the export button, and Escape closed the dialog underneath. This
 * hands such an Escape to the topmost dialog, which closes the way it always
 * does.
 *
 * Focus in anything else, such as Settings open on top of the dialog or the
 * chat box, keeps its own Escape. The listener is a window capture listener
 * added after the editor mounts, so Excalidraw's window listeners added at
 * mount run before it.
 */
export const useDialogEscape = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Untrusted: the copy dispatched below, on its way to the dialog.
      if (event.key !== 'Escape' || !event.isTrusted) return
      const dialogs = [...document.querySelectorAll('.excalidraw-modal-container .Modal')]
      const top = dialogs.at(-1)
      const active = document.activeElement
      if (!top || top.contains(active)) return
      // Nothing has focus (the page, or the editor around the canvas), or a
      // dialog underneath does.
      const focusLost = !active || active === document.body || active.matches('.excalidraw-container')
      if (!focusLost && !dialogs.some((dialog) => dialog.contains(active))) return
      // The canvas and the dialogs underneath never see this one.
      event.stopImmediatePropagation()
      event.preventDefault()
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

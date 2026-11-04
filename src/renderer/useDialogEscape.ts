import { useEffect } from 'react'

/**
 * Escape closes an open Excalidraw dialog even when focus has left it.
 *
 * Excalidraw's dialogs close on an Escape keydown that reaches them, so only
 * while focus is inside. Exporting from the Export image dialog (PNG, SVG,
 * Copy to clipboard) drops focus to the page body, and Escape went to the
 * canvas instead. This hands such an Escape to the dialog, which closes the
 * way it always does.
 */
export const useDialogEscape = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Untrusted: the copy dispatched below, on its way to the dialog.
      if (event.key !== 'Escape' || !event.isTrusted || event.defaultPrevented) return
      const dialog = document.querySelector('.excalidraw-modal-container .Modal')
      if (!dialog || dialog.contains(document.activeElement)) return
      // Capture phase on window: the canvas never sees this one.
      event.stopImmediatePropagation()
      event.preventDefault()
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

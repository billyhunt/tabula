import { useEffect } from 'react'

/** Nothing has focus: the page itself, or the editor around the canvas. */
const focusIsLost = () => {
  const active = document.activeElement
  return !active || active === document.body || active.matches('.excalidraw-container')
}

/**
 * Escape closes an open Excalidraw dialog even when focus has left it.
 *
 * Excalidraw's dialogs close on an Escape keydown that reaches them, so only
 * while focus is inside. Exporting from the Export image dialog (PNG, SVG,
 * Copy to clipboard) drops focus to the page body, and Escape went to the
 * canvas instead. This hands such an Escape to the topmost dialog, which
 * closes the way it always does.
 *
 * Only when focus is lost: focus in anything else, such as Settings open on
 * top of the dialog or the chat box, keeps its own Escape. The listener is a
 * window capture listener added after the editor mounts, so Excalidraw's own
 * window listeners run before it.
 */
export const useDialogEscape = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Untrusted: the copy dispatched below, on its way to the dialog.
      if (event.key !== 'Escape' || !event.isTrusted || !focusIsLost()) return
      const dialog = [...document.querySelectorAll('.excalidraw-modal-container .Modal')].at(-1)
      if (!dialog) return
      // The canvas never sees this one.
      event.stopImmediatePropagation()
      event.preventDefault()
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

import { useEffect, useRef, type RefObject } from 'react'
import { hashElementsVersion } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { DocumentController } from '../document'

/** How long editing must pause before the drawing is written. */
const IDLE_MS = 2000

/** The Autosave setting, kept current; a ref because timers read it later. */
export const useAutosaveEnabled = (): RefObject<boolean> => {
  const enabled = useRef(false)
  useEffect(() => {
    let live = true
    void window.tabula.settings.get().then((settings) => {
      if (live) enabled.current = settings.autosave
    })
    const unsubscribe = window.tabula.settings.onChange((settings) => {
      enabled.current = settings.autosave
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return enabled
}

/**
 * Saves the open drawing once editing settles, and whenever the window is
 * about to close. A drawing that was never saved gets a file of its own in
 * Documents/Tabula (see `DocumentController.flush`), so no dialog interrupts
 * the work and nothing drawn is lost.
 *
 * Every write snapshots what it replaces (see main/versions.ts), so nothing
 * autosave does is unrecoverable -- that is what makes saving without being
 * asked defensible.
 *
 * Takes the editor API as well as the document because `doc` only changes
 * identity when the dirty flag flips; the pause has to be measured from the
 * last edit, which only the editor's change feed reports.
 */
export const useAutosave = (
  doc: DocumentController,
  api: ExcalidrawImperativeAPI | null,
  enabled: RefObject<boolean>,
) => {
  // Read at fire time: the timer outlives many renders.
  const docRef = useRef(doc)
  docRef.current = doc

  // Main asks before the window closes; answer with what was saved.
  useEffect(
    () =>
      window.tabula.onFlushRequest(async () => {
        try {
          return (await docRef.current.flush())
            ? { ok: true }
            : { ok: false, error: null }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    [],
  )

  useEffect(() => {
    if (!api) return
    let timer: number | undefined
    // onChange also fires for selection, scrolling and hover; only element
    // changes count as editing.
    let lastHash = hashElementsVersion(api.getSceneElementsIncludingDeleted())

    const fire = () => {
      if (!enabled.current) return
      docRef.current.flush().catch((err: unknown) => console.error('autosave failed:', err))
    }

    const unsubscribe = api.onChange((elements) => {
      const hash = hashElementsVersion(elements)
      if (hash === lastHash) return
      lastHash = hash
      window.clearTimeout(timer)
      timer = window.setTimeout(fire, IDLE_MS)
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [api, enabled])
}

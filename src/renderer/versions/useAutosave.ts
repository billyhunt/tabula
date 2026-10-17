import { useEffect, useRef } from 'react'
import { hashElementsVersion } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { DocumentController } from '../document'

/** How long editing must pause before the drawing is written. */
const IDLE_MS = 2000

/**
 * Saves the open drawing once editing settles.
 *
 * Only ever touches a drawing that already has a path: an untitled one would
 * need a Save dialog, and throwing one of those at someone mid-stroke is worse
 * than leaving it unsaved.
 *
 * Every write snapshots what it replaces (see main/versions.ts), so nothing
 * autosave does is unrecoverable -- that is what makes saving without being
 * asked defensible.
 *
 * Takes the editor API as well as the document because `doc` only changes
 * identity when the dirty flag flips; the pause has to be measured from the
 * last edit, which only the editor's change feed reports.
 */
export const useAutosave = (doc: DocumentController, api: ExcalidrawImperativeAPI | null) => {
  // Read at fire time: the timer outlives many renders.
  const docRef = useRef(doc)
  docRef.current = doc
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

  useEffect(() => {
    if (!api) return
    let timer: number | undefined
    let saving = false
    // An edit whose pause ended mid-save; it gets its own save afterwards.
    let pending = false
    // onChange also fires for selection, scrolling and hover; only element
    // changes count as editing.
    let lastHash = hashElementsVersion(api.getSceneElementsIncludingDeleted())

    const fire = () => {
      const { filePath, dirty, save } = docRef.current
      if (!enabled.current || !filePath || !dirty) return
      if (saving) {
        pending = true
        return
      }
      saving = true
      save()
        .catch((err: unknown) => console.error('autosave failed:', err))
        .finally(() => {
          saving = false
          if (pending) {
            pending = false
            schedule()
          }
        })
    }

    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(fire, IDLE_MS)
    }

    const unsubscribe = api.onChange((elements) => {
      const hash = hashElementsVersion(elements)
      if (hash === lastHash) return
      lastHash = hash
      schedule()
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [api])
}

import { useEffect } from 'react'
import { MIME_TYPES, useHandleLibrary } from '@excalidraw/excalidraw'
import type { LibraryPersistenceAdapter } from '@excalidraw/excalidraw/data/library'
import type { ExcalidrawImperativeAPI, LibraryItems } from '@excalidraw/excalidraw/types'

/** Where tabula://library links land: libraries.excalidraw.com returns here. */
export const LIBRARY_RETURN_URL = 'tabula://library'

// Module-level, as Excalidraw asks: a new adapter object reloads the library.
const adapter: LibraryPersistenceAdapter = {
  load: async () => {
    const items = await window.tabula.library.load()
    // Excalidraw wrote these via `save`, and restores whatever it loads.
    return items ? { libraryItems: items as LibraryItems } : null
  },
  save: ({ libraryItems }) => window.tabula.library.save(libraryItems),
}

/**
 * Keeps the editor's library in userData (shared by every window, surviving
 * restarts) and adds libraries installed from libraries.excalidraw.com.
 */
export const useLibrary = (api: ExcalidrawImperativeAPI | null) => {
  useHandleLibrary({ excalidrawAPI: api, adapter })

  // Another window changed the library: show the same.
  useEffect(() => {
    if (!api) return
    return window.tabula.library.onChanged((items) => {
      // Items main stored from Excalidraw's own save; it restores them on update.
      const libraryItems = items as LibraryItems
      void api.updateLibrary({ libraryItems, merge: false })
    })
  }, [api])

  // Libraries from the browser. Excalidraw asks before adding one unless this
  // editor opened "Browse libraries" itself (the token is its id).
  useEffect(() => {
    if (!api) return
    const take = async () => {
      for (const { json, token } of await window.tabula.library.takeInstalls()) {
        await api
          .updateLibrary({
            libraryItems: new Blob([json], { type: MIME_TYPES.excalidrawlib }),
            merge: true,
            prompt: token !== api.id,
            openLibraryMenu: true,
            defaultStatus: 'published',
          })
          .catch((err: unknown) => console.error('library install failed:', err))
      }
    }
    void take()
    return window.tabula.library.onInstallReady(() => void take())
  }, [api])
}

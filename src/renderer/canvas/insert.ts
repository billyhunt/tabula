import {
  CaptureUpdateAction,
  getCommonBounds,
  newElementWith,
  restoreElements,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

/**
 * Adds new elements to the scene as one undoable step and selects them.
 * The group moves as a whole (labels and arrows keep their shapes): with a
 * point, its top-left lands there; by default it is centred in the viewport.
 * Elements need ids the scene doesn't have yet (`regenerateIds`). Returns the
 * elements as placed.
 */
export const placeElements = (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
  files: BinaryFiles | null,
  at: { x: number; y: number } | 'viewport-center' = 'viewport-center',
): ExcalidrawElement[] => {
  const incoming = elements.filter((e) => !e.isDeleted)
  if (!incoming.length) return []
  const scene = api.getSceneElementsIncludingDeleted()
  const sceneIds = new Set(scene.map((e) => e.id))
  if (incoming.some((e) => sceneIds.has(e.id))) {
    throw new Error('placeElements needs elements with ids that are new to the scene')
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(incoming)
  let target = at
  if (target === 'viewport-center') {
    const appState = api.getAppState()
    const center = viewportCoordsToSceneCoords(
      {
        clientX: appState.offsetLeft + appState.width / 2,
        clientY: appState.offsetTop + appState.height / 2,
      },
      appState,
    )
    target = { x: center.x - (maxX - minX) / 2, y: center.y - (maxY - minY) / 2 }
  }
  const dx = target.x - minX
  const dy = target.y - minY
  // Dropping the indices lets restore give the newcomers fractional indices
  // after the existing elements; the scene rejects clashing ones.
  const moved = incoming.map((e) => newElementWith(e, { x: e.x + dx, y: e.y + dy, index: null }))
  const movedIds = new Set(moved.map((e) => e.id))
  const placed = restoreElements([...scene, ...moved], null).filter((e) => movedIds.has(e.id))

  if (files) api.addFiles(Object.values(files))
  api.updateScene({
    elements: [...scene, ...placed],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  // Not an undo step of its own: selection changes ride along with the next
  // undoable change.
  api.selection.select(placed)
  return placed
}

import {
  CaptureUpdateAction,
  getCommonBounds,
  getVisibleSceneBounds,
  newElementWith,
  restoreElements,
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

/**
 * Applies changed elements and adds new ones (on top) as one undo step.
 * Returns the new elements as they landed in the scene.
 */
export const commitChanges = (
  api: ExcalidrawImperativeAPI,
  changed: readonly ExcalidrawElement[],
  added: readonly ExcalidrawElement[] = [],
): ExcalidrawElement[] => {
  const replacements = new Map(changed.map((e) => [e.id, e]))
  const scene = api.getSceneElementsIncludingDeleted().map((e) => replacements.get(e.id) ?? e)
  let placed: ExcalidrawElement[] = []
  if (added.length) {
    // Dropping the indices lets restore give the newcomers fractional indices
    // after the existing elements; the scene rejects clashing ones.
    const fresh = added.map((e) => newElementWith(e, { index: null }))
    const freshIds = new Set(fresh.map((e) => e.id))
    placed = restoreElements([...scene, ...fresh], null).filter((e) => freshIds.has(e.id))
  }
  api.updateScene({
    elements: [...scene, ...placed],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  return placed
}

/** Scrolls (zooming out if needed) so the elements are in view, unless they already are. */
export const revealElements = (
  api: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
) => {
  if (!elements.length) return
  const bounds = getCommonBounds(elements)
  const state = api.getAppState()
  const [left, top, right, bottom] = getVisibleSceneBounds(state)
  // The part of the canvas the toolbar, panels and docked chat don't cover,
  // in scene units.
  const inset = api.getViewportOffsets()
  const zoom = state.zoom.value
  const inView =
    bounds[0] >= left + (inset.left ?? 0) / zoom &&
    bounds[1] >= top + (inset.top ?? 0) / zoom &&
    bounds[2] <= right - (inset.right ?? 0) / zoom &&
    bounds[3] <= bottom - (inset.bottom ?? 0) / zoom
  if (!inView) api.setViewport({ target: bounds, fit: 'scale-down', animation: true, offsets: { ui: true } })
}

/** What to select so the user sees `elements`: labels select through their shape. */
export const selectable = (elements: readonly ExcalidrawElement[]) =>
  elements.filter((e) => !(e.type === 'text' && e.containerId))

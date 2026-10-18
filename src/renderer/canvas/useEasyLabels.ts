import { useEffect } from 'react'
import { viewportCoordsToSceneCoords } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { labelTargetAt } from './labelTarget'

/**
 * Double-clicking anywhere inside a shape types into that shape.
 *
 * Excalidraw only does this near the centre of an unfilled shape; elsewhere
 * inside, it drops loose text at the pointer. When labelTargetAt finds such a
 * shape, the double-click is taken over: the shape is selected and Enter is
 * sent, which is Excalidraw's own "edit this shape's label" command, so the
 * label editor is Excalidraw's and behaves exactly as usual. ⌥ double-click
 * still drops loose text where you click.
 */
export const useEasyLabels = (api: ExcalidrawImperativeAPI | null) => {
  useEffect(() => {
    if (!api) return
    const onDoubleClick = (event: MouseEvent) => {
      const canvas = event.target
      if (!(canvas instanceof HTMLCanvasElement) || !canvas.closest('.excalidraw')) return
      if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      const state = api.getAppState()
      if (
        state.activeTool.type !== 'selection' ||
        state.viewModeEnabled ||
        state.editingTextElement ||
        state.selectedLinearElement?.isEditing
      ) {
        return
      }
      const { x, y } = viewportCoordsToSceneCoords(event, state)
      const target = labelTargetAt(api.getSceneElements(), x, y, state.zoom.value)
      if (!target) return
      // Capture phase on window: Excalidraw's own handler never sees it.
      event.stopImmediatePropagation()
      event.preventDefault()
      api.updateScene({ appState: { selectedElementIds: { [target.id]: true } } })
      // Enter goes to the selection, so wait for the selection to render.
      requestAnimationFrame(() => {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })
    }
    window.addEventListener('dblclick', onDoubleClick, true)
    return () => window.removeEventListener('dblclick', onDoubleClick, true)
  }, [api])
}

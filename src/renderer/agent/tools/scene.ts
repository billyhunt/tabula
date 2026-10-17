import { getVisibleSceneBounds } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

// Two decimals is finer than anyone can see and keeps the JSON short.
const round = (n: number) => Math.round(n * 100) / 100

/**
 * One element as an agent needs it: geometry, text, style and how it is
 * connected. Leaves out what is empty or default and all bookkeeping (seeds,
 * versions, indices).
 */
const describeElement = (e: ExcalidrawElement, labels: ReadonlyMap<string, string>) => {
  const out: Record<string, unknown> = {
    id: e.id,
    type: e.type,
    x: round(e.x),
    y: round(e.y),
    width: round(e.width),
    height: round(e.height),
  }
  if (e.angle) out.angle = round(e.angle)
  if (e.type === 'text') {
    out.text = e.originalText || e.text
    out.fontSize = e.fontSize
    if (e.containerId) out.containerId = e.containerId
  }
  const label = labels.get(e.id)
  if (label !== undefined) out.label = label
  if (e.type === 'frame' || e.type === 'magicframe') out.name = e.name
  out.strokeColor = e.strokeColor
  out.backgroundColor = e.backgroundColor
  out.fillStyle = e.fillStyle
  out.strokeStyle = e.strokeStyle
  out.strokeWidth = e.strokeWidth
  if (e.roughness !== 1) out.roughness = e.roughness
  if (e.opacity !== 100) out.opacity = e.opacity
  if (e.roundness) out.roundness = e.roundness
  if (e.frameId) out.frameId = e.frameId
  if (e.groupIds.length) out.groupIds = e.groupIds
  if (e.boundElements?.length) out.boundElementIds = e.boundElements.map((b) => b.id)
  if (e.type === 'arrow' || e.type === 'line') {
    out.points = e.points.map(([x, y]) => [round(x), round(y)])
    if (e.startBinding) out.startBoundId = e.startBinding.elementId
    if (e.endBinding) out.endBoundId = e.endBinding.elementId
    if ('elbowed' in e && e.elbowed) out.elbowed = true
  }
  if (e.link) out.link = e.link
  if (e.locked) out.locked = true
  return out
}

export const describeScene = (
  api: ExcalidrawImperativeAPI,
  doc: { filePath: string | null; dirty: boolean },
) => {
  const elements = api.getSceneElements()
  const appState = api.getAppState()
  const labels = new Map<string, string>()
  for (const e of elements) {
    if (e.type === 'text' && e.containerId) labels.set(e.containerId, e.originalText || e.text)
  }
  const [left, top, right, bottom] = getVisibleSceneBounds(appState)
  return {
    filePath: doc.filePath,
    dirty: doc.dirty,
    selectedIds: Object.keys(appState.selectedElementIds).filter(
      (id) => appState.selectedElementIds[id],
    ),
    viewport: {
      x: round(left),
      y: round(top),
      width: round(right - left),
      height: round(bottom - top),
      zoom: round(appState.zoom.value),
    },
    elements: elements.map((e) => describeElement(e, labels)),
  }
}

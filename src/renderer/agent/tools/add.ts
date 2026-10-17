import { convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ElementSkeletonInput } from '../../../shared/agentTools'
import type { AgentToolResult } from '../../../shared/ipc'
import { placeElements } from '../../canvas/insert'
import { commitChanges, revealElements, selectable } from './commit'
import { prepareSkeletons } from './skeletons'

const newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 20)

/** Lists placed elements compactly, so the agent needn't read the scene again. */
export const summarizePlaced = (elements: readonly ExcalidrawElement[]) =>
  elements.map((e) => ({
    id: e.id,
    type: e.type,
    x: Math.round(e.x),
    y: Math.round(e.y),
    width: Math.round(e.width),
    height: Math.round(e.height),
    ...(e.type === 'text' && e.containerId ? { containerId: e.containerId } : {}),
  }))

export const addElements = (
  api: ExcalidrawImperativeAPI,
  inputs: readonly ElementSkeletonInput[],
): AgentToolResult => {
  const scene = new Map(api.getSceneElements().map((e) => [e.id, e]))
  const prepared = prepareSkeletons(inputs, scene, newId)
  const converted = convertToExcalidrawElements(prepared.skeletons, { regenerateIds: false })
  const created = converted.filter((e) => !prepared.phantomIds.has(e.id))

  let placed: ExcalidrawElement[]
  if (!prepared.positioned) {
    placed = placeElements(api, created, null)
  } else {
    // Existing elements that new arrows connect to learn about those arrows
    // from their stand-ins.
    const connected = converted.flatMap((phantom) => {
      const real = prepared.phantomIds.has(phantom.id) ? scene.get(phantom.id) : undefined
      if (!real) return []
      const known = new Set(real.boundElements?.map((b) => b.id))
      const arrows = (phantom.boundElements ?? []).filter((b) => !known.has(b.id))
      return [newElementWith(real, { boundElements: [...(real.boundElements ?? []), ...arrows] })]
    })
    placed = commitChanges(api, connected, created)
    api.selection.select(selectable(placed))
    revealElements(api, placed)
  }

  const count = selectable(placed).length
  return {
    text: `Added ${count} element${count === 1 ? '' : 's'}`,
    json: { idMap: prepared.idMap, elements: summarizePlaced(placed) },
  }
}

import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { LocalPoint, Radians } from '@excalidraw/excalidraw/math/types'
import type { ElementSkeletonInput, EndpointInput } from '../../../shared/agentTools'
import { withDefaultFont } from '../../canvas/defaultFont'

/**
 * Turns add_elements input into skeletons for `convertToExcalidrawElements`
 * (called with `regenerateIds: false`). Kept free of the Excalidraw runtime
 * so it can be tested in node.
 *
 * Every element gets a fresh id here, so caller ids never clash with the
 * scene and we know exactly which id each caller id became. Excalidraw only
 * binds arrows to elements converted in the same batch, so an arrow that
 * connects to an element already on the canvas gets a stand-in copy of that
 * element ("phantom") to bind to; the caller drops the phantoms afterwards and
 * copies their new arrow bindings onto the real elements.
 */
export interface PreparedSkeletons {
  skeletons: ExcalidrawElementSkeleton[]
  /** Caller id → scene id. */
  idMap: Record<string, string>
  /** Ids of the stand-ins for existing elements; not to be added. */
  phantomIds: Set<string>
  /** False when the caller gave no coordinates at all: place the group in view. */
  positioned: boolean
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

const DEFAULT_SIZE = 100
// Room between an arrow's tip and the shape it points at.
const ARROW_GAP = 4

/** Where the segment from `box`'s center toward `other`'s center leaves `box`, plus the gap. */
const edgePoint = (box: Box, other: Box) => {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const dx = other.x + other.width / 2 - cx
  const dy = other.y + other.height / 2 - cy
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return { x: cx, y: cy }
  const t = Math.min(
    dx ? box.width / 2 / Math.abs(dx) : Infinity,
    dy ? box.height / 2 / Math.abs(dy) : Infinity,
  )
  return {
    x: cx + dx * t + (dx / distance) * ARROW_GAP,
    y: cy + dy * t + (dy / distance) * ARROW_GAP,
  }
}

// Excalidraw brands its point tuples; the numbers are what it expects.
const toPoints = (points: number[][]) => points.map(([x, y]) => [x, y] as LocalPoint)

export const prepareSkeletons = (
  inputs: readonly ElementSkeletonInput[],
  scene: ReadonlyMap<string, ExcalidrawElement>,
  newId: () => string,
): PreparedSkeletons => {
  const idMap: Record<string, string> = {}
  for (const input of inputs) {
    if (input.id === undefined) continue
    if (input.id in idMap) throw new Error(`The id "${input.id}" is used by more than one element`)
    idMap[input.id] = newId()
  }

  // Boxes of the elements an arrow may connect to, for routing arrows the
  // caller gave no coordinates for.
  const boxes = new Map<string, Box>()
  for (const input of inputs) {
    if (input.id === undefined || input.x === undefined || input.y === undefined) continue
    if (input.type !== 'rectangle' && input.type !== 'ellipse' && input.type !== 'diamond') continue
    boxes.set(idMap[input.id], {
      x: input.x,
      y: input.y,
      width: input.width ?? DEFAULT_SIZE,
      height: input.height ?? DEFAULT_SIZE,
    })
  }

  const phantoms = new Map<string, ExcalidrawElementSkeleton>()
  const resolve = (id: string, where: string): string => {
    const own = idMap[id]
    if (own) return own
    const existing = scene.get(id)
    if (!existing || existing.isDeleted) throw new Error(`${where}: there is no element "${id}"`)
    if (!phantoms.has(id)) {
      const { x, y, width, height, angle } = existing
      switch (existing.type) {
        case 'text':
          phantoms.set(id, {
            type: 'text',
            id,
            x,
            y,
            text: existing.text,
            fontSize: existing.fontSize,
            fontFamily: existing.fontFamily,
          })
          break
        case 'rectangle':
        case 'ellipse':
        case 'diamond':
          phantoms.set(id, { type: existing.type, id, x, y, width, height, angle })
          break
        default:
          throw new Error(`${where}: arrows can't connect to the ${existing.type} "${id}"`)
      }
      boxes.set(id, { x, y, width, height })
    }
    return id
  }

  /** A new element at an arrow's end; Excalidraw places it by the arrow. */
  const newEndpoint = (end: EndpointInput) => {
    const { id: _, type, text, ...rest } = end
    if (type === 'text') return { ...rest, type, text: text ?? '' }
    return { ...rest, type: type ?? 'rectangle' }
  }

  const skeletons: ExcalidrawElementSkeleton[] = inputs.map((input, index) => {
    const id = input.id === undefined ? newId() : idMap[input.id]
    const where = `elements[${index}]`
    switch (input.type) {
      case 'rectangle':
      case 'ellipse':
      case 'diamond': {
        const { angle, ...rest } = input
        return { ...rest, id, x: input.x ?? 0, y: input.y ?? 0, angle: angle as Radians | undefined }
      }
      case 'text': {
        const { angle, ...rest } = input
        return { ...rest, id, x: input.x ?? 0, y: input.y ?? 0, angle: angle as Radians | undefined }
      }
      case 'line': {
        const { points, ...rest } = input
        return {
          ...rest,
          id,
          x: input.x ?? 0,
          y: input.y ?? 0,
          ...(points ? { points: toPoints(points) } : {}),
        }
      }
      case 'frame': {
        const children = (input.children ?? []).map((child) => {
          const mapped = idMap[child]
          if (!mapped) {
            throw new Error(
              `${where}.children: "${child}" must be an element created in the same call`,
            )
          }
          return mapped
        })
        return { ...input, id, children }
      }
      case 'arrow': {
        const { points, start, end, ...rest } = input
        const startId = start?.id === undefined ? undefined : resolve(start.id, `${where}.start`)
        const endId = end?.id === undefined ? undefined : resolve(end.id, `${where}.end`)
        let x = input.x
        let y = input.y
        let route = points ? toPoints(points) : undefined
        // Connected at both ends but not placed: run straight between them.
        const from = startId === undefined ? undefined : boxes.get(startId)
        const to = endId === undefined ? undefined : boxes.get(endId)
        if (x === undefined && y === undefined && !route && from && to) {
          const a = edgePoint(from, to)
          const b = edgePoint(to, from)
          x = a.x
          y = a.y
          route = toPoints([
            [0, 0],
            [b.x - a.x, b.y - a.y],
          ])
        }
        return {
          ...rest,
          id,
          x: x ?? 0,
          y: y ?? 0,
          ...(route ? { points: route } : {}),
          ...(start ? { start: startId === undefined ? newEndpoint(start) : { id: startId } } : {}),
          ...(end ? { end: endId === undefined ? newEndpoint(end) : { id: endId } } : {}),
        }
      }
    }
  })

  return {
    // New text takes Tabula's font; stand-ins keep their element's.
    skeletons: [...skeletons.map(withDefaultFont), ...phantoms.values()],
    idMap,
    phantomIds: new Set(phantoms.keys()),
    positioned:
      phantoms.size > 0 || inputs.some((input) => input.x !== undefined || input.y !== undefined),
  }
}

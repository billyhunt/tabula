import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform'
import type { LocalPoint } from '@excalidraw/excalidraw/math/types'

/**
 * Mermaid's decision diamonds are too narrow for Excalidraw, which wraps a
 * diamond's label to half the diamond's width: labels broke mid-word
 * ("Shar / p?"). These widen each such diamond about its centre and pull the
 * arrows that met its old outline back onto the new one.
 */

/** Excalidraw's gap between a container's edge and its label. */
const BOUND_TEXT_PADDING = 5

/** Width of the widest word of `text` at `fontSize`, as Excalidraw draws it. */
export type MeasureWidestWord = (text: string, fontSize: number) => number

interface Diamond {
  cx: number
  cy: number
  /** Half-width and half-height. */
  a: number
  b: number
}

type Point = [number, number]

/** Below 1 inside the diamond, 1 on its outline, above 1 outside. */
const diamondDistance = (d: Diamond, [x, y]: Point) => Math.abs(x - d.cx) / d.a + Math.abs(y - d.cy) / d.b

/**
 * Moves `end`, which lies inside the diamond, back along the segment from
 * `from` to where that segment crosses the outline.
 */
const toOutline = (d: Diamond, from: Point, end: Point): Point => {
  if (diamondDistance(d, end) >= 1 || diamondDistance(d, from) <= 1) return end
  let outside = 0
  let inside = 1
  for (let i = 0; i < 24; i++) {
    const t = (outside + inside) / 2
    const p: Point = [from[0] + (end[0] - from[0]) * t, from[1] + (end[1] - from[1]) * t]
    if (diamondDistance(d, p) < 1) inside = t
    else outside = t
  }
  return [from[0] + (end[0] - from[0]) * outside, from[1] + (end[1] - from[1]) * outside]
}

/**
 * Mermaid's arrows end exactly on the outline it drew. After a diamond is
 * widened those ends sit inside it, and conversion keeps the points as given,
 * so each end bound to a widened diamond is pulled back to the new outline.
 */
const reanchorArrows = (elements: ExcalidrawElementSkeleton[], widened: ReadonlyMap<string, Diamond>) =>
  elements.map((element) => {
    if (element.type !== 'arrow' || !element.points || element.points.length < 2) return element
    const startDiamond = element.start && 'id' in element.start && element.start.id ? widened.get(element.start.id) : undefined
    const endDiamond = element.end && 'id' in element.end && element.end.id ? widened.get(element.end.id) : undefined
    if (!startDiamond && !endDiamond) return element
    const absolute: Point[] = element.points.map(([px, py]) => [element.x + px, element.y + py])
    const last = absolute.length - 1
    if (startDiamond) absolute[0] = toOutline(startDiamond, absolute[1], absolute[0])
    if (endDiamond) absolute[last] = toOutline(endDiamond, absolute[last - 1], absolute[last])
    const [x, y] = absolute[0]
    // LocalPoint is a branded tuple; these are the arrow's own local points.
    const points = absolute.map(([px, py]) => [px - x, py - y] as LocalPoint)
    return { ...element, x, y, points }
  })

/** Widens diamonds whose labels would wrap mid-word, keeping arrows on their outlines. */
export const fitDiamonds = (
  elements: ExcalidrawElementSkeleton[],
  widestWord: MeasureWidestWord,
): ExcalidrawElementSkeleton[] => {
  const widened = new Map<string, Diamond>()
  const fitted = elements.map((element) => {
    if (element.type !== 'diamond' || !element.label?.text || element.width === undefined) return element
    const needed = 2 * (widestWord(element.label.text, element.label.fontSize ?? 20) + BOUND_TEXT_PADDING * 2) + 4
    if (element.width >= needed) return element
    const x = element.x - (needed - element.width) / 2
    if (element.id && element.height !== undefined) {
      widened.set(element.id, { cx: x + needed / 2, cy: element.y + element.height / 2, a: needed / 2, b: element.height / 2 })
    }
    return { ...element, x, width: needed }
  })
  return widened.size ? reanchorArrows(fitted, widened) : fitted
}

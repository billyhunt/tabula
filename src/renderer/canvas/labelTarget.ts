import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

/**
 * Which shape a double-click should put a label in, when Excalidraw itself
 * would not.
 *
 * Excalidraw only treats a double-click inside an unfilled, unlabelled shape
 * as "type in this shape" when it lands within about 30px of the centre or on
 * the outline. Anywhere else inside, it drops loose text at the pointer, which
 * reads as the box refusing to take text. Filled shapes, shapes that already
 * have a label, and double-clicks on text, arrows or images already behave,
 * so for those this returns null and Excalidraw handles the click.
 */

type Shape = 'rectangle' | 'ellipse' | 'diamond'

const SHAPES: Record<string, Shape> = { rectangle: 'rectangle', ellipse: 'ellipse', diamond: 'diamond' }

/** Pointer slop around lines and arrows, in screen pixels. */
const LINE_SLOP_PX = 8

/** The point in the element's unrotated frame, relative to its centre. */
const toLocal = (e: ExcalidrawElement, x: number, y: number) => {
  const cx = e.x + e.width / 2
  const cy = e.y + e.height / 2
  const cos = Math.cos(-e.angle)
  const sin = Math.sin(-e.angle)
  const dx = x - cx
  const dy = y - cy
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos }
}

const insideShape = (shape: Shape, e: ExcalidrawElement, x: number, y: number) => {
  const { dx, dy } = toLocal(e, x, y)
  const a = e.width / 2
  const b = e.height / 2
  if (a <= 0 || b <= 0) return false
  if (shape === 'rectangle') return Math.abs(dx) <= a && Math.abs(dy) <= b
  if (shape === 'ellipse') return (dx / a) ** 2 + (dy / b) ** 2 <= 1
  return Math.abs(dx) / a + Math.abs(dy) / b <= 1
}

const insideBox = (e: ExcalidrawElement, x: number, y: number, pad = 0) => {
  const { dx, dy } = toLocal(e, x, y)
  return Math.abs(dx) <= e.width / 2 + pad && Math.abs(dy) <= e.height / 2 + pad
}

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const vx = bx - ax
  const vy = by - ay
  const lengthSq = vx * vx + vy * vy
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq)) : 0
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy))
}

/** Whether the pointer is on a line, arrow or freehand stroke. */
const onStroke = (e: ExcalidrawElement, x: number, y: number, slop: number) => {
  if (!('points' in e) || e.points.length < 2) return insideBox(e, x, y, slop)
  // Rotated strokes are rare; treat their whole box as "on it" and let
  // Excalidraw decide.
  if (e.angle) return insideBox(e, x, y, slop)
  for (let i = 1; i < e.points.length; i++) {
    const [ax, ay] = e.points[i - 1]
    const [bx, by] = e.points[i]
    if (distanceToSegment(x, y, e.x + ax, e.y + ay, e.x + bx, e.y + by) <= slop) return true
  }
  return false
}

const isTransparent = (color: string) =>
  color === 'transparent' || /^#[0-9a-f]{6}00$/i.test(color) || /^#[0-9a-f]{3}0$/i.test(color)

/**
 * The innermost unfilled, unlabelled shape under (x, y) in scene coordinates
 * whose label Excalidraw would not start on its own; null when something
 * Excalidraw already handles is under the pointer.
 */
export const labelTargetAt = (
  elements: readonly ExcalidrawElement[],
  x: number,
  y: number,
  zoom: number,
): ExcalidrawElement | null => {
  const slop = LINE_SLOP_PX / zoom
  let target: ExcalidrawElement | null = null
  // Topmost first, as the pointer sees the drawing.
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]
    if (e.isDeleted) continue
    const shape = SHAPES[e.type]
    if (!shape) {
      if (e.type === 'frame' || e.type === 'magicframe') continue
      const hit =
        e.type === 'arrow' || e.type === 'line' || e.type === 'freedraw'
          ? onStroke(e, x, y, slop)
          : insideBox(e, x, y)
      // Text, an arrow, an image: Excalidraw's own double-click is right.
      if (hit) return null
      continue
    }
    if (!insideShape(shape, e, x, y)) continue
    const labelled = e.boundElements?.some((b) => b.type === 'text') ?? false
    if (e.locked || labelled || !isTransparent(e.backgroundColor)) {
      // A shape Excalidraw already types into. If it sits inside the
      // candidate, it's what the user is pointing at.
      if (!target || e.width * e.height < target.width * target.height) return null
      return target
    }
    if (!target || e.width * e.height < target.width * target.height) target = e
  }
  return target
}

import { describe, expect, it } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { labelTargetAt } from '../src/renderer/canvas/labelTarget'

// Just the fields the hit test reads.
const el = (fields: Record<string, unknown>) =>
  ({
    angle: 0,
    backgroundColor: 'transparent',
    isDeleted: false,
    locked: false,
    boundElements: null,
    ...fields,
  }) as unknown as ExcalidrawElement

const shape = (id: string, type: string, x: number, y: number, w: number, h: number, extra = {}) =>
  el({ id, type, x, y, width: w, height: h, ...extra })

const at = (elements: ExcalidrawElement[], x: number, y: number) =>
  labelTargetAt(elements, x, y, 1)?.id ?? null

describe('labelTargetAt', () => {
  const box = shape('box', 'rectangle', 0, 0, 200, 100)

  it('finds an empty unfilled box anywhere inside it, not just the centre', () => {
    expect(at([box], 10, 10)).toBe('box')
    expect(at([box], 190, 95)).toBe('box')
    expect(at([box], 100, 50)).toBe('box')
    expect(at([box], 210, 50)).toBeNull()
  })

  it('follows the real outline of ellipses and diamonds, not their bounding box', () => {
    const ellipse = shape('ellipse', 'ellipse', 0, 0, 200, 100)
    const diamond = shape('diamond', 'diamond', 0, 0, 200, 100)
    expect(at([ellipse], 100, 10)).toBe('ellipse')
    expect(at([ellipse], 8, 8)).toBeNull()
    expect(at([diamond], 100, 20)).toBe('diamond')
    expect(at([diamond], 20, 20)).toBeNull()
  })

  it('accounts for rotation', () => {
    // A 200x20 bar turned upright: its old horizontal extent is now outside.
    const bar = shape('bar', 'rectangle', 0, 40, 200, 20, { angle: Math.PI / 2 })
    expect(at([bar], 100, 0)).toBe('bar')
    expect(at([bar], 10, 50)).toBeNull()
  })

  it("leaves shapes Excalidraw already types into to Excalidraw", () => {
    const filled = shape('filled', 'rectangle', 0, 0, 200, 100, { backgroundColor: '#ffc9c9' })
    const labelled = shape('labelled', 'rectangle', 0, 0, 200, 100, {
      boundElements: [{ id: 't', type: 'text' }],
    })
    const locked = shape('locked', 'rectangle', 0, 0, 200, 100, { locked: true })
    expect(at([filled], 10, 10)).toBeNull()
    expect(at([labelled], 10, 10)).toBeNull()
    expect(at([locked], 10, 10)).toBeNull()
  })

  it('lets a double-click on text, an arrow or an image inside the box edit that instead', () => {
    const note = el({ id: 'note', type: 'text', x: 20, y: 20, width: 60, height: 20, containerId: null })
    const arrow = el({ id: 'arrow', type: 'arrow', x: 10, y: 80, width: 180, height: 0, points: [[0, 0], [180, 0]] })
    const image = shape('image', 'image', 120, 10, 40, 40)
    const scene = [box, note, arrow, image]
    expect(at(scene, 30, 25)).toBeNull()
    expect(at(scene, 100, 82)).toBeNull()
    expect(at(scene, 130, 20)).toBeNull()
    // Elsewhere inside the box is still the box.
    expect(at(scene, 100, 60)).toBe('box')
  })

  it('picks the innermost of nested empty shapes, whatever their order', () => {
    const inner = shape('inner', 'rectangle', 50, 25, 60, 40)
    expect(at([inner, box], 60, 30)).toBe('inner')
    expect(at([box, inner], 60, 30)).toBe('inner')
    expect(at([box, inner], 10, 10)).toBe('box')
  })

  it('defers to a filled shape sitting inside an empty one', () => {
    const swatch = shape('swatch', 'rectangle', 50, 25, 60, 40, { backgroundColor: '#a5d8ff' })
    expect(at([box, swatch], 60, 30)).toBeNull()
    expect(at([box, swatch], 10, 10)).toBe('box')
  })

  it('ignores deleted shapes and frames', () => {
    const gone = shape('gone', 'rectangle', 0, 0, 200, 100, { isDeleted: true })
    const frame = shape('frame', 'frame', -50, -50, 400, 300)
    expect(at([gone], 10, 10)).toBeNull()
    expect(at([frame, box], 10, 10)).toBe('box')
    expect(at([frame], 300, 200)).toBeNull()
  })
})

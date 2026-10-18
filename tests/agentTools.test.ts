import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
  addElementsInput,
  CANVAS_TOOLS,
  parseToolArgs,
  updateElementsInput,
  type ElementSkeletonInput,
} from '../src/shared/agentTools'
import { prepareSkeletons } from '../src/renderer/agent/tools/skeletons'
import { DEFAULT_FONT_FAMILY } from '../src/renderer/canvas/defaultFont'

const flowchart = {
  elements: [
    { type: 'rectangle', id: 'a', x: 0, y: 0, label: { text: 'Start' } },
    { type: 'diamond', id: 'b', x: 300, y: 0, width: 120, height: 80, label: { text: 'OK?' } },
    { type: 'arrow', id: 'ab', start: { id: 'a' }, end: { id: 'b' }, label: { text: 'next' } },
    { type: 'arrow', x: 0, y: 200, start: { type: 'ellipse' }, end: { type: 'text', text: 'Done' } },
    { type: 'frame', name: 'Flow', children: ['a', 'b', 'ab'] },
  ],
}

const errorOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error('expected an error')
}

describe('tool schemas', () => {
  it('accepts a skeleton with arrows bound by id and inline endpoints', () => {
    const parsed = parseToolArgs('add_elements', addElementsInput, flowchart)
    expect(parsed.elements).toHaveLength(5)
  })

  it('names the bad element type and the allowed ones', () => {
    const message = errorOf(() =>
      parseToolArgs('add_elements', addElementsInput, { elements: [{ type: 'circle' }] }),
    )
    expect(message).toMatch(/^Invalid arguments for add_elements: elements\[0\]\.type: /)
    expect(message).toContain('rectangle')
    expect(message.split('\n')).toHaveLength(1)
  })

  it('says which field is missing', () => {
    const message = errorOf(() =>
      parseToolArgs('update_elements', updateElementsInput, { updates: [{ x: 10 }] }),
    )
    expect(message).toBe('Invalid arguments for update_elements: updates[0].id is required.')
  })

  it('rejects an endpoint that both connects and creates', () => {
    const message = errorOf(() =>
      parseToolArgs('add_elements', addElementsInput, {
        elements: [{ type: 'arrow', start: { id: 'a', type: 'rectangle' } }],
      }),
    )
    expect(message).toContain('elements[0].start: give either id')
  })

  it('rejects unknown keys and updates that change nothing', () => {
    expect(
      errorOf(() =>
        parseToolArgs('add_elements', addElementsInput, {
          elements: [{ type: 'text', text: 'hi', colour: 'red' }],
        }),
      ),
    ).toContain('Unrecognized key: "colour"')
    expect(
      errorOf(() => parseToolArgs('update_elements', updateElementsInput, { updates: [{ id: 'a' }] })),
    ).toContain('give at least one property')
  })

  it('every tool input becomes an object JSON schema', () => {
    for (const tool of CANVAS_TOOLS) {
      const schema = z.toJSONSchema(tool.input, { io: 'input' })
      expect(schema.type, tool.name).toBe('object')
    }
    expect(new Set(CANVAS_TOOLS.map((t) => t.name)).size).toBe(CANVAS_TOOLS.length)
  })
})

describe('prepareSkeletons', () => {
  const ids = () => {
    let n = 0
    return () => `new${++n}`
  }
  const inputs = (value: unknown): ElementSkeletonInput[] =>
    parseToolArgs('add_elements', addElementsInput, value).elements

  it('gives caller ids fresh ids and rewrites every reference', () => {
    const prepared = prepareSkeletons(inputs(flowchart), new Map(), ids())
    expect(prepared.idMap).toEqual({ a: 'new1', b: 'new2', ab: 'new3' })
    const [, , arrow, , frame] = prepared.skeletons
    expect(arrow).toMatchObject({ id: 'new3', start: { id: 'new1' }, end: { id: 'new2' } })
    expect(frame).toMatchObject({ type: 'frame', children: ['new1', 'new2', 'new3'] })
    expect(prepared.positioned).toBe(true)
  })

  it('runs an unplaced arrow straight between the shapes it connects', () => {
    const prepared = prepareSkeletons(inputs(flowchart), new Map(), ids())
    const arrow = prepared.skeletons[2]
    if (arrow.type !== 'arrow') throw new Error('expected the arrow')
    // From the right edge of a (x 0–100, centre y 50) to the left edge of b
    // (x 300–420, centre y 40).
    expect(arrow.x).toBeCloseTo(104, 0)
    expect(arrow.y).toBeLessThan(50)
    const end = arrow.points?.[1]
    expect(end?.[0]).toBeCloseTo(300 - 4 - arrow.x, 0)
  })

  it('binds to an existing element through a stand-in', () => {
    const existing = {
      id: 'old',
      type: 'rectangle',
      x: 500,
      y: 500,
      width: 80,
      height: 40,
      angle: 0,
      isDeleted: false,
    } as unknown as ExcalidrawElement
    const prepared = prepareSkeletons(
      inputs({ elements: [{ type: 'arrow', x: 0, y: 0, end: { id: 'old' } }] }),
      new Map([['old', existing]]),
      ids(),
    )
    expect([...prepared.phantomIds]).toEqual(['old'])
    expect(prepared.skeletons[1]).toMatchObject({ type: 'rectangle', id: 'old', x: 500, width: 80 })
    expect(prepared.skeletons[0]).toMatchObject({ end: { id: 'old' } })
  })

  it("sets Tabula's font on new text, labels and arrow-end text, but not on stand-ins", () => {
    const existing = {
      id: 'old',
      type: 'text',
      x: 0,
      y: 0,
      text: 'Old',
      fontSize: 20,
      fontFamily: 5,
      isDeleted: false,
    } as unknown as ExcalidrawElement
    const prepared = prepareSkeletons(
      inputs({
        elements: [
          ...flowchart.elements.slice(0, 4),
          { type: 'text', x: 0, y: 400, text: 'Note' },
          { type: 'arrow', x: 0, y: 500, end: { id: 'old' } },
        ],
      }),
      new Map([['old', existing]]),
      ids(),
    )
    const [a, b, ab, loose, note, , old] = prepared.skeletons
    expect(a).toMatchObject({ label: { text: 'Start', fontFamily: DEFAULT_FONT_FAMILY } })
    expect(b).toMatchObject({ label: { fontFamily: DEFAULT_FONT_FAMILY } })
    expect(ab).toMatchObject({ label: { fontFamily: DEFAULT_FONT_FAMILY } })
    expect(loose).toMatchObject({ end: { type: 'text', text: 'Done', fontFamily: DEFAULT_FONT_FAMILY } })
    expect(note).toMatchObject({ type: 'text', fontFamily: DEFAULT_FONT_FAMILY })
    expect(old).toMatchObject({ id: 'old', fontFamily: 5 })
  })

  it('leaves placement to the caller when no coordinates are given', () => {
    const prepared = prepareSkeletons(
      inputs({ elements: [{ type: 'ellipse', label: { text: 'Idea' } }] }),
      new Map(),
      ids(),
    )
    expect(prepared.positioned).toBe(false)
  })

  it('reports duplicate ids, unknown references and foreign frame children', () => {
    expect(
      errorOf(() =>
        prepareSkeletons(
          inputs({ elements: [{ type: 'rectangle', id: 'x' }, { type: 'ellipse', id: 'x' }] }),
          new Map(),
          ids(),
        ),
      ),
    ).toBe('The id "x" is used by more than one element')
    expect(
      errorOf(() =>
        prepareSkeletons(
          inputs({ elements: [{ type: 'arrow', start: { id: 'ghost' } }] }),
          new Map(),
          ids(),
        ),
      ),
    ).toBe('elements[0].start: there is no element "ghost"')
    expect(
      errorOf(() =>
        prepareSkeletons(
          inputs({ elements: [{ type: 'frame', children: ['elsewhere'] }] }),
          new Map(),
          ids(),
        ),
      ),
    ).toContain('must be an element created in the same call')
  })
})

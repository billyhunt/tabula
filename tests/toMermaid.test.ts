import { describe, expect, it } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { toMermaid } from '../src/renderer/mermaid/toMermaid'

// Just the fields the serializer reads; the rest of an element doesn't matter.
const base = {
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roundness: null,
  isDeleted: false,
  frameId: null,
  boundElements: null,
  groupIds: [],
}

const el = (fields: Record<string, unknown>) => ({ ...base, ...fields }) as unknown as ExcalidrawElement

const box = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  el({ id, type: 'rectangle', x, y, width: 100, height: 60, ...extra })

const label = (id: string, containerId: string, text: string) =>
  el({ id, type: 'text', x: 0, y: 0, width: 10, height: 10, text, originalText: text, containerId })

const arrow = (id: string, from: string | null, to: string | null, extra: Record<string, unknown> = {}) =>
  el({
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    points: [],
    startBinding: from ? { elementId: from, fixedPoint: [0.5, 0.5], mode: 'orbit' } : null,
    endBinding: to ? { elementId: to, fixedPoint: [0.5, 0.5], mode: 'orbit' } : null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    ...extra,
  })

const lines = (elements: ExcalidrawElement[]) => toMermaid(elements).mermaid.split('\n')

describe('toMermaid', () => {
  it('declares labelled shapes and the arrow between them', () => {
    const { mermaid, warnings } = toMermaid([
      box('a', 0, 0),
      label('ta', 'a', 'Start'),
      el({ id: 'b', type: 'ellipse', x: 0, y: 200, width: 100, height: 60 }),
      label('tb', 'b', 'End'),
      arrow('ab', 'a', 'b'),
    ])
    expect(mermaid).toBe(['flowchart TD', '    n1["Start"]', '    n2(("End"))', '    n1 --> n2'].join('\n'))
    expect(warnings).toEqual([])
  })

  it('renders diamonds, rounded rectangles and unlabelled shapes', () => {
    expect(
      lines([
        el({ id: 'd', type: 'diamond', x: 0, y: 0, width: 100, height: 60 }),
        label('td', 'd', 'Ok?'),
        box('r', 200, 0, { roundness: { type: 3 } }),
        box('p', 400, 0),
      ]),
    ).toEqual(['flowchart TD', '    n1{"Ok?"}', '    n2(" ")', '    n3[" "]'])
  })

  it('escapes quotes and line breaks in labels', () => {
    expect(lines([box('a', 0, 0), label('t', 'a', 'Say "hi"\nthen go')])).toContain(
      '    n1["Say #quot;hi#quot;<br/>then go"]',
    )
  })

  it('numbers nodes in reading order, tolerating rough rows', () => {
    const out = lines([
      box('bottom', 0, 300),
      box('right', 300, 10),
      box('left', 0, 0),
      label('l1', 'bottom', 'C'),
      label('l2', 'right', 'B'),
      label('l3', 'left', 'A'),
    ])
    expect(out.slice(1)).toEqual(['    n1["A"]', '    n2["B"]', '    n3["C"]'])
  })

  it('chooses the operator from the arrowheads and reverses start-only arrows', () => {
    const out = lines([
      box('a', 0, 0),
      box('b', 0, 200),
      arrow('end', 'a', 'b'),
      arrow('both', 'a', 'b', { startArrowhead: 'arrow' }),
      arrow('none', 'a', 'b', { endArrowhead: null }),
      arrow('start', 'a', 'b', { startArrowhead: 'triangle', endArrowhead: null }),
    ])
    expect(out).toContain('    n1 --> n2')
    expect(out).toContain('    n1 <--> n2')
    expect(out).toContain('    n1 --- n2')
    expect(out).toContain('    n2 --> n1')
  })

  it('maps dashed, dotted and thick strokes', () => {
    const out = lines([
      box('a', 0, 0),
      box('b', 0, 200),
      arrow('dashed', 'a', 'b', { strokeStyle: 'dashed' }),
      arrow('dotted', 'a', 'b', { strokeStyle: 'dotted', endArrowhead: null }),
      arrow('thick', 'a', 'b', { strokeWidth: 4, startArrowhead: 'arrow' }),
    ])
    expect(out).toContain('    n1 -.-> n2')
    expect(out).toContain('    n1 -.- n2')
    expect(out).toContain('    n1 <==> n2')
  })

  it('labels edges with their bound text', () => {
    expect(
      lines([box('a', 0, 0), box('b', 0, 200), arrow('ab', 'a', 'b'), label('t', 'ab', 'yes')]),
    ).toContain('    n1 -->|"yes"| n2')
  })

  it('reads mostly horizontal flows left to right', () => {
    expect(lines([box('a', 0, 0), box('b', 300, 20), arrow('ab', 'a', 'b')])[0]).toBe('flowchart LR')
    expect(lines([box('a', 0, 0), box('b', 20, 300), arrow('ab', 'a', 'b')])[0]).toBe('flowchart TD')
  })

  it('wraps framed nodes in a subgraph', () => {
    const out = lines([
      el({ id: 'f', type: 'frame', x: -10, y: -10, width: 300, height: 100, name: 'Intake "A"' }),
      box('a', 0, 0, { frameId: 'f' }),
      box('b', 0, 300),
      arrow('ab', 'a', 'b'),
    ])
    expect(out).toEqual([
      'flowchart TD',
      '    subgraph f1["Intake #quot;A#quot;"]',
      '        n1[" "]',
      '    end',
      '    n2[" "]',
      '    n1 --> n2',
    ])
  })

  it('turns text joined by an arrow into a node', () => {
    const out = lines([
      el({ id: 't', type: 'text', x: 0, y: 0, width: 50, height: 20, text: 'Note', originalText: 'Note', containerId: null }),
      box('b', 0, 200),
      arrow('tb', 't', 'b'),
    ])
    expect(out).toEqual(['flowchart TD', '    n1["Note"]', '    n2[" "]', '    n1 --> n2'])
  })

  it('styles shapes with non-default colours only', () => {
    const out = lines([
      box('a', 0, 0, { backgroundColor: '#ffc9c9', strokeColor: '#e03131' }),
      box('b', 200, 0, { strokeColor: '#1E1E1E' }),
      box('c', 400, 0, { backgroundColor: '#a5d8ff' }),
    ])
    expect(out.filter((l) => l.includes('style'))).toEqual([
      '    style n1 fill:#ffc9c9,stroke:#e03131',
      '    style n3 fill:#a5d8ff',
    ])
  })

  it('drops what a flowchart cannot express and says so', () => {
    const { mermaid, warnings } = toMermaid([
      box('a', 0, 0),
      el({ id: 'f1', type: 'freedraw', x: 0, y: 0, width: 5, height: 5 }),
      el({ id: 'f2', type: 'freedraw', x: 0, y: 0, width: 5, height: 5 }),
      el({ id: 'loose', type: 'text', x: 0, y: 0, width: 5, height: 5, text: 'hi', originalText: 'hi', containerId: null }),
      arrow('dangling', 'a', null),
      label('t', 'dangling', 'lost'),
      box('gone', 0, 0, { isDeleted: true }),
    ])
    expect(mermaid).toBe('flowchart TD\n    n1[" "]')
    expect(warnings).toEqual([
      'Left out 2 freehand drawings: Mermaid has no equivalent.',
      "Left out 1 text element that isn't inside a shape or connected by an arrow.",
      "Left out 1 arrow that isn't connected to shapes at both ends.",
    ])
  })

  it('explains an empty canvas', () => {
    const { mermaid, warnings } = toMermaid([])
    expect(mermaid).toBe('flowchart TD')
    expect(warnings).toHaveLength(1)
  })

  it('explains when nothing could be converted', () => {
    const { mermaid, warnings } = toMermaid([el({ id: 'i', type: 'image', x: 0, y: 0, width: 5, height: 5 })])
    expect(mermaid).toBe('flowchart TD')
    expect(warnings[0]).toBe('Left out 1 image: Mermaid has no equivalent.')
    expect(warnings).toHaveLength(2)
  })
})

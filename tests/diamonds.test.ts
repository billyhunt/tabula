import { describe, expect, it } from 'vitest'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform'
import { fitDiamonds } from '../src/renderer/mermaid/diamonds'

// A monospace stand-in: 12px per character at 20px.
const widestWord = (text: string, fontSize: number) =>
  Math.max(...text.split(/\s+/).map((w) => w.length)) * fontSize * 0.6

const skeleton = (fields: Record<string, unknown>) => fields as unknown as ExcalidrawElementSkeleton

// A decision 100 wide centred at (150, 50), with arrows in and out along y = 50.
const diamond = (text: string) =>
  skeleton({ type: 'diamond', id: 'd', x: 100, y: 0, width: 100, height: 100, label: { text } })
const into = skeleton({ type: 'arrow', id: 'in', x: 0, y: 50, points: [[0, 0], [100, 0]], end: { id: 'd' } })
const outOf = skeleton({ type: 'arrow', id: 'out', x: 200, y: 50, points: [[0, 0], [100, 0]], start: { id: 'd' } })

const byId = (elements: ExcalidrawElementSkeleton[], id: string) => {
  const found = elements.find((e) => e.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found as unknown as { x: number; y: number; width: number; points: [number, number][] }
}

describe('fitDiamonds', () => {
  it('leaves a diamond whose label already fits alone', () => {
    const scene = [diamond('OK?'), into, outOf]
    expect(fitDiamonds(scene, widestWord)).toEqual(scene)
  })

  it('widens a diamond about its centre so its widest word fits on one line', () => {
    // "enough?" is 7 characters: 84px, plus padding, doubled for the diamond.
    const d = byId(fitDiamonds([diamond('Sharp enough?')], widestWord), 'd')
    expect(d.width).toBe(2 * (84 + 10) + 4)
    expect(d.x + d.width / 2).toBe(150)
  })

  it('pulls arrow ends that met the old outline back onto the new one', () => {
    const fitted = fitDiamonds([diamond('Sharp enough?'), into, outOf], widestWord)
    const d = byId(fitted, 'd')
    const incoming = byId(fitted, 'in')
    const outgoing = byId(fitted, 'out')
    // The incoming arrow now ends on the diamond's new left vertex…
    expect(incoming.x).toBe(0)
    expect(incoming.x + incoming.points[1][0]).toBeCloseTo(d.x, 3)
    // …and the outgoing one starts on its new right vertex, still ending where it did.
    expect(outgoing.x).toBeCloseTo(d.x + d.width, 3)
    expect(outgoing.x + outgoing.points[1][0]).toBe(300)
    expect(outgoing.points[0]).toEqual([0, 0])
  })
})

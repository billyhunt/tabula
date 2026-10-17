import LZString from 'lz-string'
import { describe, expect, it } from 'vitest'
import {
  NotADrawingError,
  parseObsidian,
  serializeObsidian,
  shortenTextIds,
  type SceneJson,
} from '../src/renderer/format/obsidian'

const LONG_TEXT_ID = 'aB3dE5fG7hI9jK1lM2nO3'
const BOX_ID = 'boxboxboxboxboxboxbox'
const ARROW_ID = 'arrowarrowarrowarrow1'

const scene = (): SceneJson => ({
  type: 'excalidraw',
  version: 2,
  source: 'tabula',
  elements: [
    {
      id: BOX_ID,
      type: 'rectangle',
      boundElements: [
        { id: LONG_TEXT_ID, type: 'text' },
        { id: ARROW_ID, type: 'arrow' },
      ],
    },
    { id: LONG_TEXT_ID, type: 'text', text: 'Hello\nworld', originalText: 'Hello world', containerId: BOX_ID },
    { id: ARROW_ID, type: 'arrow', startBinding: { elementId: BOX_ID, focus: 0, gap: 1 }, endBinding: null },
    { id: 'gone-gone-gone-gone-1', type: 'text', text: 'deleted', isDeleted: true },
  ],
  appState: { viewBackgroundColor: '#f2f0eb' },
  files: {},
})

// The shape the plugin writes, with compressed scene data chunked at 256.
const pluginFile = (data: SceneJson) => {
  const b64 = LZString.compressToBase64(JSON.stringify(data))
  const chunks = b64.match(/.{1,256}/g)!.join('\n\n')
  return `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

My notes about this drawing, linking [[Roadmap]].

# Excalidraw Data

## Text Elements
See [[Roadmap]] ^txt12345

## Element Links
box12345: [[Backlog]]

## Embedded Files
img12345: [[assets/diagram.png]]

%%
## Drawing
\`\`\`compressed-json
${chunks}
\`\`\`
%%`
}

describe('shortenTextIds', () => {
  it('gives text elements 8-char ids and rewrites every reference', () => {
    const out = shortenTextIds(scene().elements)
    const text = out.find((e) => e.type === 'text' && !e.isDeleted)!
    expect(text.id).toHaveLength(8)
    expect(out[0].boundElements![0].id).toBe(text.id)
    expect(out[0].boundElements![1].id).toBe(ARROW_ID)
    expect(text.containerId).toBe(BOX_ID)
  })

  it('is stable, so repeated saves do not churn the file', () => {
    expect(shortenTextIds(scene().elements)).toEqual(shortenTextIds(scene().elements))
  })

  it('rewrites arrow bindings that point at a text element', () => {
    const elements = [
      { id: LONG_TEXT_ID, type: 'text', text: 'x' },
      { id: ARROW_ID, type: 'arrow', endBinding: { elementId: LONG_TEXT_ID } },
    ]
    const [text, arrow] = shortenTextIds(elements)
    expect(arrow.endBinding!.elementId).toBe(text.id)
  })
})

describe('serializeObsidian', () => {
  it('writes the plugin layout with uncompressed json', () => {
    const md = serializeObsidian(scene())
    expect(md).toMatch(/^---\n\nexcalidraw-plugin: parsed\ntags: \[excalidraw\]\n\n---\n/)
    expect(md).toContain('# Excalidraw Data\n\n## Text Elements\n')
    expect(md).toMatch(/Hello world \^[\w]{8}\n\n%%\n## Drawing\n```json\n/)
    expect(md).not.toContain('deleted ^')
    expect(md.endsWith('```\n%%')).toBe(true)
  })

  it('round-trips through parseObsidian', () => {
    const { scene: back, envelope } = parseObsidian(serializeObsidian(scene()))
    expect(back.elements).toHaveLength(4)
    expect(back.appState).toEqual({ viewBackgroundColor: '#f2f0eb' })
    const text = back.elements.find((e) => e.type === 'text' && !e.isDeleted)!
    expect(envelope.rawTexts[text.id].raw).toBe('Hello world')
  })
})

describe('parseObsidian', () => {
  it('reads a compressed file written by the plugin', () => {
    const data = scene()
    data.elements[1] = { ...data.elements[1], id: 'txt12345' }
    const { scene: back } = parseObsidian(pluginFile(data))
    expect(back.elements.map((e) => e.id)).toEqual(data.elements.map((e) => e.id))
  })

  it('writes raw markdown back for text that was not edited', () => {
    const data = scene()
    data.elements[1] = { ...data.elements[1], id: 'txt12345', text: 'See Roadmap', originalText: 'See Roadmap' }
    const { scene: back, envelope } = parseObsidian(pluginFile(data))
    // Simulate Excalidraw's restore, which keeps only fields it knows.
    const restored = { ...back, elements: back.elements.map((e) => ({ ...e })) }
    expect(serializeObsidian(restored, envelope)).toContain('See [[Roadmap]] ^txt12345')
  })

  it('writes the new text for text edited since load', () => {
    const data = scene()
    data.elements[1] = { ...data.elements[1], id: 'txt12345', text: 'See Roadmap', originalText: 'See Roadmap' }
    const { scene: back, envelope } = parseObsidian(pluginFile(data))
    back.elements[1] = { ...back.elements[1], text: 'See Backlog', originalText: 'See Backlog' }
    const md = serializeObsidian(back, envelope)
    expect(md).toContain('See Backlog ^txt12345')
    expect(md).not.toContain('[[Roadmap]] ^')
  })

  it('preserves frontmatter, notes, links and embeds on re-save', () => {
    const data = scene()
    const { scene: back, envelope } = parseObsidian(pluginFile(data))
    const md = serializeObsidian(back, envelope)
    expect(md).toContain('My notes about this drawing, linking [[Roadmap]].')
    expect(md).toContain('## Element Links\nbox12345: [[Backlog]]')
    expect(md).toContain('## Embedded Files\nimg12345: [[assets/diagram.png]]')
    expect(md.match(/# Excalidraw Data/g)).toHaveLength(1)
    expect(md.match(/^---$/gm)).toHaveLength(2)
    // And it parses again.
    expect(parseObsidian(md).scene.elements).toHaveLength(4)
  })

  it('rejects markdown with no drawing', () => {
    expect(() => parseObsidian('# Just a note\n')).toThrow(NotADrawingError)
  })
})

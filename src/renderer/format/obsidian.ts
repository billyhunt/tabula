/**
 * Reads and writes the Obsidian Excalidraw plugin's `.excalidraw.md` format.
 *
 * Layout, as the plugin writes it (zsviczian/obsidian-excalidraw-plugin,
 * src/shared/ExcalidrawData.ts and excalidrawMarkdownParsing.ts):
 *
 *   ---
 *   excalidraw-plugin: parsed
 *   tags: [excalidraw]
 *   ---
 *   <optional free markdown>
 *   # Excalidraw Data
 *   ## Text Elements
 *   <text> ^<8-char id>
 *   ## Element Links / ## Embedded Files   (optional)
 *   %%
 *   ## Drawing
 *   ```json | ```compressed-json
 *   <scene>
 *   ```
 *   %%
 *
 * Tabula writes the drawing uncompressed so the file stays readable and
 * diffable, and reads both. Everything outside the sections it owns
 * (frontmatter, notes above the data, element links, embedded files) is kept
 * verbatim on save, so a drawing round-trips through Obsidian unharmed.
 *
 * This module is pure: it takes and returns plain scene JSON, with no
 * Excalidraw imports, so it can be tested without a DOM.
 */
import LZString from 'lz-string'

export interface SceneJson {
  type: string
  version: number
  source: string
  elements: SceneElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

interface Binding {
  elementId: string
  [key: string]: unknown
}

export interface SceneElement {
  id: string
  type: string
  isDeleted?: boolean
  text?: string
  originalText?: string
  containerId?: string | null
  boundElements?: { id: string; type: string }[] | null
  startBinding?: Binding | null
  endBinding?: Binding | null
  [key: string]: unknown
}

/** The parts of an .excalidraw.md file Tabula does not own, kept for re-saving. */
export interface ObsidianEnvelope {
  /** Frontmatter plus any markdown above `# Excalidraw Data`. */
  head: string
  /** `## Element Links` and `## Embedded Files` sections, verbatim. */
  extraSections: string
  /**
   * Raw markdown per text element (e.g. `See [[Roadmap]]`), with the rendered
   * text it stood for at load. Kept here rather than on the element because
   * Excalidraw's restore drops unknown element fields.
   */
  rawTexts: Record<string, { raw: string; rendered: string }>
}

const NEW_FILE_HEAD = `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==

`

export const newEnvelope = (): ObsidianEnvelope => ({
  head: NEW_FILE_HEAD,
  extraSections: '',
  rawTexts: {},
})

export const isObsidianMarkdown = (path: string) => /\.md$/i.test(path)

// --- reading ---------------------------------------------------------------

const DRAWING_JSON = /\n##? Drawing\n[^`]*```json\n([\s\S]*?)```/m
const DRAWING_COMPRESSED = /\n##? Drawing\n[^`]*```compressed-json\n([\s\S]*?)```/m
const DATA_HEADING = /^(%%\n+)?# Excalidraw Data(?:\n|$)/m
const EXTRA_SECTIONS = /^## (?:Element Links|Embedded Files)\n[\s\S]*?(?=^%%$|^## Drawing$|^#{1,2} (?!Element Links|Embedded Files)|(?![\s\S]))/gm

export class NotADrawingError extends Error {
  constructor() {
    super('This markdown file has no Excalidraw drawing in it.')
  }
}

/** Matches the plugin's decompress: strip line breaks, then LZString base64. */
const decompress = (data: string) => {
  const result = LZString.decompressFromBase64(data.replace(/[\n\r]/g, ''))
  if (!result) throw new Error('The compressed drawing data is corrupt.')
  return result
}

export const parseObsidian = (md: string): { scene: SceneJson; envelope: ObsidianEnvelope } => {
  const normalized = md.replace(/\r\n/g, '\n')
  const plain = DRAWING_JSON.exec(normalized)
  const compressed = plain ? null : DRAWING_COMPRESSED.exec(normalized)
  if (!plain && !compressed) throw new NotADrawingError()

  const json = plain ? plain[1] : decompress(compressed![1])
  const scene = JSON.parse(json) as SceneJson

  const dataAt = normalized.search(DATA_HEADING)
  const drawingAt = normalized.search(/\n##? Drawing\n/)
  const head = dataAt >= 0 ? normalized.slice(0, dataAt) : normalized.slice(0, drawingAt)
  const dataSection = dataAt >= 0 ? normalized.slice(dataAt, drawingAt) : ''
  const extraSections = (dataSection.match(EXTRA_SECTIONS) ?? [])
    .map((s) => s.trimEnd())
    .join('\n\n')

  return {
    scene,
    envelope: {
      head: head.replace(/%%\n*$/, ''),
      extraSections,
      rawTexts: readRawTexts(scene, dataSection),
    },
  }
}

const renderedText = (el: SceneElement) => el.originalText ?? el.text ?? ''

/**
 * The plugin keeps each text element's raw markdown (with [[links]]) in the
 * Text Elements section and the rendered text in the JSON. Remember both, so
 * a re-save writes the raw form back for any text the user has not edited.
 */
const readRawTexts = (scene: SceneJson, dataSection: string) => {
  const rawTexts: ObsidianEnvelope['rawTexts'] = {}
  const textSection = /## Text Elements\n([\s\S]*?)(?=^## |^%%$|(?![\s\S]))/m.exec(dataSection)
  if (!textSection) return rawTexts
  const raw = new Map<string, string>()
  for (const m of textSection[1].matchAll(/([\s\S]*?) \^([\w-]{8})\n+/g)) {
    raw.set(m[2], m[1].replace(/^\n+/, ''))
  }
  for (const el of scene.elements) {
    const r = el.type === 'text' ? raw.get(el.id) : undefined
    if (r !== undefined) rawTexts[el.id] = { raw: r, rendered: renderedText(el) }
  }
  return rawTexts
}

// --- writing ---------------------------------------------------------------

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * The plugin keys text elements by 8-character ids; Excalidraw makes 21. Derive
 * a short id from the long one by hashing, so the same element gets the same
 * id on every save and the file does not churn in git.
 */
const shortId = (id: string, salt = 0) => {
  let h1 = 0x811c9dc5 ^ salt
  let h2 = 0x01000193 + salt
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
  }
  let out = ''
  let a = h1 >>> 0
  let b = h2 >>> 0
  for (let i = 0; i < 8; i++) {
    const src = i < 4 ? a : b
    out += ID_ALPHABET[src % 62]
    if (i < 4) a = Math.floor(a / 62)
    else b = Math.floor(b / 62)
  }
  return out
}

/** Gives every text element an 8-char id, rewriting every reference to it. */
export const shortenTextIds = (elements: SceneElement[]): SceneElement[] => {
  const taken = new Set(elements.map((e) => e.id))
  const remap = new Map<string, string>()
  for (const el of elements) {
    if (el.type !== 'text' || el.id.length === 8) continue
    let salt = 0
    let next = shortId(el.id)
    while (taken.has(next)) next = shortId(el.id, ++salt)
    taken.add(next)
    remap.set(el.id, next)
  }
  if (remap.size === 0) return elements

  const swap = (id: string) => remap.get(id) ?? id
  const swapBinding = (b: Binding | null | undefined) =>
    b && remap.has(b.elementId) ? { ...b, elementId: swap(b.elementId) } : b

  return elements.map((el) => ({
    ...el,
    id: swap(el.id),
    ...(el.containerId ? { containerId: swap(el.containerId) } : {}),
    ...(el.boundElements
      ? { boundElements: el.boundElements.map((b) => ({ ...b, id: swap(b.id) })) }
      : {}),
    ...('startBinding' in el ? { startBinding: swapBinding(el.startBinding) } : {}),
    ...('endBinding' in el ? { endBinding: swapBinding(el.endBinding) } : {}),
  }))
}

const textOf = (el: SceneElement, rawTexts: ObsidianEnvelope['rawTexts']) => {
  const known = rawTexts[el.id]
  // Edited since load: the new text wins, and any link markup goes with it.
  return known && known.rendered === renderedText(el) ? known.raw : renderedText(el)
}

export const serializeObsidian = (
  scene: SceneJson,
  envelope: ObsidianEnvelope = newEnvelope(),
): string => {
  const elements = shortenTextIds(scene.elements)
  const texts = elements
    .filter((el) => el.type === 'text' && !el.isDeleted)
    .map((el) => `${textOf(el, envelope.rawTexts)} ^${el.id}\n\n`)
    .join('')

  const json = JSON.stringify({ ...scene, elements }, null, '\t')
  const head = envelope.head.endsWith('\n') ? envelope.head : `${envelope.head}\n`
  const extras = envelope.extraSections ? `${envelope.extraSections}\n\n` : ''

  return (
    `${head}# Excalidraw Data\n\n## Text Elements\n${texts}${extras}` +
    `%%\n## Drawing\n\`\`\`json\n${json}\n\`\`\`\n%%`
  )
}

/**
 * Stands in for @excalidraw/mermaid-to-excalidraw (see the alias in
 * vite.config.ts), so every Mermaid conversion gives its text Tabula's font:
 * ours, Excalidraw's own Mermaid paste, and the Text to diagram and Mermaid
 * import dialogs, which have no hook of their own.
 */
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform'
import {
  parseMermaidToExcalidraw as parse,
  type MermaidConfig,
} from '@excalidraw/mermaid-to-excalidraw/dist/index.js'
import { withDefaultFont } from '../canvas/defaultFont'

export * from '@excalidraw/mermaid-to-excalidraw/dist/index.js'

/** The CSS name of Tabula's default font (FONT_FAMILY 8). */
const FONT = '"Comic Shanns", monospace'

/** Excalidraw's gap between a container's edge and its label. */
const BOUND_TEXT_PADDING = 5

let measuring: CanvasRenderingContext2D | null = null

/** Width of the widest word of `text`, as Excalidraw will draw it. */
const widestWord = (text: string, fontSize: number) => {
  measuring ??= document.createElement('canvas').getContext('2d')
  const context = measuring
  if (!context) return 0
  context.font = `${fontSize}px ${FONT}`
  return Math.max(0, ...text.split(/\s+/).map((word) => context.measureText(word).width))
}

/**
 * Widens a diamond so its widest word fits on one line. Excalidraw wraps a
 * diamond's label to half the diamond's width, which Mermaid's diamonds are
 * too narrow for, so labels broke mid-word ("Shar / p?"). Grown about its
 * centre; the arrows bound to it re-attach to the new outline on conversion.
 */
const fitDiamondLabel = (element: ExcalidrawElementSkeleton): ExcalidrawElementSkeleton => {
  if (element.type !== 'diamond' || !element.label?.text || element.width === undefined) {
    return element
  }
  const needed = 2 * (widestWord(element.label.text, element.label.fontSize ?? 20) + BOUND_TEXT_PADDING * 2) + 4
  if (element.width >= needed) return element
  return { ...element, x: element.x - (needed - element.width) / 2, width: needed }
}

export const parseMermaidToExcalidraw: typeof parse = async (definition, config) => {
  // Mermaid sizes every box for the font it measures text in. Measured in
  // its default font, boxes came out too narrow for Comic Shanns, a wider
  // monospace, and labels broke mid-word ("Qualit / y check"). Mermaid only
  // measures with a font that has loaded.
  await document.fonts.load(`20px ${FONT}`)
  // Both settings go straight to mermaid.initialize, which knows them; this
  // package's own config type just doesn't list them.
  const withFont: MermaidConfig & {
    fontFamily: string
    themeVariables: { fontSize?: string; fontFamily: string }
  } = {
    ...config,
    fontFamily: FONT,
    themeVariables: { ...config?.themeVariables, fontFamily: FONT },
  }
  const result = await parse(definition, withFont)
  return { ...result, elements: result.elements.map(withDefaultFont).map(fitDiamondLabel) }
}

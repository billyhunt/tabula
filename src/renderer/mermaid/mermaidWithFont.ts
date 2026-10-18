/**
 * Stands in for @excalidraw/mermaid-to-excalidraw (see the alias in
 * vite.config.ts), so every Mermaid conversion gives its text Tabula's font:
 * ours, Excalidraw's own Mermaid paste, and the Text to diagram and Mermaid
 * import dialogs, which have no hook of their own.
 */
import {
  parseMermaidToExcalidraw as parse,
  type MermaidConfig,
} from '@excalidraw/mermaid-to-excalidraw/dist/index.js'
import { withDefaultFont } from '../canvas/defaultFont'

export * from '@excalidraw/mermaid-to-excalidraw/dist/index.js'

/** The CSS name of Tabula's default font (FONT_FAMILY 8). */
const FONT = '"Comic Shanns", monospace'

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
  return { ...result, elements: result.elements.map(withDefaultFont) }
}

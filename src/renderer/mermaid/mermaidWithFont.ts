/**
 * Stands in for @excalidraw/mermaid-to-excalidraw (see the alias in
 * vite.config.ts), so every Mermaid conversion gives its text Tabula's font:
 * ours, Excalidraw's own Mermaid paste, and the Text to diagram and Mermaid
 * import dialogs, which have no hook of their own.
 */
import { parseMermaidToExcalidraw as parse } from '@excalidraw/mermaid-to-excalidraw/dist/index.js'
import { withDefaultFont } from '../canvas/defaultFont'

export * from '@excalidraw/mermaid-to-excalidraw/dist/index.js'

export const parseMermaidToExcalidraw: typeof parse = async (...args) => {
  const result = await parse(...args)
  return { ...result, elements: result.elements.map(withDefaultFont) }
}

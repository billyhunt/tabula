import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'

/**
 * Converts a Mermaid definition into Excalidraw elements with fresh ids, not
 * yet placed in the scene. Flowcharts, sequence and class diagrams become
 * editable shapes; other diagram types arrive as one image (in `files`).
 * Throws when the definition doesn't parse.
 */
export const mermaidToElements = async (
  definition: string,
): Promise<{ elements: ExcalidrawElement[]; files: BinaryFiles | null }> => {
  // Mermaid is megabytes of code; load it only when a diagram is converted.
  const { parseMermaidToExcalidraw } = await import('@excalidraw/mermaid-to-excalidraw')
  const { elements, files } = await parseMermaidToExcalidraw(definition)
  return {
    elements: convertToExcalidrawElements(elements, { regenerateIds: true }),
    files: files ?? null,
  }
}

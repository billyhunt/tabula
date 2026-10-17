import { useCallback, useEffect, useRef } from 'react'
import type { ClipboardData } from '@excalidraw/excalidraw/clipboard'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { placeElements } from '../canvas/insert'
import { mermaidToElements } from './fromMermaid'

const DIAGRAM_START =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|mindmap|timeline|zenuml|sankey(?:-beta)?|xychart(?:-beta)?|block(?:-beta)?|packet(?:-beta)?|architecture(?:-beta)?|kanban|radar(?:-beta)?)(?=[\s;]|$)/

/** Whether pasted text opens like a Mermaid diagram (comment lines skipped). */
const looksLikeMermaid = (text: string) => {
  const first = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('%%'))
  return !!first && DIAGRAM_START.test(first)
}

/**
 * Excalidraw `onPaste` handler: pasted Mermaid becomes a diagram in the middle
 * of the view rather than a text element. ⇧⌘V still pastes it as text, and
 * text that only looks like Mermaid but doesn't parse pastes as text too.
 */
export const useMermaidPaste = (api: ExcalidrawImperativeAPI | null) => {
  // The paste event can't tell ⌘V from ⇧⌘V; the keydown just before it can.
  const plainPasteAt = useRef(0)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'v' && (event.metaKey || event.ctrlKey)) {
        plainPasteAt.current = event.shiftKey ? performance.now() : 0
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return useCallback(
    async (data: ClipboardData): Promise<boolean> => {
      const plain = plainPasteAt.current > 0 && performance.now() - plainPasteAt.current < 1000
      plainPasteAt.current = 0
      if (!api || plain || data.elements || !data.text || !looksLikeMermaid(data.text)) return true
      try {
        const { elements, files } = await mermaidToElements(data.text)
        placeElements(api, elements, files)
        return false
      } catch (err) {
        console.warn('Pasted text looked like Mermaid but did not convert:', err)
        return true
      }
    },
    [api],
  )
}

import { useEffect, useRef } from 'react'
import { getCommonBounds } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  addElementsInput,
  BRIDGE_TOOLS,
  idsInput,
  importMermaidInput,
  newDrawingInput,
  parseToolArgs,
  screenshotInput,
  selectElementsInput,
  updateElementsInput,
  zoomToFitInput,
} from '../../shared/agentTools'
import type { AgentToolResult } from '../../shared/ipc'
import { placeElements } from '../canvas/insert'
import type { DocumentController } from '../document'
import { renderPdfPages, renderPng, renderSvg } from '../export/render'
import { isObsidianMarkdown, parseObsidian } from '../format/obsidian'
import { mermaidToElements } from '../mermaid/fromMermaid'
import { toMermaid } from '../mermaid/toMermaid'
import { addElements, summarizePlaced } from './tools/add'
import { selectable } from './tools/commit'
import { describeScene } from './tools/scene'
import { deleteElements, updateElements } from './tools/update'

type Handler = (args: unknown) => AgentToolResult | Promise<AgentToolResult>

// Screenshots are for a model to look at: big enough to read, small enough to send.
const SCREENSHOT_SIDE = 1600
const MAX_IMAGE_SIDE = 8000

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const UNSAVED =
  'The current drawing has unsaved changes and autosave is off; save it first or pass discardChanges: true'

const buildHandlers = (
  api: ExcalidrawImperativeAPI,
  docRef: { readonly current: DocumentController },
): Record<string, Handler> => {
  /** Live elements for `ids`, failing on any unknown one. */
  const liveElements = (ids: readonly string[]) => {
    const live = new Map(api.getSceneElements().map((e) => [e.id, e]))
    const missing = ids.filter((id) => !live.has(id))
    if (missing.length) {
      throw new Error(`No element with id ${missing.map((id) => `"${id}"`).join(', ')}`)
    }
    return ids.flatMap((id) => live.get(id) ?? [])
  }

  return {
    // ── Agent tools ──
    get_scene: () => {
      const scene = describeScene(api, docRef.current)
      return { text: `Read the drawing (${scene.elements.length} elements)`, json: scene }
    },

    add_elements: (args) =>
      addElements(api, parseToolArgs('add_elements', addElementsInput, args).elements),

    update_elements: (args) =>
      updateElements(api, parseToolArgs('update_elements', updateElementsInput, args).updates),

    delete_elements: (args) =>
      deleteElements(api, parseToolArgs('delete_elements', idsInput, args).ids),

    import_mermaid: async (args) => {
      const { mermaid, x, y } = parseToolArgs('import_mermaid', importMermaidInput, args)
      const { elements, files } = await mermaidToElements(mermaid)
      if (!elements.length) throw new Error('The Mermaid diagram produced no elements')
      const at = x !== undefined && y !== undefined ? { x, y } : 'viewport-center'
      const placed = placeElements(api, elements, files, at)
      return {
        text: `Imported a Mermaid diagram (${selectable(placed).length} elements)`,
        json: { elements: summarizePlaced(placed) },
      }
    },

    select_elements: (args) => {
      const { ids } = parseToolArgs('select_elements', selectElementsInput, args)
      if (!ids.length) {
        api.selection.clear()
        return { text: 'Cleared the selection' }
      }
      api.selection.select(liveElements(ids))
      return { text: `Selected ${ids.length} element${ids.length === 1 ? '' : 's'}` }
    },

    zoom_to_fit: (args) => {
      const { ids } = parseToolArgs('zoom_to_fit', zoomToFitInput, args)
      const elements = ids ? liveElements(ids) : api.getSceneElements()
      if (!elements.length) throw new Error('The drawing is empty')
      // `ui` offsets keep the result clear of the toolbar, panels and the
      // docked chat, which otherwise cover the edges of the "fitted" drawing.
      api.setViewport({
        target: getCommonBounds(elements),
        fit: 'scale-down',
        animation: true,
        offsets: { ui: true },
      })
      return { text: `Zoomed to fit ${elements.length} element${elements.length === 1 ? '' : 's'}` }
    },

    screenshot: async (args) => {
      const { selectionOnly = false, scale } = parseToolArgs('screenshot', screenshotInput, args)
      const { selectedElementIds } = api.getAppState()
      const all = api.getSceneElements()
      const shown = selectionOnly ? all.filter((e) => selectedElementIds[e.id]) : all
      if (!shown.length) throw new Error(selectionOnly ? 'Nothing is selected' : 'The drawing is empty')
      const [minX, minY, maxX, maxY] = getCommonBounds(shown)
      const side = Math.max(maxX - minX, maxY - minY, 1)
      const wanted = scale ?? Math.min(2, Math.max(0.25, SCREENSHOT_SIDE / side))
      const png = await renderPng(api, {
        selectionOnly,
        scale: Math.min(wanted, MAX_IMAGE_SIDE / side),
      })
      return {
        text: selectionOnly ? 'Took a screenshot of the selection' : 'Took a screenshot',
        image: { mimeType: 'image/png', base64: toBase64(png) },
      }
    },

    new_drawing: async (args) => {
      const { discardChanges } = parseToolArgs('new_drawing', newDrawingInput, args)
      // With autosave on, unsaved edits are saved rather than refused.
      if (!discardChanges && !(await docRef.current.flush())) throw new Error(UNSAVED)
      await docRef.current.newDrawing({ force: true })
      return { text: 'Started a new drawing' }
    },

    // ── Bridge-only tools main uses for the MCP file tools ──
    ping: () => ({ text: 'ready' }),

    loadFile: async (args) => {
      const { discardChanges, ...file } = parseToolArgs('loadFile', BRIDGE_TOOLS.loadFile, args)
      // The editor shows an alert for a file it can't read, which would stall
      // the agent; catch the usual cases here and report them instead.
      try {
        if (isObsidianMarkdown(file.path)) parseObsidian(file.contents)
        else JSON.parse(file.contents)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`Not a drawing Tabula can open: ${reason}`)
      }
      // Checked here, right before replacing the scene, rather than in an
      // earlier round trip the user could have edited after.
      if (!discardChanges && !(await docRef.current.flush())) throw new Error(UNSAVED)
      await docRef.current.load(file)
      return { text: `Opened ${file.path}` }
    },

    renderExport: async (args) => {
      const { format, dark } = parseToolArgs('renderExport', BRIDGE_TOOLS.renderExport, args)
      if (!api.getSceneElements().length) throw new Error('The drawing is empty')
      switch (format) {
        case 'png':
          return { image: { mimeType: 'image/png', base64: toBase64(await renderPng(api, { dark })) } }
        case 'svg':
          return { json: { text: await renderSvg(api, { dark }), warnings: [] } }
        case 'mermaid': {
          const { mermaid, warnings } = toMermaid(api.getSceneElements())
          return { json: { text: mermaid, warnings } }
        }
        case 'pdf':
          return { json: { pages: await renderPdfPages(api, { perFrame: false }) } }
      }
    },

    saveDocument: async (args) => {
      const { path } = parseToolArgs('saveDocument', BRIDGE_TOOLS.saveDocument, args)
      const doc = docRef.current
      if (!path && !doc.filePath) {
        throw new Error('This drawing has never been saved; give a path to save it to')
      }
      // saveTo, not save: an agent must never be left waiting on a Save
      // dialog, which save() shows for drawings with only an autosave name.
      // Without a path it saves to the drawing's file as of the write.
      const saved = await doc.saveTo(path ?? null)
      return { text: `Saved to ${saved}` }
    },
  }
}

/**
 * Runs the canvas tools main sends (from the MCP server or the chat)
 * against this window's editor, one undo step per change.
 */
export const useCanvasTools = (api: ExcalidrawImperativeAPI | null, doc: DocumentController) => {
  // The controller changes with every edit; tools read the latest one.
  const docRef = useRef(doc)
  docRef.current = doc

  useEffect(() => {
    if (!api) return
    const handlers = buildHandlers(api, docRef)
    return window.tabula.agent.onRequest(async ({ id, tool, args }) => {
      try {
        const handler = handlers[tool]
        if (!handler) throw new Error(`Unknown tool ${tool}`)
        window.tabula.agent.respond({ id, ok: true, result: await handler(args) })
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        window.tabula.agent.respond({ id, ok: false, error })
      }
    })
  }, [api])
}

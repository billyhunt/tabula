import { exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import type {
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
} from '@excalidraw/excalidraw/element/types'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { PdfPage } from '../../shared/ipc'
import { readingOrder } from '../canvas/readingOrder'

type Frame = NonDeleted<ExcalidrawFrameLikeElement>

const isFrame = (e: NonDeletedExcalidrawElement): e is Frame =>
  e.type === 'frame' || e.type === 'magicframe'

export interface ExportScope {
  elements: NonDeletedExcalidrawElement[]
  /** A lone selected frame: the export is clipped to it. */
  frame: Frame | null
}

/**
 * What an export covers: with `selectionOnly`, the selection when there is
 * one, else the whole board. Selected frames bring their contents and selected
 * shapes and arrows bring their labels, as Excalidraw's own export does.
 */
export const exportScope = (api: ExcalidrawImperativeAPI, selectionOnly = false): ExportScope => {
  const all = api.getSceneElements()
  const selectedIds = api.getAppState().selectedElementIds
  const picked = selectionOnly ? all.filter((e) => selectedIds[e.id]) : []
  if (!picked.length) return { elements: [...all], frame: null }
  const ids = new Set(picked.map((e) => e.id))
  for (const e of all) if (e.frameId && ids.has(e.frameId)) ids.add(e.id)
  for (const e of all) if (e.type === 'text' && e.containerId && ids.has(e.containerId)) ids.add(e.id)
  const [only] = picked
  return {
    elements: all.filter((e) => ids.has(e.id)),
    frame: picked.length === 1 && isFrame(only) ? only : null,
  }
}

const exportAppState = (
  api: ExcalidrawImperativeAPI,
  background: boolean,
  dark: boolean,
): Partial<Omit<AppState, 'offsetTop' | 'offsetLeft'>> => {
  const { viewBackgroundColor, frameRendering } = api.getAppState()
  return {
    viewBackgroundColor,
    frameRendering,
    exportBackground: background,
    exportWithDarkMode: dark,
    exportEmbedScene: false,
    exportScale: 1,
  }
}

const FONT_FACE = /@font-face\s*\{[^}]*\}/g

/**
 * Excalidraw inlines each font it can fetch (from the bundled copy under
 * EXCALIDRAW_ASSET_PATH) as a subsetted data URL, but falls back to a CDN URL
 * for any it can't. An exported file must not depend on the network, so
 * those rules go: their text falls back to a system font instead.
 */
const dropRemoteFonts = (svg: SVGSVGElement) => {
  const style = svg.querySelector('style.style-fonts')
  if (!style?.textContent) return
  const rules = style.textContent.match(FONT_FACE) ?? []
  const embedded = rules.filter((rule) => /url\(\s*['"]?data:/.test(rule))
  if (embedded.length < rules.length) {
    console.warn(`Export: left out ${rules.length - embedded.length} font(s) that couldn't be embedded`)
  }
  style.textContent = embedded.join('\n')
}

const svgElement = async (
  api: ExcalidrawImperativeAPI,
  scope: ExportScope,
  opts: { background?: boolean; dark?: boolean },
) => {
  const svg: SVGSVGElement = await exportToSvg({
    elements: scope.elements,
    files: api.getFiles(),
    exportingFrame: scope.frame,
    appState: exportAppState(api, opts.background ?? true, opts.dark ?? false),
  })
  dropRemoteFonts(svg)
  return svg
}

const svgDocument = (svg: SVGSVGElement) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`

/** PNG bytes of the board (or selection), `scale` × its size on the canvas. */
export const renderPng = async (
  api: ExcalidrawImperativeAPI,
  opts: { selectionOnly?: boolean; scale?: number; background?: boolean; dark?: boolean } = {},
): Promise<Uint8Array> => {
  const { elements, frame } = exportScope(api, opts.selectionOnly)
  const scale = opts.scale ?? 1
  // Excalidraw's typings for its export helpers don't resolve (they point at
  // an unpublished package), so the results are typed here.
  const blob: Blob = await exportToBlob({
    elements,
    files: api.getFiles(),
    exportingFrame: frame,
    appState: exportAppState(api, opts.background ?? true, opts.dark ?? false),
    mimeType: 'image/png',
    getDimensions: (width: number, height: number) => ({
      width: width * scale,
      height: height * scale,
      scale,
    }),
  })
  return new Uint8Array(await blob.arrayBuffer())
}

/** A standalone SVG document with its fonts embedded. */
export const renderSvg = async (
  api: ExcalidrawImperativeAPI,
  opts: { background?: boolean; dark?: boolean } = {},
): Promise<string> => svgDocument(await svgElement(api, exportScope(api), opts))

/**
 * One page per frame with `perFrame` (frames in reading order), otherwise —
 * or when there are no frames — one page for the whole export.
 */
export const renderPdfPages = async (
  api: ExcalidrawImperativeAPI,
  opts: { perFrame: boolean },
): Promise<PdfPage[]> => {
  const scope = exportScope(api)
  const frames = opts.perFrame ? readingOrder(scope.elements.filter(isFrame)) : []
  // A frame page takes its contents from the whole board: the frame clips them.
  const all = [...api.getSceneElements()]
  const scopes = frames.length ? frames.map((frame) => ({ elements: all, frame })) : [scope]
  const pages: PdfPage[] = []
  // One at a time: each page fetches and subsets its fonts.
  for (const pageScope of scopes) {
    const svg = await svgElement(api, pageScope, {})
    pages.push({
      svg: svgDocument(svg),
      width: Number(svg.getAttribute('width')),
      height: Number(svg.getAttribute('height')),
    })
  }
  return pages
}

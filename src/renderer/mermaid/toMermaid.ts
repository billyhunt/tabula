import type {
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  ExcalidrawLinearElement,
} from '@excalidraw/excalidraw/element/types'
import { readingOrder } from '../canvas/readingOrder'

// Excalidraw's default stroke; anything else is a colour the user picked.
const DEFAULT_STROKE = '#1e1e1e'

const SHAPE_TYPES: Record<string, true> = { rectangle: true, stickynote: true, ellipse: true, diamond: true }

const INDENT = '    '

const NO_EQUIVALENT = ': Mermaid has no equivalent'
const UNCONNECTED = 'connected to shapes at both ends'

/** How warnings name each dropped element type, singular and plural. */
const DROPPED: Record<string, { one: string; many: string }> = {
  freedraw: { one: `freehand drawing${NO_EQUIVALENT}`, many: `freehand drawings${NO_EQUIVALENT}` },
  image: { one: `image${NO_EQUIVALENT}`, many: `images${NO_EQUIVALENT}` },
  embeddable: { one: `embedded page${NO_EQUIVALENT}`, many: `embedded pages${NO_EQUIVALENT}` },
  iframe: { one: `embedded page${NO_EQUIVALENT}`, many: `embedded pages${NO_EQUIVALENT}` },
  text: {
    one: "text element that isn't inside a shape or connected by an arrow",
    many: "text elements that aren't inside a shape or connected by an arrow",
  },
  arrow: { one: `arrow that isn't ${UNCONNECTED}`, many: `arrows that aren't ${UNCONNECTED}` },
  line: { one: `line that isn't ${UNCONNECTED}`, many: `lines that aren't ${UNCONNECTED}` },
}

const isFrame = (e: ExcalidrawElement): e is ExcalidrawFrameLikeElement =>
  e.type === 'frame' || e.type === 'magicframe'

const isLinear = (e: ExcalidrawElement): e is ExcalidrawLinearElement =>
  e.type === 'arrow' || e.type === 'line'

/** Mermaid label text: quotes and newlines would end or break the label. */
const escapeLabel = (text: string) =>
  text.trim().replace(/"/g, '#quot;').replace(/\r?\n/g, '<br/>') || ' '

const nodeShape = (e: ExcalidrawElement, label: string) => {
  const text = escapeLabel(label)
  if (e.type === 'ellipse') return `(("${text}"))`
  if (e.type === 'diamond') return `{"${text}"}`
  if (e.type !== 'text' && e.roundness) return `("${text}")`
  return `["${text}"]`
}

// Arrow operators by line style, then by how many ends carry an arrowhead.
const EDGE_OPERATORS = {
  solid: { none: '---', one: '-->', both: '<-->' },
  dashed: { none: '-.-', one: '-.->', both: '<-.->' },
  thick: { none: '===', one: '==>', both: '<==>' },
}

/**
 * Serializes the shapes, arrows and frames of a drawing as a Mermaid
 * flowchart. Pass non-deleted elements; anything a flowchart can't express is
 * left out and explained in `warnings`.
 */
export const toMermaid = (
  elements: readonly ExcalidrawElement[],
): { mermaid: string; warnings: string[] } => {
  const live = elements.filter((e) => !e.isDeleted)
  if (!live.length) {
    return {
      mermaid: 'flowchart TD',
      warnings: ['The canvas is empty, so there is nothing to convert to Mermaid.'],
    }
  }
  const byId = new Map(live.map((e) => [e.id, e]))

  // Text bound to a shape or arrow is that element's label.
  const labels = new Map<string, string>()
  for (const e of live) {
    if (e.type === 'text' && e.containerId && byId.has(e.containerId)) {
      labels.set(e.containerId, e.originalText || e.text)
    }
  }
  const isLabel = (e: ExcalidrawElement) =>
    e.type === 'text' && !!e.containerId && byId.has(e.containerId)
  // Shapes are nodes; free-standing text becomes one once an arrow connects it.
  const canBeNode = (e: ExcalidrawElement | undefined) =>
    !!e && (!!SHAPE_TYPES[e.type] || (e.type === 'text' && !isLabel(e)))

  // An arrow drawn with only a start arrowhead points from its end to its start.
  const edges = live.filter(isLinear).flatMap((e) => {
    const startId = e.startBinding?.elementId
    const endId = e.endBinding?.elementId
    const startNode = startId ? byId.get(startId) : undefined
    const endNode = endId ? byId.get(endId) : undefined
    if (!startNode || !endNode || !canBeNode(startNode) || !canBeNode(endNode)) return []
    const heads = e.startArrowhead && e.endArrowhead ? 'both' : e.startArrowhead || e.endArrowhead ? 'one' : 'none'
    const reversed = !!e.startArrowhead && !e.endArrowhead
    const style = e.strokeStyle !== 'solid' ? 'dashed' : e.strokeWidth >= 4 ? 'thick' : 'solid'
    return [
      {
        e,
        from: reversed ? endNode : startNode,
        to: reversed ? startNode : endNode,
        operator: EDGE_OPERATORS[style][heads],
      },
    ]
  })
  const connectedIds = new Set(edges.map(({ e }) => e.id))
  const arrowTargets = new Set(edges.flatMap(({ from, to }) => [from.id, to.id]))
  const isNode = (e: ExcalidrawElement) =>
    canBeNode(e) && (e.type !== 'text' || arrowTargets.has(e.id))

  const nodes = readingOrder(live.filter(isNode))
  const nodeIds = new Map(nodes.map((e, i) => [e.id, `n${i + 1}`]))

  const dropped = new Map<string, number>()
  for (const e of live) {
    if (isNode(e) || isFrame(e) || isLabel(e) || connectedIds.has(e.id) || e.type === 'selection') {
      continue
    }
    dropped.set(e.type, (dropped.get(e.type) ?? 0) + 1)
  }
  const warnings = [...dropped].map(([type, count]) => {
    const noun = DROPPED[type] ?? { one: `${type} element`, many: `${type} elements` }
    return `Left out ${count} ${count === 1 ? noun.one : noun.many}.`
  })

  if (!nodes.length) {
    warnings.push(
      'Nothing here could be converted: Mermaid flowcharts are made of rectangles, ellipses and diamonds joined by arrows.',
    )
    return { mermaid: 'flowchart TD', warnings }
  }

  const declaration = (e: ExcalidrawElement) =>
    `${nodeIds.get(e.id)}${nodeShape(e, e.type === 'text' ? e.originalText || e.text : (labels.get(e.id) ?? ''))}`

  const nodeOrder = new Map(nodes.map((e, i) => [e.id, i]))
  const rank = (e: ExcalidrawElement) => nodeOrder.get(e.id) ?? 0
  edges.sort((a, b) => rank(a.from) - rank(b.from) || rank(a.to) - rank(b.to))

  // Mostly-horizontal arrows read best left to right; anything else top down.
  let dx = 0
  let dy = 0
  for (const { from, to } of edges) {
    dx += to.x + to.width / 2 - (from.x + from.width / 2)
    dy += to.y + to.height / 2 - (from.y + from.height / 2)
  }
  const lines = [`flowchart ${Math.abs(dx) > Math.abs(dy) ? 'LR' : 'TD'}`]

  const frames = readingOrder(live.filter(isFrame)).filter((f) =>
    nodes.some((n) => n.frameId === f.id),
  )
  frames.forEach((frame, i) => {
    lines.push(`${INDENT}subgraph f${i + 1}["${escapeLabel(frame.name ?? 'Frame')}"]`)
    for (const node of nodes) {
      if (node.frameId === frame.id) lines.push(`${INDENT}${INDENT}${declaration(node)}`)
    }
    lines.push(`${INDENT}end`)
  })
  const frameIds = new Set(frames.map((f) => f.id))
  for (const node of nodes) {
    if (!node.frameId || !frameIds.has(node.frameId)) lines.push(`${INDENT}${declaration(node)}`)
  }

  for (const { e, from, to, operator } of edges) {
    const label = labels.get(e.id)
    const text = label?.trim() ? `|"${escapeLabel(label)}"|` : ''
    lines.push(`${INDENT}${nodeIds.get(from.id)} ${operator}${text} ${nodeIds.get(to.id)}`)
  }

  for (const node of nodes) {
    if (node.type === 'text') continue
    const style = [
      node.backgroundColor !== 'transparent' && `fill:${node.backgroundColor}`,
      node.strokeColor.toLowerCase() !== DEFAULT_STROKE &&
        node.strokeColor !== 'transparent' &&
        `stroke:${node.strokeColor}`,
    ].filter(Boolean)
    if (style.length) lines.push(`${INDENT}style ${nodeIds.get(node.id)} ${style.join(',')}`)
  }

  return { mermaid: lines.join('\n'), warnings }
}

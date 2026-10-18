import { convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/element/transform'
import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextContainer,
  ExcalidrawTextElement,
} from '@excalidraw/excalidraw/element/types'
import type { LocalPoint, Radians } from '@excalidraw/excalidraw/math/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ElementUpdate } from '../../../shared/agentTools'
import type { AgentToolResult } from '../../../shared/ipc'
import { DEFAULT_FONT_FAMILY } from '../../canvas/defaultFont'
import { commitChanges, selectable } from './commit'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const isLinear = (e: ExcalidrawElement): e is ExcalidrawLinearElement =>
  e.type === 'arrow' || e.type === 'line'

const isTextContainer = (e: ExcalidrawElement): e is ExcalidrawTextContainer =>
  e.type === 'rectangle' ||
  e.type === 'ellipse' ||
  e.type === 'diamond' ||
  e.type === 'stickynote' ||
  e.type === 'arrow'

const sameBox = (a: Box, b: Box) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** Checks ids against the live scene, reporting every unknown one at once. */
const requireElements = (live: ReadonlyMap<string, ExcalidrawElement>, ids: readonly string[]) => {
  const missing = ids.filter((id) => !live.has(id))
  if (missing.length) {
    throw new Error(`No element with id ${missing.map((id) => `"${id}"`).join(', ')}`)
  }
  const repeated = ids.find((id, i) => ids.indexOf(id) !== i)
  if (repeated) throw new Error(`The id "${repeated}" is listed twice`)
}

/**
 * Lays a label out in its container the way Excalidraw lays out new labels
 * (wrapped, centred, the container grown to fit), by converting a copy of the
 * container with the label attached.
 */
const layoutLabel = (
  container: ExcalidrawTextContainer,
  text: string,
  like: ExcalidrawTextElement | undefined,
) => {
  const label = {
    text,
    ...(like
      ? {
          fontSize: like.fontSize,
          fontFamily: like.fontFamily,
          strokeColor: like.strokeColor,
          textAlign: like.textAlign,
          verticalAlign: like.verticalAlign,
        }
      : { fontFamily: DEFAULT_FONT_FAMILY }),
  }
  const { id, x, y } = container
  const skeleton: ExcalidrawElementSkeleton =
    container.type === 'arrow'
      ? { type: 'arrow', id, x, y, points: container.points, label }
      : {
          type: container.type,
          id,
          x,
          y,
          width: container.width,
          height: container.height,
          angle: container.angle,
          label,
        }
  const laid = convertToExcalidrawElements([skeleton], { regenerateIds: false })
  const laidText = laid.find((e) => e.type === 'text')
  const laidContainer = laid.find((e) => e.id === id)
  if (laidText?.type !== 'text' || !laidContainer) throw new Error(`Couldn't lay out the label of "${id}"`)
  return { label: laidText, height: laidContainer.height }
}

/** Moves a point of the old box to the same relative spot in the new one. */
const follow = (p: { x: number; y: number }, from: Box, to: Box) => ({
  x: to.x + (from.width ? ((p.x - from.x) * to.width) / from.width : p.x - from.x),
  y: to.y + (from.height ? ((p.y - from.y) * to.height) / from.height : p.y - from.y),
})

/** A linear element through the given scene points. */
const throughPoints = (points: readonly { x: number; y: number }[]) => {
  const [first] = points
  const local = points.map((p) => [p.x - first.x, p.y - first.y] as LocalPoint)
  const xs = local.map(([x]) => x)
  const ys = local.map(([, y]) => y)
  return {
    x: first.x,
    y: first.y,
    points: local,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

export const updateElements = (
  api: ExcalidrawImperativeAPI,
  updates: readonly ElementUpdate[],
): AgentToolResult => {
  const all = api.getSceneElementsIncludingDeleted()
  const live = new Map(all.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  requireElements(live, updates.map((u) => u.id))

  const changed = new Map<string, ExcalidrawElement>()
  const current = (e: ExcalidrawElement) => changed.get(e.id) ?? e
  const added: ExcalidrawElement[] = []
  // Container id → its new label text.
  const newLabels = new Map<string, string>()
  const boundText = (container: ExcalidrawElement) => {
    const id = container.boundElements?.find((b) => b.type === 'text')?.id
    const text = id === undefined ? undefined : live.get(id)
    return text?.type === 'text' ? text : undefined
  }

  // 1. What was asked for.
  for (const update of updates) {
    const original = live.get(update.id)
    if (!original) continue
    const { id, text, width, height, angle, link, ...style } = update
    if (original.type === 'text' && (width !== undefined || height !== undefined)) {
      throw new Error(`"${id}" is text: it sizes itself to its text, so width/height don't apply`)
    }
    let next = newElementWith(original, {
      ...style,
      ...(angle !== undefined && { angle: angle as Radians }),
      ...(link !== undefined && { link }),
    })
    if (width !== undefined || height !== undefined) {
      if (isLinear(next)) {
        const sx = width !== undefined && next.width ? width / next.width : 1
        const sy = height !== undefined && next.height ? height / next.height : 1
        next = newElementWith(next, {
          points: next.points.map(([x, y]) => [x * sx, y * sy] as LocalPoint),
          width: next.width * sx,
          height: next.height * sy,
        })
      } else {
        next = newElementWith(next, { width: width ?? next.width, height: height ?? next.height })
      }
    }
    if (text !== undefined) {
      if (next.type === 'text' && next.containerId) {
        newLabels.set(next.containerId, text)
      } else if (next.type === 'text') {
        if (!text) throw new Error(`To remove the text "${id}", delete it`)
        const [measured] = convertToExcalidrawElements(
          [
            {
              type: 'text',
              x: next.x,
              y: next.y,
              text,
              fontSize: next.fontSize,
              fontFamily: next.fontFamily,
              lineHeight: next.lineHeight,
              textAlign: next.textAlign,
            },
          ],
          { regenerateIds: false },
        )
        next = newElementWith(next, {
          text,
          originalText: text,
          width: measured.width,
          height: measured.height,
        })
      } else if (next.type === 'frame' || next.type === 'magicframe') {
        next = newElementWith(next, { name: text })
      } else if (isTextContainer(next)) {
        newLabels.set(next.id, text)
      } else {
        throw new Error(`"${id}" is a ${next.type}, which can't hold text`)
      }
    }
    changed.set(id, next)
  }
  const asked = new Set(changed.keys())

  // 2. A moved frame takes its contents along.
  for (const frame of [...changed.values()]) {
    if (frame.type !== 'frame' && frame.type !== 'magicframe') continue
    const before = live.get(frame.id)
    if (!before) continue
    const dx = frame.x - before.x
    const dy = frame.y - before.y
    if (!dx && !dy) continue
    for (const child of live.values()) {
      if (child.frameId !== frame.id || asked.has(child.id)) continue
      const base = current(child)
      changed.set(child.id, newElementWith(base, { x: base.x + dx, y: base.y + dy }))
    }
  }

  // 3. Connected arrows follow the shapes they connect to, in a straight
  // line from their old attachment points (Excalidraw re-routes them fully
  // the next time the user touches them).
  const moved = new Map<string, { from: Box; to: Box }>()
  for (const next of changed.values()) {
    const before = live.get(next.id)
    if (before && !isLinear(next) && !sameBox(before, next)) moved.set(next.id, { from: before, to: next })
  }
  for (const arrow of live.values()) {
    if (arrow.type !== 'arrow' || changed.has(arrow.id)) continue
    // Elbow arrows route themselves through fixed segments; straight-line following would break them.
    if ('elbowed' in arrow && arrow.elbowed) continue
    const start = arrow.startBinding && moved.get(arrow.startBinding.elementId)
    const end = arrow.endBinding && moved.get(arrow.endBinding.elementId)
    if (!start && !end) continue
    const points = arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }))
    const last = points.length - 1
    if (start) points[0] = follow(points[0], start.from, start.to)
    if (end) points[last] = follow(points[last], end.from, end.to)
    changed.set(arrow.id, newElementWith(arrow, throughPoints(points)))
  }

  // 4. Labels: new text, or re-laid out / carried along with their shape.
  for (const id of new Set([...changed.keys(), ...newLabels.keys()])) {
    const before = live.get(id)
    if (!before) continue
    const container = current(before)
    if (!isTextContainer(container)) continue
    const labelBefore = boundText(before)
    const latest = labelBefore && current(labelBefore)
    const label = latest?.type === 'text' ? latest : undefined
    const newText = newLabels.get(id)
    if (newText === undefined && !label) continue
    if (newText === '') {
      if (!label) continue
      changed.set(label.id, newElementWith(label, { isDeleted: true }))
      changed.set(
        id,
        newElementWith(container, {
          boundElements: (container.boundElements ?? []).filter((b) => b.id !== label.id),
        }),
      )
      continue
    }
    const resized = before.width !== container.width || before.height !== container.height
    if (newText === undefined && label && !resized) {
      // Moved, not resized: the label rides along, unless something (a
      // moving frame) already carried it.
      const dx = container.x - before.x
      const dy = container.y - before.y
      const carried = label.x !== labelBefore?.x || label.y !== labelBefore.y
      if ((dx || dy) && !carried) {
        changed.set(label.id, newElementWith(label, { x: label.x + dx, y: label.y + dy }))
      }
      continue
    }
    const text = newText ?? label?.originalText ?? ''
    const laid = layoutLabel(container, text, label)
    if (label) {
      const { x, y, width, height } = laid.label
      changed.set(
        label.id,
        newElementWith(label, { text: laid.label.text, originalText: text, x, y, width, height }),
      )
    } else {
      added.push(laid.label)
    }
    changed.set(
      id,
      newElementWith(container, {
        ...(container.type !== 'arrow' && { height: laid.height }),
        ...(!label && {
          boundElements: [
            ...(container.boundElements ?? []),
            { id: laid.label.id, type: 'text' as const },
          ],
        }),
      }),
    )
  }

  commitChanges(api, [...changed.values()], added)
  const shown = selectable([...asked].flatMap((id) => changed.get(id) ?? []))
  const containers = [...asked].flatMap((id) => {
    const e = changed.get(id)
    return e?.type === 'text' && e.containerId ? [e.containerId] : []
  })
  api.selection.select([...shown, ...containers])

  const knockOn = changed.size + added.length - asked.size
  return {
    text:
      `Updated ${plural(asked.size, 'element')}` +
      (knockOn > 0 ? ` (and ${plural(knockOn, 'connected element')})` : ''),
    json: { updated: [...asked], alsoChanged: [...changed.keys()].filter((id) => !asked.has(id)) },
  }
}

export const deleteElements = (
  api: ExcalidrawImperativeAPI,
  ids: readonly string[],
): AgentToolResult => {
  const all = api.getSceneElementsIncludingDeleted()
  const live = new Map(all.filter((e) => !e.isDeleted).map((e) => [e.id, e]))
  requireElements(live, ids)

  const doomed = new Set(ids)
  // A frame takes its contents along; anything doomed takes its label.
  for (const e of live.values()) {
    if (e.frameId && doomed.has(e.frameId)) doomed.add(e.id)
  }
  for (const e of live.values()) {
    if (e.type === 'text' && e.containerId && doomed.has(e.containerId)) doomed.add(e.id)
  }

  const changed: ExcalidrawElement[] = []
  for (const e of live.values()) {
    if (doomed.has(e.id)) {
      changed.push(newElementWith(e, { isDeleted: true }))
      continue
    }
    // Survivors forget what was deleted, so nothing points at a ghost.
    const bound = e.boundElements?.filter((b) => !doomed.has(b.id))
    const boundChanged = bound !== undefined && bound.length !== e.boundElements?.length
    const startGone = isLinear(e) && !!e.startBinding && doomed.has(e.startBinding.elementId)
    const endGone = isLinear(e) && !!e.endBinding && doomed.has(e.endBinding.elementId)
    if (!boundChanged && !startGone && !endGone) continue
    changed.push(
      newElementWith(e, {
        ...(boundChanged && { boundElements: bound }),
        ...(startGone && { startBinding: null }),
        ...(endGone && { endBinding: null }),
      }),
    )
  }

  commitChanges(api, changed)
  api.selection.clear()
  const count = selectable(changed.filter((e) => e.isDeleted)).length
  return {
    text: `Deleted ${plural(count, 'element')}`,
    json: { deleted: [...doomed] },
  }
}

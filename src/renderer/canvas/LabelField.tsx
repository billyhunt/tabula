import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { updateElements } from '../agent/tools/update'

/**
 * A "Label" field at the top of Excalidraw's properties panel, shown when one
 * shape or arrow is selected. Typing there sets, changes or (when emptied)
 * removes its label, without having to aim a double-click.
 *
 * Excalidraw has no way to add sections to that panel, so the field is
 * portalled into a slot kept as the panel's first child. The panel is
 * remounted on every selection change; an observer re-inserts the slot.
 */

const PANEL = '.canvas .App-menu__left .selected-shape-actions'

const LABELLED_TYPES: Record<string, true> = {
  rectangle: true,
  ellipse: true,
  diamond: true,
  stickynote: true,
  arrow: true,
}

interface Target {
  id: string
  label: string
}

/** The one selected shape that can hold a label, and its current label. */
const selectedTarget = (
  elements: readonly ExcalidrawElement[],
  selectedIds: Readonly<Record<string, true>>,
): Target | null => {
  const ids = Object.keys(selectedIds)
  if (ids.length !== 1) return null
  const element = elements.find((e) => e.id === ids[0] && !e.isDeleted)
  if (!element || element.locked || !LABELLED_TYPES[element.type]) return null
  const labelId = element.boundElements?.find((b) => b.type === 'text')?.id
  const label = elements.find((e) => e.id === labelId && !e.isDeleted)
  return { id: element.id, label: label?.type === 'text' ? label.originalText : '' }
}

/** A div kept at the top of the properties panel whenever it is open. */
const usePanelSlot = () => {
  const [host] = useState(() => {
    const div = document.createElement('div')
    div.className = 'tabula-label-slot'
    return div
  })
  const [attached, setAttached] = useState(false)
  useEffect(() => {
    const attach = () => {
      const panel = document.querySelector(PANEL)
      if (panel && panel.firstElementChild !== host) panel.prepend(host)
      if (!panel) host.remove()
      setAttached(host.isConnected)
    }
    attach()
    const observer = new MutationObserver(attach)
    observer.observe(document.querySelector('.canvas') ?? document.body, {
      childList: true,
      subtree: true,
    })
    return () => {
      observer.disconnect()
      host.remove()
    }
  }, [host])
  return attached ? host : null
}

export const LabelField = ({ api }: { api: ExcalidrawImperativeAPI | null }) => {
  const host = usePanelSlot()
  const inputId = useId()
  const [target, setTarget] = useState<Target | null>(null)
  const [draft, setDraft] = useState('')
  const focused = useRef(false)

  useEffect(() => {
    if (!api) return
    const read = (elements: readonly ExcalidrawElement[], selectedIds: Readonly<Record<string, true>>) => {
      const next = selectedTarget(elements, selectedIds)
      setTarget((prev) =>
        prev?.id === next?.id && prev?.label === next?.label ? prev : next,
      )
    }
    read(api.getSceneElements(), api.getAppState().selectedElementIds)
    return api.onChange((elements, state) => read(elements, state.selectedElementIds))
  }, [api])

  // Follow the canvas (another selection, an edit made there) unless the
  // user is typing here.
  useEffect(() => {
    if (!focused.current) setDraft(target?.label ?? '')
  }, [target])

  if (!api || !host || !target) return null

  const commit = () => {
    const text = draft.trim() ? draft : ''
    if (text === target.label) return
    // One undo step; an empty field removes the label.
    updateElements(api, [{ id: target.id, text }])
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Keys typed here are text, never canvas shortcuts.
    event.stopPropagation()
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(target.label)
      focused.current = false
      event.currentTarget.blur()
    }
  }

  return createPortal(
    <fieldset className="tabula-label">
      <legend>
        <label htmlFor={inputId}>Label</label>
      </legend>
      <textarea
        id={inputId}
        className="tabula-label-input"
        rows={2}
        value={draft}
        placeholder="Type to label this shape"
        spellCheck
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          if (focused.current) commit()
          focused.current = false
        }}
        onKeyDown={onKeyDown}
      />
      <p className="tabula-label-hint">⏎ to set · ⇧⏎ new line</p>
    </fieldset>,
    host,
  )
}

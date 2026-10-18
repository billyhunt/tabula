import { useEffect, useRef, useState } from 'react'
import type { AgentSettings } from '../../shared/settings'

interface ModelPickerProps {
  agent: AgentSettings
  /** Anthropic lists its models only once there is a key. */
  keyConfigured: boolean | null
  /** Opens Settings, where the menu's models are chosen. */
  onChooseModels: () => void
}

/**
 * The chat's model button and its menu: the models ticked in Settings, the
 * one in use checked, and a way to Settings to change the list.
 */
export const ModelPicker = ({ agent, keyConfigured, onChooseModels }: ModelPickerProps) => {
  const { provider } = agent
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const root = useRef<HTMLDivElement>(null)

  // Display names come from the provider's list; ids stand in until then, or offline.
  useEffect(() => {
    let live = true
    window.tabula.agent.models().then(
      (models) => live && setLabels(Object.fromEntries(models.map((m) => [m.id, m.label]))),
      () => {},
    )
    return () => {
      live = false
    }
  }, [provider, keyConfigured])

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const current = agent.models[provider]

  const choose = (id: string) => {
    setOpen(false)
    if (id !== current) void window.tabula.settings.update({ agent: { models: { [provider]: id } } })
  }

  return (
    <div
      className="model-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          // Close the menu only; Escape doesn't also stop or leave the chat.
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        className="model-picker-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {labels[current] ?? current}
      </button>
      {open && (
        <div className="model-picker-menu" role="menu" aria-label="Model">
          {agent.enabledModels[provider].map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              aria-checked={id === current}
              className="model-picker-item"
              onClick={() => choose(id)}
            >
              {labels[id] ?? id}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="model-picker-item is-more"
            onClick={() => {
              setOpen(false)
              onChooseModels()
            }}
          >
            Choose models…
          </button>
        </div>
      )}
    </div>
  )
}

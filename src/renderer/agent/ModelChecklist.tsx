import { useEffect, useState } from 'react'
import type { ModelInfo } from '../../shared/ipc'
import type { AgentSettings, SettingsPatch } from '../../shared/settings'
import { remoteErrorMessage } from './remoteError'

// Past this many, a filter box helps (OpenRouter offers hundreds).
const FILTER_FROM = 12

interface ModelChecklistProps {
  agent: AgentSettings
  keyConfigured: boolean
  update: (patch: SettingsPatch) => Promise<void>
}

/**
 * Settings' list of the provider's models: the ticked ones are what the
 * chat's model menu offers. At least one stays ticked, and unticking the
 * model in use moves the chat to the first one left.
 */
export const ModelChecklist = ({ agent, keyConfigured, update }: ModelChecklistProps) => {
  const { provider } = agent
  // Tagged with its provider, so a list being refetched (say, once a key is
  // added) stays on screen, but another provider's list never shows.
  const [fetched, setFetched] = useState<{ provider: string; models: ModelInfo[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let live = true
    setError(null)
    window.tabula.agent.models().then(
      (models) => live && setFetched({ provider, models }),
      (err: unknown) => live && setError(remoteErrorMessage(err)),
    )
    return () => {
      live = false
    }
  }, [provider, keyConfigured])

  const models = fetched?.provider === provider ? fetched.models : null

  const enabled = agent.enabledModels[provider]
  // Ticked models the provider no longer lists still show, so they can be unticked.
  const known = new Set(models?.map((m) => m.id))
  const all: ModelInfo[] = [
    ...(models ?? []),
    ...enabled.filter((id) => !known.has(id)).map((id) => ({ id, label: id })),
  ]
  const query = filter.trim().toLowerCase()
  const shown = query
    ? all.filter((m) => m.label.toLowerCase().includes(query) || m.id.toLowerCase().includes(query))
    : all

  const toggle = (id: string, on: boolean) => {
    const ticked = new Set(enabled)
    if (on) ticked.add(id)
    else ticked.delete(id)
    // Kept in the provider's order, which the chat's menu shows too.
    const next = all.map((m) => m.id).filter((m) => ticked.has(m))
    const inUse = agent.models[provider]
    void update({
      agent: {
        enabledModels: { [provider]: next },
        ...(!on && id === inUse ? { models: { [provider]: next[0] } } : {}),
      },
    })
  }

  return (
    <div className="settings-field">
      <span>Models in the chat</span>
      {error ? (
        <p className="settings-status">
          {keyConfigured ? error : 'Add your API key to see the models.'}
        </p>
      ) : !models ? (
        <p className="settings-status">Loading models…</p>
      ) : null}
      {all.length > FILTER_FROM && (
        <input
          type="search"
          spellCheck={false}
          autoComplete="off"
          placeholder="Filter models"
          aria-label="Filter models"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <ul className="settings-models">
        {shown.map((m) => {
          const on = enabled.includes(m.id)
          return (
            <li key={m.id}>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={on}
                  // The chat always needs one model.
                  disabled={on && enabled.length === 1}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                />
                {m.label}
                {m.label !== m.id && <code>{m.id}</code>}
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

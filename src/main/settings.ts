import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Channels } from '../shared/ipc'
import { isProvider, PROVIDERS, type Provider } from '../shared/providers'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../shared/settings'

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

/** Merges stored values over the defaults, dropping unknown or mistyped keys. */
const coerce = (raw: unknown): Settings => {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = (
    typeof input.agent === 'object' && input.agent !== null ? input.agent : {}
  ) as Record<string, unknown>
  const models = (
    typeof agent.models === 'object' && agent.models !== null ? agent.models : {}
  ) as Record<string, unknown>
  const enabledModels = (
    typeof agent.enabledModels === 'object' && agent.enabledModels !== null
      ? agent.enabledModels
      : {}
  ) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const port = agent.mcpPort
  const model = (provider: Provider) => {
    // Before per-provider models, the one model lived in `agent.model` (Anthropic).
    const value = models[provider] ?? (provider === 'anthropic' ? agent.model : undefined)
    return typeof value === 'string' && value.trim() ? value.trim() : d.agent.models[provider]
  }
  // The chat's model menu: the stored list in its order, cleaned up, with the
  // model in use added at the top if it is missing.
  const enabled = (provider: Provider) => {
    const value = enabledModels[provider]
    const ids = Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim())
      : d.agent.enabledModels[provider]
    return [...new Set(ids.includes(model(provider)) ? ids : [model(provider), ...ids])]
  }
  return {
    lastSaveDir: typeof input.lastSaveDir === 'string' ? input.lastSaveDir : d.lastSaveDir,
    autosave: typeof input.autosave === 'boolean' ? input.autosave : d.autosave,
    showChat: typeof input.showChat === 'boolean' ? input.showChat : d.showChat,
    agent: {
      mcpEnabled:
        typeof agent.mcpEnabled === 'boolean' ? agent.mcpEnabled : d.agent.mcpEnabled,
      mcpPort:
        typeof port === 'number' && Number.isInteger(port) && port > 1023 && port < 65536
          ? port
          : d.agent.mcpPort,
      provider: isProvider(agent.provider) ? agent.provider : d.agent.provider,
      models: Object.fromEntries(PROVIDERS.map((p) => [p, model(p)])) as Record<Provider, string>,
      enabledModels: Object.fromEntries(PROVIDERS.map((p) => [p, enabled(p)])) as Record<
        Provider,
        string[]
      >,
    },
  }
}

let cache: Settings | null = null
const listeners = new Set<(settings: Settings, previous: Settings) => void>()

export const getSettings = (): Settings => {
  if (!cache) {
    try {
      cache = coerce(JSON.parse(readFileSync(settingsFile(), 'utf8')))
    } catch {
      // No settings yet, or unreadable: start from the defaults.
      cache = coerce({})
    }
  }
  return cache
}

// Writes queue up in call order, so the file always ends with the newest
// settings even when two updates land together.
let writing: Promise<void> = Promise.resolve()

/** Applies a patch, persists it, and tells every window and listener. */
export const updateSettings = async (patch: SettingsPatch): Promise<Settings> => {
  const previous = getSettings()
  const next = coerce({
    ...previous,
    ...patch,
    agent: {
      ...previous.agent,
      ...patch.agent,
      models: { ...previous.agent.models, ...patch.agent?.models },
      enabledModels: { ...previous.agent.enabledModels, ...patch.agent?.enabledModels },
    },
  })
  cache = next
  writing = writing
    .catch(() => undefined)
    .then(() => writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8'))
  try {
    await writing
  } finally {
    // The app runs on `cache`; tell everyone even when the write failed (the
    // caller still gets the error), so windows and the menu never disagree.
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(Channels.settingsChanged, next)
    }
    for (const listener of listeners) listener(next, previous)
  }
  return next
}

/** Runs after every settings change; returns the unsubscribe. */
export const onSettingsChanged = (
  listener: (settings: Settings, previous: Settings) => void,
): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

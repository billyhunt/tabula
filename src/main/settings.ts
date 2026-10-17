import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Channels } from '../shared/ipc'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '../shared/settings'

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

/** Merges stored values over the defaults, dropping unknown or mistyped keys. */
const coerce = (raw: unknown): Settings => {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = (
    typeof input.agent === 'object' && input.agent !== null ? input.agent : {}
  ) as Record<string, unknown>
  const d = DEFAULT_SETTINGS
  const port = agent.mcpPort
  return {
    lastSaveDir: typeof input.lastSaveDir === 'string' ? input.lastSaveDir : d.lastSaveDir,
    autosave: typeof input.autosave === 'boolean' ? input.autosave : d.autosave,
    agent: {
      mcpEnabled:
        typeof agent.mcpEnabled === 'boolean' ? agent.mcpEnabled : d.agent.mcpEnabled,
      mcpPort:
        typeof port === 'number' && Number.isInteger(port) && port > 1023 && port < 65536
          ? port
          : d.agent.mcpPort,
      model: typeof agent.model === 'string' && agent.model ? agent.model : d.agent.model,
      apiKeyRef:
        typeof agent.apiKeyRef === 'string' && agent.apiKeyRef.startsWith('op://')
          ? agent.apiKeyRef
          : d.agent.apiKeyRef,
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
  const next = coerce({ ...previous, ...patch, agent: { ...previous.agent, ...patch.agent } })
  cache = next
  writing = writing
    .catch(() => undefined)
    .then(() => writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8'))
  await writing
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(Channels.settingsChanged, next)
  }
  for (const listener of listeners) listener(next, previous)
  return next
}

/** Runs after every settings change; returns the unsubscribe. */
export const onSettingsChanged = (
  listener: (settings: Settings, previous: Settings) => void,
): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

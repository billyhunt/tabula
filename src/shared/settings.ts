/** Persisted app settings, stored in userData/settings.json. */

import { PROVIDER_INFO, type Provider } from './providers'

export interface AgentSettings {
  /** The local MCP server is off until the user turns it on. */
  mcpEnabled: boolean
  mcpPort: number
  /** Service the chat and Text to diagram call. Keys live in main's key store, not here. */
  provider: Provider
  /** The model in use per provider, so switching back keeps each one's choice. */
  models: Record<Provider, string>
  /**
   * The models offered in the chat's model menu, per provider, picked in
   * Settings. Always includes the model in use.
   */
  enabledModels: Record<Provider, string[]>
}

export interface Settings {
  /** Folder the Save dialog opens in; the last place a drawing was saved. */
  lastSaveDir: string | null
  /**
   * Saves the drawing once editing pauses and before its window closes; a
   * drawing never saved gets a new file in Documents/Tabula.
   */
  autosave: boolean
  /** The chat tab in the sidebar, open at launch; View ▸ Show Chat. */
  showChat: boolean
  agent: AgentSettings
}

export interface SettingsPatch {
  lastSaveDir?: string | null
  autosave?: boolean
  showChat?: boolean
  /** `models` and `enabledModels` merge per provider; omitted providers keep theirs. */
  agent?: Partial<Omit<AgentSettings, 'models' | 'enabledModels'>> & {
    models?: Partial<Record<Provider, string>>
    enabledModels?: Partial<Record<Provider, string[]>>
  }
}

export const DEFAULT_SETTINGS: Settings = {
  lastSaveDir: null,
  autosave: true,
  showChat: true,
  agent: {
    mcpEnabled: false,
    mcpPort: 7337,
    provider: 'anthropic',
    models: {
      anthropic: PROVIDER_INFO.anthropic.defaultModel,
      openrouter: PROVIDER_INFO.openrouter.defaultModel,
    },
    enabledModels: {
      anthropic: [PROVIDER_INFO.anthropic.defaultModel],
      openrouter: [PROVIDER_INFO.openrouter.defaultModel],
    },
  },
}

/** The model the current provider uses. */
export const activeModel = (agent: AgentSettings): string => agent.models[agent.provider]

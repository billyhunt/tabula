/** Persisted app settings, stored in userData/settings.json. */

export interface AgentSettings {
  /** The local MCP server is off until the user turns it on. */
  mcpEnabled: boolean
  mcpPort: number
  /** Anthropic model used by the Ask bar and Text to diagram. */
  model: string
  /**
   * 1Password secret reference (op://vault/item/field) for the Anthropic API
   * key. Only the reference is stored; the key itself is read at use time and
   * never written to disk. ANTHROPIC_API_KEY in the environment wins.
   */
  apiKeyRef: string | null
}

export interface Settings {
  /** Folder the Save dialog opens in; the last place a drawing was saved. */
  lastSaveDir: string | null
  /** Saves a drawing that already has a path once editing pauses. */
  autosave: boolean
  agent: AgentSettings
}

export interface SettingsPatch {
  lastSaveDir?: string | null
  autosave?: boolean
  agent?: Partial<AgentSettings>
}

export const DEFAULT_SETTINGS: Settings = {
  lastSaveDir: null,
  autosave: true,
  agent: {
    mcpEnabled: false,
    mcpPort: 7337,
    model: 'claude-sonnet-5-5',
    apiKeyRef: null,
  },
}

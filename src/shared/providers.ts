/** The model services Ask and Text to diagram can call. */

export type Provider = 'anthropic' | 'openrouter'

export const PROVIDERS = ['anthropic', 'openrouter'] as const satisfies readonly Provider[]

export interface ProviderInfo {
  label: string
  /** Environment variable that overrides the saved key. */
  envVar: string
  /** Every key the service issues starts with this. */
  keyPrefix: string
  defaultModel: string
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    keyPrefix: 'sk-ant-',
    defaultModel: 'claude-sonnet-5-5',
  },
  openrouter: {
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    keyPrefix: 'sk-or-',
    defaultModel: 'anthropic/claude-sonnet-5.5',
  },
}

export const isProvider = (value: unknown): value is Provider =>
  PROVIDERS.includes(value as Provider)

/** Why `key` can't be a key for `provider`, or null when it looks right. */
export const keyProblem = (provider: Provider, key: string): string | null => {
  const { label, keyPrefix } = PROVIDER_INFO[provider]
  if (!key.startsWith(keyPrefix)) return `${label} keys start with ${keyPrefix}`
  if (/\s/.test(key)) return 'A key has no spaces or line breaks in it.'
  return null
}

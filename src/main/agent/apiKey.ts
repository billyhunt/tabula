/**
 * Picks the key for a provider: its environment variable, else the key saved
 * in Settings. Pure, so precedence, validation and the client options are
 * testable without Electron.
 */

import type { ClientOptions } from '@anthropic-ai/sdk'
import { PROVIDER_INFO, type Provider } from '../../shared/providers'

export type KeySource = 'env' | 'saved'

/** A problem the user fixes themselves; the message says how. */
export class ApiKeyError extends Error {
  override name = 'ApiKeyError'
}

export type KeyEnv = Record<string, string | undefined>

/** Where the key would come from, without decrypting anything. */
export const keySource = (provider: Provider, env: KeyEnv, saved: boolean): KeySource | null => {
  if (env[PROVIDER_INFO[provider].envVar]?.trim()) return 'env'
  return saved ? 'saved' : null
}

export const noKeyMessage = (provider: Provider) => {
  const { label, envVar } = PROVIDER_INFO[provider]
  return (
    `No ${label} API key is set up. Open Settings (⌘,) and paste one, ` +
    `or start Tabula with ${envVar} set.`
  )
}

export const resolveApiKey = (
  provider: Provider,
  env: KeyEnv,
  readSaved: () => string | null,
): { key: string; source: KeySource } => {
  const fromEnv = env[PROVIDER_INFO[provider].envVar]?.trim()
  if (fromEnv) return { key: fromEnv, source: 'env' }
  const saved = readSaved()
  if (saved) return { key: saved, source: 'saved' }
  throw new ApiKeyError(noKeyMessage(provider))
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api'

/**
 * SDK options for a provider. OpenRouter speaks the Anthropic Messages API
 * and wants its key as a bearer token; the explicit nulls keep the SDK from
 * adding ANTHROPIC_* credentials from the environment to either request.
 */
export const clientOptions = (provider: Provider, key: string): ClientOptions =>
  provider === 'openrouter'
    ? { baseURL: OPENROUTER_BASE_URL, apiKey: null, authToken: key }
    : { apiKey: key, authToken: null }

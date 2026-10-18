import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { AgentStatus, ModelInfo } from '../../shared/ipc'
import { PROVIDER_INFO, PROVIDERS, type Provider } from '../../shared/providers'
import { activeModel } from '../../shared/settings'
import { getSettings } from '../settings'
import { ApiKeyError, clientOptions, keySource, resolveApiKey } from './apiKey'
import { hasSavedKey, readSavedKey } from './keyStore'

/**
 * A Messages API client for the provider chosen in Settings. Anthropic's
 * client honours ANTHROPIC_BASE_URL; OpenRouter's always goes to OpenRouter.
 */
export const anthropicClient = () => {
  const { provider } = getSettings().agent
  const { key } = resolveApiKey(provider, process.env, () => readSavedKey(provider))
  return new Anthropic({ ...clientOptions(provider, key), maxRetries: 2 })
}

/** Key status for Settings and the Ask bar, without decrypting anything. */
export const keyStatus = (): Pick<AgentStatus, 'provider' | 'keys' | 'keyConfigured'> => {
  const { provider } = getSettings().agent
  const keys = Object.fromEntries(
    PROVIDERS.map((p) => [p, keySource(p, process.env, hasSavedKey(p))]),
  ) as AgentStatus['keys']
  return { provider, keys, keyConfigured: keys[provider] !== null }
}

// "Anthropic: Claude Sonnet 5.5" (OpenRouter) or "Claude Sonnet 5.5"
// (Anthropic) → "Sonnet 5.5". Other vendors keep their prefix, since their
// model names alone can be ambiguous.
const shortLabel = (name: string) => name.replace(/^Anthropic:\s*/, '').replace(/^Claude\s+/, '')

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const OpenRouterModels = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      supported_parameters: z.array(z.string()).optional(),
    }),
  ),
})

/** OpenRouter's catalogue, cut to models that can call tools (Ask needs them); Anthropic's first. */
const openRouterModels = async (): Promise<ModelInfo[]> => {
  const response = await fetch(OPENROUTER_MODELS_URL)
  if (!response.ok) throw new Error(`OpenRouter's model list failed (${response.status})`)
  const { data } = OpenRouterModels.parse(await response.json())
  return data
    .filter((m) => m.supported_parameters?.includes('tools'))
    .map((m) => ({ id: m.id, label: shortLabel(m.name) }))
    .sort(
      (a, b) =>
        Number(!a.id.startsWith('anthropic/')) - Number(!b.id.startsWith('anthropic/')) ||
        a.label.localeCompare(b.label),
    )
}

/** Anthropic's models, newest first; needs the key. */
const anthropicModels = async (): Promise<ModelInfo[]> => {
  const models: ModelInfo[] = []
  for await (const m of anthropicClient().models.list({ limit: 100 })) {
    models.push({ id: m.id, label: shortLabel(m.display_name) })
  }
  return models
}

const MODEL_LIST_TTL_MS = 10 * 60_000
const modelLists = new Map<Provider, { at: number; models: ModelInfo[] }>()

/** The chosen provider's models, fetched at most every ten minutes. */
export const listModels = async (): Promise<ModelInfo[]> => {
  const { provider } = getSettings().agent
  const cached = modelLists.get(provider)
  if (cached && Date.now() - cached.at < MODEL_LIST_TTL_MS) return cached.models
  const models = provider === 'openrouter' ? await openRouterModels() : await anthropicModels()
  modelLists.set(provider, { at: Date.now(), models })
  return models
}

export const isAbort = (err: unknown) =>
  err instanceof APIUserAbortError || (err instanceof Error && err.name === 'AbortError')

/** Turns SDK and key errors into one sentence the user can act on. */
export const describeError = (err: unknown): string => {
  if (err instanceof ApiKeyError) return err.message
  const { agent } = getSettings()
  const { label } = PROVIDER_INFO[agent.provider]
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return `${label} rejected the API key. Check the key in Settings.`
  }
  if (err instanceof NotFoundError) {
    return `${label} doesn't know the model "${activeModel(agent)}". Change it in Settings.`
  }
  if (err instanceof RateLimitError) return `${label} is rate limiting requests. Try again shortly.`
  if (err instanceof APIConnectionError) return `Couldn't reach ${label}: ${err.message}`
  if (err instanceof APIError) return `${label} error ${err.status ?? ''}: ${err.message}`.trim()
  return err instanceof Error ? err.message : String(err)
}

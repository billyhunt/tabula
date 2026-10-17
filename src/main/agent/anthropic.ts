import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { promisify } from 'node:util'
import Anthropic, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk'
import { getSettings } from '../settings'
import { ApiKeyError, keySource, resolveApiKey, type KeySource } from './apiKey'

const run = promisify(execFile)

const isExecutable = (file: string) =>
  access(file, constants.X_OK).then(
    () => true,
    () => false,
  )

// The key lives in memory for the app's lifetime only, tagged with the
// reference it came from so a changed reference is read afresh. The promise
// is cached so concurrent requests share one 1Password unlock prompt.
let cached: { ref: string | null; key: Promise<string> } | null = null

const apiKey = (): Promise<string> => {
  const ref = getSettings().agent.apiKeyRef
  if (cached?.ref === ref) return cached.key
  const key = resolveApiKey({
    env: process.env,
    apiKeyRef: ref,
    isExecutable,
    // Touch ID or a password prompt may stand between us and the secret.
    execFile: (file, args) => run(file, args, { timeout: 120_000, encoding: 'utf8' }),
  }).then((resolved) => resolved.key)
  const entry = { ref, key }
  cached = entry
  // A failed read must not stick: the user may unlock 1Password and retry.
  key.catch(() => {
    if (cached === entry) cached = null
  })
  return key
}

/** A client for the current key. ANTHROPIC_BASE_URL is honoured by the SDK. */
export const anthropicClient = async () =>
  new Anthropic({ apiKey: await apiKey(), maxRetries: 2 })

/** Key status for Settings, without reading the secret. */
export const keyStatus = (): { keyConfigured: boolean; keySource: KeySource | null } => {
  const source = keySource(process.env, getSettings().agent.apiKeyRef)
  return { keyConfigured: source !== null, keySource: source }
}

export const isAbort = (err: unknown) =>
  err instanceof APIUserAbortError || (err instanceof Error && err.name === 'AbortError')

/** Turns SDK and key errors into one sentence the user can act on. */
export const describeError = (err: unknown): string => {
  if (err instanceof ApiKeyError) return err.message
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    // The key may have been rotated; read it again next time.
    cached = null
    return 'Anthropic rejected the API key. Check the key your 1Password reference points to.'
  }
  if (err instanceof NotFoundError) {
    return `Anthropic doesn't know the model "${getSettings().agent.model}". Change it in Settings.`
  }
  if (err instanceof RateLimitError) return 'Anthropic is rate limiting requests. Try again shortly.'
  if (err instanceof APIConnectionError) return `Couldn't reach Anthropic: ${err.message}`
  if (err instanceof APIError) return `Anthropic error ${err.status ?? ''}: ${err.message}`.trim()
  return err instanceof Error ? err.message : String(err)
}

import Anthropic from '@anthropic-ai/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiKeyError,
  clientOptions,
  keySource,
  noKeyMessage,
  resolveApiKey,
} from '../src/main/agent/apiKey'
import { keyProblem } from '../src/shared/providers'

describe('resolveApiKey', () => {
  it("prefers the provider's environment variable and never decrypts the saved key", () => {
    const readSaved = vi.fn(() => 'sk-ant-saved')
    expect(resolveApiKey('anthropic', { ANTHROPIC_API_KEY: ' sk-ant-env ' }, readSaved)).toEqual({
      key: 'sk-ant-env',
      source: 'env',
    })
    expect(readSaved).not.toHaveBeenCalled()
  })

  it("ignores another provider's environment variable", () => {
    const result = resolveApiKey('openrouter', { ANTHROPIC_API_KEY: 'sk-ant-env' }, () => 'sk-or-saved')
    expect(result).toEqual({ key: 'sk-or-saved', source: 'saved' })
  })

  it('treats a blank environment variable as unset', () => {
    expect(resolveApiKey('openrouter', { OPENROUTER_API_KEY: '  ' }, () => 'sk-or-saved').source).toBe(
      'saved',
    )
  })

  it('says how to add a key when there is none', () => {
    expect(() => resolveApiKey('openrouter', {}, () => null)).toThrow(ApiKeyError)
    expect(() => resolveApiKey('openrouter', {}, () => null)).toThrow(noKeyMessage('openrouter'))
    expect(noKeyMessage('openrouter')).toMatch(/OpenRouter.*Settings.*OPENROUTER_API_KEY/)
  })
})

describe('keySource', () => {
  it('reports where the key would come from', () => {
    expect(keySource('anthropic', { ANTHROPIC_API_KEY: 'x' }, true)).toBe('env')
    expect(keySource('anthropic', {}, true)).toBe('saved')
    expect(keySource('openrouter', { ANTHROPIC_API_KEY: 'x' }, false)).toBeNull()
  })
})

describe('keyProblem', () => {
  it("catches a key pasted under the wrong provider, or one that isn't a key", () => {
    expect(keyProblem('anthropic', 'sk-ant-api03-abc')).toBeNull()
    expect(keyProblem('openrouter', 'sk-or-v1-abc')).toBeNull()
    expect(keyProblem('openrouter', 'sk-ant-api03-abc')).toMatch(/sk-or-/)
    expect(keyProblem('anthropic', 'sk-ant-api03 abc')).toMatch(/spaces/)
  })
})

describe('clientOptions', () => {
  afterEach(() => vi.unstubAllEnvs())

  const firstRequest = async (options: ConstructorParameters<typeof Anthropic>[0]) => {
    const fetch = vi.fn(async () => new Response('{}', { status: 500 }))
    const client = new Anthropic({ ...options, fetch, maxRetries: 0 })
    await client.messages
      .create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      .catch(() => undefined)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    return { url, headers: new Headers(init.headers) }
  }

  it('sends OpenRouter keys to OpenRouter as a bearer token, never Anthropic credentials or headers', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-from-env')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://127.0.0.1:1')
    vi.stubEnv('ANTHROPIC_CUSTOM_HEADERS', 'x-gateway-key: secret\nx-team: design')
    const { url, headers } = await firstRequest(
      clientOptions('openrouter', 'sk-or-v1-key', process.env),
    )
    expect(url).toBe('https://openrouter.ai/api/v1/messages')
    expect(headers.get('authorization')).toBe('Bearer sk-or-v1-key')
    expect(headers.get('x-api-key')).toBeNull()
    expect(headers.get('x-gateway-key')).toBeNull()
    expect(headers.get('x-team')).toBeNull()
  })

  it('sends Anthropic keys as x-api-key, without a stray bearer token', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'token-from-env')
    vi.stubEnv('ANTHROPIC_BASE_URL', '')
    const { url, headers } = await firstRequest(clientOptions('anthropic', 'sk-ant-key', process.env))
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers.get('x-api-key')).toBe('sk-ant-key')
    expect(headers.get('authorization')).toBeNull()
  })
})

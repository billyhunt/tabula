import { describe, expect, it, vi } from 'vitest'
import {
  ApiKeyError,
  NO_KEY_MESSAGE,
  NO_OP_MESSAGE,
  cleanOpError,
  keySource,
  resolveApiKey,
  type KeyDeps,
} from '../src/main/agent/apiKey'

const REF = 'op://Private/Anthropic/credential'

const deps = (overrides: Partial<KeyDeps> = {}): KeyDeps => ({
  env: {},
  apiKeyRef: REF,
  isExecutable: async (file) => file === '/opt/homebrew/bin/op',
  execFile: async () => ({ stdout: 'sk-ant-from-1password\n' }),
  ...overrides,
})

describe('resolveApiKey', () => {
  it('prefers ANTHROPIC_API_KEY and never runs op', async () => {
    const execFile = vi.fn()
    const result = await resolveApiKey(
      deps({ env: { ANTHROPIC_API_KEY: ' sk-ant-env ' }, execFile }),
    )
    expect(result).toEqual({ key: 'sk-ant-env', source: 'env' })
    expect(execFile).not.toHaveBeenCalled()
  })

  it('reads the 1Password reference with op read, without a shell', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'sk-ant-from-1password\n' }))
    const result = await resolveApiKey(deps({ execFile }))
    expect(result).toEqual({ key: 'sk-ant-from-1password', source: '1password' })
    expect(execFile).toHaveBeenCalledWith('/opt/homebrew/bin/op', ['read', REF])
  })

  it('finds op on PATH when it is not in a Homebrew location', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'k' }))
    await resolveApiKey(
      deps({
        env: { PATH: '/usr/bin:/Users/me/bin/' },
        isExecutable: async (file) => file === '/Users/me/bin/op',
        execFile,
      }),
    )
    expect(execFile).toHaveBeenCalledWith('/Users/me/bin/op', ['read', REF])
  })

  it('tells the user to set a reference when nothing is configured', async () => {
    const pending = resolveApiKey(deps({ apiKeyRef: null }))
    await expect(pending).rejects.toBeInstanceOf(ApiKeyError)
    await expect(pending).rejects.toThrow(NO_KEY_MESSAGE)
    expect(NO_KEY_MESSAGE).toMatch(/Settings/)
  })

  it('says when the op CLI is missing', async () => {
    await expect(resolveApiKey(deps({ isExecutable: async () => false }))).rejects.toThrow(
      NO_OP_MESSAGE,
    )
  })

  it("passes on op's stderr, without timestamps or anything key-shaped", async () => {
    const failure = Object.assign(new Error('Command failed'), {
      stderr:
        '[ERROR] 2026/10/17 09:12:44 could not read secret op://Private/Anthropic/credential: ' +
        'item has value sk-ant-api03-SECRET_value-1\n',
    })
    const error = await resolveApiKey(
      deps({
        execFile: async () => {
          throw failure
        },
      }),
    ).catch((err: unknown) => err)
    if (!(error instanceof ApiKeyError)) throw new Error(`expected an ApiKeyError, got ${error}`)
    const message = error.message
    expect(message).toContain(`1Password couldn't read ${REF}: could not read secret`)
    expect(message).not.toContain('SECRET')
    expect(message).not.toContain('2026/10/17')
  })

  it('rejects an empty secret', async () => {
    await expect(resolveApiKey(deps({ execFile: async () => ({ stdout: '\n' }) }))).rejects.toThrow(
      /empty value/,
    )
  })
})

describe('keySource', () => {
  it('reports the source without reading anything', () => {
    expect(keySource({ ANTHROPIC_API_KEY: 'x' }, REF)).toBe('env')
    expect(keySource({ ANTHROPIC_API_KEY: '  ' }, REF)).toBe('1password')
    expect(keySource({}, null)).toBeNull()
  })
})

describe('cleanOpError', () => {
  it('keeps the message readable and short', () => {
    expect(cleanOpError('[ERROR] 2026/01/02 03:04:05 You are not signed in.\n')).toBe(
      'You are not signed in.',
    )
    expect(cleanOpError('x'.repeat(1000))).toHaveLength(300)
  })
})

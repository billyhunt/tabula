import { describe, expect, it } from 'vitest'
import { enqueueInstall, MAX_PENDING_INSTALLS, truncateForDialog } from '../src/main/libraryQueue'
import { safePackagedBaseUrl } from '../src/main/agent/apiKey'

describe('enqueueInstall', () => {
  it('drops duplicates and caps the queue', () => {
    const queue: { url: string }[] = []
    expect(enqueueInstall(queue, { url: 'a' })).toBe(true)
    expect(enqueueInstall(queue, { url: 'a' })).toBe(false)
    for (let i = 0; i < 10; i++) enqueueInstall(queue, { url: `u${i}` })
    expect(queue).toHaveLength(MAX_PENDING_INSTALLS)
  })
})

describe('truncateForDialog', () => {
  it('shortens long text only', () => {
    expect(truncateForDialog('short')).toBe('short')
    expect(truncateForDialog('x'.repeat(500)).length).toBe(201)
  })
})

describe('safePackagedBaseUrl', () => {
  it('accepts https and loopback http', () => {
    for (const ok of ['https://example.com', 'http://127.0.0.1:4000', 'http://localhost:1', 'http://[::1]:9']) {
      expect(safePackagedBaseUrl(ok)).toBe(ok)
    }
  })
  it('rejects everything else', () => {
    for (const bad of [undefined, '', 'nonsense', 'http://example.com', 'ftp://localhost', 'http://127.0.0.1.evil.com', 'file:///x']) {
      expect(safePackagedBaseUrl(bad)).toBeUndefined()
    }
  })
})

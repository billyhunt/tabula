import { app, safeStorage } from 'electron'
import { readFileSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isProvider, PROVIDER_INFO, type Provider } from '../../shared/providers'
import { ApiKeyError } from './apiKey'

/**
 * API keys pasted into Settings, one per provider. Each is encrypted with
 * safeStorage (a key held in the macOS Keychain) and written to userData as
 * base64. Keys stay in main: the renderer only learns whether one is saved.
 */

type StoredKeys = Partial<Record<Provider, string>>

const keysFile = () => path.join(app.getPath('userData'), 'api-keys.json')

let stored: StoredKeys | null = null

const load = (): StoredKeys => {
  if (stored) return stored
  stored = {}
  try {
    const raw: unknown = JSON.parse(readFileSync(keysFile(), 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      for (const [provider, value] of Object.entries(raw)) {
        if (isProvider(provider) && typeof value === 'string') stored[provider] = value
      }
    }
  } catch {
    // No keys saved yet, or an unreadable file: treat as none.
  }
  return stored
}

export const hasSavedKey = (provider: Provider): boolean => Boolean(load()[provider])

export const readSavedKey = (provider: Provider): string | null => {
  const encrypted = load()[provider]
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    // Encrypted by another install, or the Keychain entry was reset.
    throw new ApiKeyError(
      `Tabula can't decrypt the saved ${PROVIDER_INFO[provider].label} key. Paste it again in Settings.`,
    )
  }
}

// Writes queue in call order so the file ends with the newest keys.
let writing: Promise<void> = Promise.resolve()

/** Saves the key for `provider`, or removes it when `key` is null. */
export const saveKey = async (provider: Provider, key: string | null): Promise<void> => {
  const next = { ...load() }
  if (key === null) {
    delete next[provider]
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Tabula can't encrypt the key on this Mac, so it wasn't saved.")
    }
    next[provider] = safeStorage.encryptString(key).toString('base64')
  }
  stored = next
  writing = writing
    .catch(() => undefined)
    .then(async () => {
      await writeFile(keysFile(), JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
      // mode only applies when the file is created; make sure of it on replace.
      await chmod(keysFile(), 0o600)
    })
  await writing
}

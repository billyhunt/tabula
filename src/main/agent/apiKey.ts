/**
 * Finds the Anthropic API key without ever storing it: ANTHROPIC_API_KEY from
 * the environment, else a 1Password secret reference read with `op read`.
 *
 * Pure apart from the injected process helpers, so precedence and the error
 * messages are testable without Electron or a real 1Password.
 */

export type KeySource = 'env' | '1password'

/** A problem the user fixes themselves; the message says how. */
export class ApiKeyError extends Error {
  override name = 'ApiKeyError'
}

export interface KeyEnv {
  ANTHROPIC_API_KEY?: string
  PATH?: string
}

/** Where a key would come from, without reading the secret. */
export const keySource = (env: KeyEnv, apiKeyRef: string | null): KeySource | null => {
  if (env.ANTHROPIC_API_KEY?.trim()) return 'env'
  if (apiKeyRef) return '1password'
  return null
}

// Apps launched from Finder get a minimal PATH that misses Homebrew, so the
// usual install locations are checked before PATH.
const OP_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']

export const opCandidates = (pathEnv: string | undefined): string[] => {
  const dirs = [...OP_DIRS, ...(pathEnv ?? '').split(':').filter(Boolean)]
  return [...new Set(dirs)].map((dir) => `${dir.replace(/\/+$/, '')}/op`)
}

export interface KeyDeps {
  env: KeyEnv
  apiKeyRef: string | null
  isExecutable: (file: string) => Promise<boolean>
  /** Runs a binary without a shell; rejects with stderr attached on failure. */
  execFile: (file: string, args: string[]) => Promise<{ stdout: string }>
}

export const NO_KEY_MESSAGE =
  'No Anthropic API key is set up. Open Settings (⌘,) and enter a 1Password reference ' +
  'such as op://Private/Anthropic/credential, or start Tabula with ANTHROPIC_API_KEY set.'

export const NO_OP_MESSAGE =
  "The 1Password CLI (op) isn't installed. Install it with `brew install 1password-cli` " +
  "and turn on 'Integrate with 1Password CLI' in 1Password's Developer settings, " +
  'or start Tabula with ANTHROPIC_API_KEY set.'

/**
 * op's stderr reads like "[ERROR] 2026/10/17 09:12:44 could not read secret …".
 * The timestamp is noise, and anything shaped like a key is masked in case a
 * misconfigured item echoes its value.
 */
export const cleanOpError = (stderr: string): string =>
  stderr
    .replace(/sk-ant-[\w-]+/g, '[redacted]')
    .replace(/\[(ERROR|WARN)\]\s+\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s*/g, '')
    .trim()
    .slice(0, 300)

const stderrOf = (err: unknown): string => {
  if (typeof err !== 'object' || err === null) return String(err)
  if ('stderr' in err && typeof err.stderr === 'string' && err.stderr.trim()) return err.stderr
  return err instanceof Error ? err.message : String(err)
}

export const resolveApiKey = async (deps: KeyDeps): Promise<{ key: string; source: KeySource }> => {
  const envKey = deps.env.ANTHROPIC_API_KEY?.trim()
  if (envKey) return { key: envKey, source: 'env' }

  const ref = deps.apiKeyRef
  if (!ref) throw new ApiKeyError(NO_KEY_MESSAGE)

  let op: string | null = null
  for (const candidate of opCandidates(deps.env.PATH)) {
    if (await deps.isExecutable(candidate)) {
      op = candidate
      break
    }
  }
  if (!op) throw new ApiKeyError(NO_OP_MESSAGE)

  let stdout: string
  try {
    ;({ stdout } = await deps.execFile(op, ['read', ref]))
  } catch (err) {
    const detail = cleanOpError(stderrOf(err))
    throw new ApiKeyError(
      `1Password couldn't read ${ref}${detail ? `: ${detail}` : ''}. ` +
        'Check the reference in Settings and that 1Password is unlocked.',
    )
  }
  const key = stdout.trim()
  if (!key) throw new ApiKeyError(`1Password returned an empty value for ${ref}.`)
  return { key, source: '1password' }
}

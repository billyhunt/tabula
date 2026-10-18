import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentStatus } from '../../shared/ipc'
import { isProvider, keyProblem, PROVIDER_INFO, PROVIDERS, type Provider } from '../../shared/providers'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { useMenuCommand } from '../menuCommands'
import { ModelChecklist } from './ModelChecklist'
import { remoteErrorMessage } from './remoteError'

// The MCP server starts and stops in the background after a toggle, so its
// status is re-read while the dialog is open.
const STATUS_POLL_MS = 1000
const NOTE_MS = 2500

/**
 * Open state for the Settings dialog; the menu's Settings… item opens it.
 * `show({ askForKey: true })` opens it at the API key, saying one is needed.
 */
export const useSettingsDialog = () => {
  const [state, setState] = useState<{ open: boolean; askForKey: boolean }>({
    open: false,
    askForKey: false,
  })
  useMenuCommand('settings', () => setState({ open: true, askForKey: false }))
  const show = useCallback(
    (options?: { askForKey?: boolean }) =>
      setState({ open: true, askForKey: options?.askForKey ?? false }),
    [],
  )
  const close = useCallback(() => setState({ open: false, askForKey: false }), [])
  return { ...state, show, close }
}

interface SettingsDialogProps {
  open: boolean
  askForKey: boolean
  close: () => void
}

export const SettingsDialog = ({ open, askForKey, close }: SettingsDialogProps) =>
  open ? <SettingsPanel close={close} askForKey={askForKey} /> : null

/** A short-lived confirmation line, e.g. "Copied". */
const useNote = () => {
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const show = useCallback((text: string) => {
    setNote(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNote(null), NOTE_MS)
  }, [])
  return [note, show] as const
}

const SettingsPanel = ({ close, askForKey }: { close: () => void; askForKey: boolean }) => {
  const titleId = useId()
  const fieldId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [port, setPort] = useState('')
  const [keyDraft, setKeyDraft] = useState('')
  const [errors, setErrors] = useState<{ port?: string; key?: string }>({})
  const [mcpNote, showMcpNote] = useNote()
  const [aiNote, showAiNote] = useNote()

  // Drafts take the saved values on open and after each save here; other
  // changes (such as the menu's Autosave item) only refresh the toggles.
  const adopt = useCallback((next: Settings) => {
    setSettings(next)
    setPort(String(next.agent.mcpPort))
  }, [])

  useEffect(() => {
    void window.tabula.settings.get().then(adopt)
    return window.tabula.settings.onChange(setSettings)
  }, [adopt])

  useEffect(() => {
    let live = true
    const refresh = () =>
      window.tabula.agent.status().then(
        (next) => live && setStatus(next),
        () => {},
      )
    void refresh()
    const timer = window.setInterval(refresh, STATUS_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [])

  // Sent here for a key: go straight to its field. The panel renders it once
  // settings arrive, hence the dependency.
  useEffect(() => {
    if (askForKey) keyInput.current?.focus()
    else panel.current?.focus()
  }, [askForKey, settings !== null])

  const update = async (patch: SettingsPatch) => {
    adopt(await window.tabula.settings.update(patch))
    setStatus(await window.tabula.agent.status())
  }

  const commitPort = () => {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      setErrors((e) => ({ ...e, port: 'Use a whole number from 1024 to 65535.' }))
      return
    }
    setErrors((e) => ({ ...e, port: undefined }))
    if (value !== settings?.agent.mcpPort) void update({ agent: { mcpPort: value } })
  }

  const provider = settings?.agent.provider ?? 'anthropic'
  const info = PROVIDER_INFO[provider]

  const chooseProvider = (next: Provider) => {
    setKeyDraft('')
    setErrors((e) => ({ ...e, key: undefined }))
    void update({ agent: { provider: next } })
  }

  const setKey = async (key: string | null, note: string) => {
    try {
      await window.tabula.agent.setKey(provider, key)
      setKeyDraft('')
      setStatus(await window.tabula.agent.status())
      showAiNote(note)
    } catch (err) {
      showAiNote(`Couldn't save the key: ${remoteErrorMessage(err)}`)
    }
  }

  // Leaving an empty field changes nothing; a saved key is never shown.
  const commitKey = () => {
    const value = keyDraft.trim()
    if (!value) {
      setErrors((e) => ({ ...e, key: undefined }))
      return
    }
    const problem = keyProblem(provider, value)
    setErrors((e) => ({ ...e, key: problem ?? undefined }))
    if (!problem) void setKey(value, 'Key saved')
  }

  const copySetup = async () => {
    try {
      await window.tabula.exports.copyText(await window.tabula.agent.setupCommand())
      showMcpNote('Copied. Paste it into a terminal to connect Claude Code.')
    } catch (err) {
      showMcpNote(`Couldn't copy: ${remoteErrorMessage(err)}`)
    }
  }

  const resetToken = async () => {
    try {
      await window.tabula.agent.resetToken()
      showMcpNote('New token made. Connected agents need the new setup command.')
    } catch (err) {
      showMcpNote(`Couldn't reset: ${remoteErrorMessage(err)}`)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // The canvas must not see keys typed into Settings.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  // Enter in a field saves it, as leaving the field does.
  const commitOnEnter = (commit: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter') commit()
  }

  const mcp = status?.mcp
  const mcpLine = !mcp
    ? ''
    : !mcp.enabled
      ? 'Off. Agents on this Mac cannot reach the board.'
      : mcp.running
        ? `Listening at ${mcp.url}`
        : (mcp.error ?? 'Starting…')

  const keySource = status?.keys[provider]
  const keyLine =
    keySource === 'env'
      ? `Using ${info.envVar} from the environment. It takes precedence over a saved key.`
      : keySource === 'saved'
        ? 'A key is saved, encrypted with your Mac’s Keychain. Paste another to replace it.'
        : `Not set. Paste your ${info.label} API key to use Ask and Text to diagram.`

  return (
    <div
      className="settings-backdrop"
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={panel}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="settings-header">
          <h2 id={titleId}>Settings</h2>
          <button type="button" className="agent-button" onClick={close} aria-label="Close settings">
            Close
          </button>
        </header>

        {settings && (
          <>
            <section className="settings-section" aria-labelledby={`${fieldId}-drawing`}>
              <h3 id={`${fieldId}-drawing`}>Drawing</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.autosave}
                  onChange={(e) => void update({ autosave: e.target.checked })}
                />
                Autosave drawings (ones never saved go to Documents/Tabula)
              </label>
            </section>

            <section className="settings-section" aria-labelledby={`${fieldId}-mcp`}>
              <h3 id={`${fieldId}-mcp`}>Agent connections (MCP)</h3>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={settings.agent.mcpEnabled}
                  onChange={(e) => void update({ agent: { mcpEnabled: e.target.checked } })}
                />
                Allow agents such as Claude Code to work on the open board
              </label>
              <label className="settings-field">
                <span>Port</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1024}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  onBlur={commitPort}
                  onKeyDown={commitOnEnter(commitPort)}
                  aria-invalid={Boolean(errors.port)}
                  aria-describedby={`${fieldId}-port-error`}
                />
              </label>
              <p id={`${fieldId}-port-error`} className="settings-error" hidden={!errors.port}>
                {errors.port}
              </p>
              <p
                className={`settings-status${mcp?.error ? ' is-error' : ''}`}
                aria-live="polite"
              >
                {mcpLine}
              </p>
              <div className="settings-actions">
                <button type="button" className="agent-button is-primary" onClick={copySetup}>
                  Copy Claude Code setup command
                </button>
                <button type="button" className="agent-button" onClick={resetToken}>
                  Reset token
                </button>
              </div>
              <p className="settings-note" role="status">
                {mcpNote}
              </p>
            </section>

            <section className="settings-section" aria-labelledby={`${fieldId}-ai`}>
              <h3 id={`${fieldId}-ai`}>AI</h3>
              {askForKey && !status?.keyConfigured && (
                <p className="settings-ask" role="alert">
                  Add your API key.
                </p>
              )}
              <label className="settings-field">
                <span>Provider</span>
                <select
                  value={provider}
                  onChange={(e) => {
                    if (isProvider(e.target.value)) chooseProvider(e.target.value)
                  }}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_INFO[p].label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="settings-status">{status ? keyLine : ''}</p>
              <label className="settings-field">
                <span>{info.label} API key</span>
                <input
                  ref={keyInput}
                  type="password"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={`${info.keyPrefix}…`}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onBlur={commitKey}
                  onKeyDown={commitOnEnter(commitKey)}
                  aria-invalid={Boolean(errors.key)}
                  aria-describedby={`${fieldId}-key-error`}
                />
              </label>
              <p id={`${fieldId}-key-error`} className="settings-error" hidden={!errors.key}>
                {errors.key}
              </p>
              {keySource === 'saved' && (
                <div className="settings-actions">
                  <button
                    type="button"
                    className="agent-button"
                    onClick={() => void setKey(null, 'Key removed')}
                  >
                    Remove saved key
                  </button>
                </div>
              )}
              <ModelChecklist
                agent={settings.agent}
                keyConfigured={Boolean(status?.keyConfigured)}
                update={update}
              />
              <p className="settings-note" role="status">
                {aiNote}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

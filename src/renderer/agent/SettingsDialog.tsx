import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentStatus } from '../../shared/ipc'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { useMenuCommand } from '../menuCommands'
import { remoteErrorMessage } from './remoteError'

// The MCP server starts and stops in the background after a toggle, so its
// status is re-read while the dialog is open.
const STATUS_POLL_MS = 1000
const NOTE_MS = 2500

const OP_REF = /^op:\/\/[^/]+\/[^/]+\/.+/

/** Open state for the Settings dialog; the menu's Settings… item opens it. */
export const useSettingsDialog = () => {
  const [open, setOpen] = useState(false)
  useMenuCommand('settings', () => setOpen(true))
  const show = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  return { open, show, close }
}

interface SettingsDialogProps {
  open: boolean
  close: () => void
}

export const SettingsDialog = ({ open, close }: SettingsDialogProps) =>
  open ? <SettingsPanel close={close} /> : null

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

const SettingsPanel = ({ close }: { close: () => void }) => {
  const titleId = useId()
  const fieldId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [port, setPort] = useState('')
  const [ref, setRef] = useState('')
  const [model, setModel] = useState('')
  const [errors, setErrors] = useState<{ port?: string; ref?: string; model?: string }>({})
  const [mcpNote, showMcpNote] = useNote()
  const [claudeNote, showClaudeNote] = useNote()

  // Drafts take the saved values on open and after each save here; other
  // changes (such as the menu's Autosave item) only refresh the toggles.
  const adopt = useCallback((next: Settings) => {
    setSettings(next)
    setPort(String(next.agent.mcpPort))
    setRef(next.agent.apiKeyRef ?? '')
    setModel(next.agent.model)
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

  useEffect(() => panel.current?.focus(), [])

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

  const commitRef = () => {
    const value = ref.trim()
    if (value && !OP_REF.test(value)) {
      setErrors((e) => ({ ...e, ref: 'A 1Password reference looks like op://vault/item/field.' }))
      return
    }
    setErrors((e) => ({ ...e, ref: undefined }))
    const next = value || null
    if (next !== settings?.agent.apiKeyRef) {
      void update({ agent: { apiKeyRef: next } }).then(() => showClaudeNote('Saved'))
    }
  }

  const commitModel = () => {
    const value = model.trim()
    if (!value) {
      setErrors((e) => ({ ...e, model: 'Enter a model name, such as claude-sonnet-5-5.' }))
      return
    }
    setErrors((e) => ({ ...e, model: undefined }))
    if (value !== settings?.agent.model) {
      void update({ agent: { model: value } }).then(() => showClaudeNote('Saved'))
    }
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

  const keyLine =
    status?.keySource === 'env'
      ? 'Using ANTHROPIC_API_KEY from the environment. It takes precedence over 1Password.'
      : status?.keySource === '1password'
        ? 'Read from 1Password the first time you ask, then kept in memory until Tabula quits.'
        : 'Not set. Add a 1Password reference to use Ask and Text to diagram.'

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
                Autosave drawings that have a file
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

            <section className="settings-section" aria-labelledby={`${fieldId}-claude`}>
              <h3 id={`${fieldId}-claude`}>Claude</h3>
              <p className="settings-status">{status ? keyLine : ''}</p>
              <label className="settings-field">
                <span>API key in 1Password</span>
                <input
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="op://Private/Anthropic/credential"
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  onBlur={commitRef}
                  onKeyDown={commitOnEnter(commitRef)}
                  aria-invalid={Boolean(errors.ref)}
                  aria-describedby={`${fieldId}-ref-error`}
                />
              </label>
              <p id={`${fieldId}-ref-error`} className="settings-error" hidden={!errors.ref}>
                {errors.ref}
              </p>
              <label className="settings-field">
                <span>Model</span>
                <input
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={commitModel}
                  onKeyDown={commitOnEnter(commitModel)}
                  aria-invalid={Boolean(errors.model)}
                  aria-describedby={`${fieldId}-model-error`}
                />
              </label>
              <p id={`${fieldId}-model-error`} className="settings-error" hidden={!errors.model}>
                {errors.model}
              </p>
              <p className="settings-note" role="status">
                {claudeNote}
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

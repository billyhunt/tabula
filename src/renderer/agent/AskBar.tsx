import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { AskEvent } from '../../shared/ipc'
import { useMenuCommand } from '../menuCommands'
import { remoteErrorMessage } from './remoteError'

type Step = { kind: 'text'; text: string } | { kind: 'tool'; summary: string }

interface Run {
  prompt: string
  steps: Step[]
  state: 'running' | 'done' | 'error' | 'stopped'
  error?: string
}

/** Folds one streamed event into the run shown in the bar. */
const applyEvent = (run: Run, event: AskEvent): Run => {
  // Once stopped, late events from main are noise.
  if (run.state !== 'running') return run
  switch (event.type) {
    case 'text': {
      const last = run.steps.at(-1)
      // Consecutive deltas grow one paragraph; a tool step starts a new one.
      const steps: Step[] =
        last?.kind === 'text'
          ? [...run.steps.slice(0, -1), { kind: 'text', text: last.text + event.text }]
          : [...run.steps, { kind: 'text', text: event.text }]
      return { ...run, steps }
    }
    case 'tool':
      return { ...run, steps: [...run.steps, { kind: 'tool', summary: event.summary }] }
    case 'done':
      return { ...run, state: 'done' }
    case 'error':
      return { ...run, state: 'error', error: event.error }
  }
}

interface AskBarProps {
  api: ExcalidrawImperativeAPI | null
  onOpenSettings: () => void
}

/**
 * ⌘J: a bar over the canvas for asking Claude to work on the board. Each
 * question is a fresh run; the bar stays open to ask a follow-up.
 */
export const AskBar = ({ api, onOpenSettings }: AskBarProps) => {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [selected, setSelected] = useState(0)
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const log = useRef<HTMLDivElement>(null)
  // The run main is streaming to us. Events can beat ask()'s reply, so they
  // are held until the runId is known.
  const runId = useRef<string | null>(null)
  const starting = useRef(false)
  const early = useRef<AskEvent[]>([])
  const stopWhenStarted = useRef(false)

  useMenuCommand('ask', () => setOpen((wasOpen) => !wasOpen))

  useEffect(
    () =>
      window.tabula.agent.onAskEvent((event) => {
        if (starting.current) early.current.push(event)
        else if (event.runId === runId.current) setRun((r) => r && applyEvent(r, event))
      }),
    [],
  )

  // Whether a key is set up, re-checked when Settings change it.
  useEffect(() => {
    if (!open) return
    let live = true
    const check = () =>
      window.tabula.agent.status().then(
        (status) => live && setKeyConfigured(status.keyConfigured),
        () => {},
      )
    void check()
    const stop = window.tabula.settings.onChange(() => void check())
    return () => {
      live = false
      stop()
    }
  }, [open])

  useEffect(() => {
    if (!open || !api) return
    setSelected(Object.keys(api.getAppState().selectedElementIds).length)
    return api.onChange((_elements, state) =>
      setSelected(Object.keys(state.selectedElementIds).length),
    )
  }, [api, open])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open, keyConfigured])

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [run])

  const running = run?.state === 'running'

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = prompt.trim()
    if (!text || running) return
    setPrompt('')
    setRun({ prompt: text, steps: [], state: 'running' })
    runId.current = null
    starting.current = true
    stopWhenStarted.current = false
    early.current = []
    try {
      const started = await window.tabula.agent.ask({ prompt: text })
      runId.current = started.runId
      const buffered = early.current.filter((e) => e.runId === started.runId)
      setRun((r) => r && buffered.reduce(applyEvent, r))
      if (stopWhenStarted.current) window.tabula.agent.cancel(started.runId)
    } catch (err) {
      setRun((r) => r && { ...r, state: 'error', error: remoteErrorMessage(err) })
    } finally {
      starting.current = false
      early.current = []
    }
  }

  const stop = () => {
    if (runId.current) window.tabula.agent.cancel(runId.current)
    else stopWhenStarted.current = true
    setRun((r) => r && { ...r, state: 'stopped' })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    // Typing here must not trigger Excalidraw's single-key shortcuts.
    event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (running) stop()
    else setOpen(false)
  }

  if (!open) return null

  return (
    <div
      className="ask-bar"
      role="dialog"
      aria-label="Ask Claude"
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
    >
      {run && (
        <div className="ask-log" ref={log} aria-live="polite">
          <p className="ask-prompt">{run.prompt}</p>
          {run.steps.map((step, i) =>
            step.kind === 'text' ? (
              <p key={i} className="ask-text">
                {step.text.trim()}
              </p>
            ) : (
              <p key={i} className="ask-step">
                {step.summary}
              </p>
            ),
          )}
          {running && <p className="ask-step is-working">Working…</p>}
          {run.state === 'stopped' && <p className="ask-step">Stopped</p>}
          {run.state === 'error' && (
            <p className="ask-error">
              {run.error}{' '}
              <button type="button" className="ask-link" onClick={onOpenSettings}>
                Open Settings
              </button>
            </p>
          )}
        </div>
      )}

      {keyConfigured === false ? (
        <div className="ask-row ask-setup">
          <span className="ask-label">Ask</span>
          <p>Claude needs an API key. Add a 1Password reference in Settings.</p>
          <button type="button" className="agent-button is-primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      ) : (
        <form className="ask-row" onSubmit={submit}>
          <label className="ask-label" htmlFor={inputId}>
            Ask
          </label>
          <input
            id={inputId}
            ref={input}
            className="ask-input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={
              selected ? 'What should happen to the selection?' : 'Draw, tidy or explain the board…'
            }
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {selected > 0 && <span className="ask-scope">Working on {selected} selected</span>}
          {running ? (
            <button type="button" className="agent-button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="submit" className="agent-button is-primary" disabled={!prompt.trim()}>
              Ask
            </button>
          )}
        </form>
      )}
    </div>
  )
}

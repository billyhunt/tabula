import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { DefaultSidebar, Sidebar } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { AgentStatus, AskEvent } from '../../shared/ipc'
import type { Settings } from '../../shared/settings'
import { useMenuCommand } from '../menuCommands'
import { ModelPicker } from './ModelPicker'
import { chatMarkdown } from './chatTranscript'
import { remoteErrorMessage } from './remoteError'

/** The chat lives as a tab of Excalidraw's sidebar, beside search and the library. */
const CHAT_TAB = 'chat'

const isChatOpen = (sidebar: AppState['openSidebar']) =>
  sidebar?.name === 'default' && sidebar.tab === CHAT_TAB

type Step = { kind: 'text'; text: string } | { kind: 'tool'; summary: string }

/** One exchange in the chat: the user's message and what Claude did with it. */
export interface Run {
  prompt: string
  steps: Step[]
  state: 'running' | 'done' | 'error' | 'stopped'
  error?: string
}

/** Folds one streamed event into the run it belongs to. */
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

/** Applies `update` to the newest run, which is the only one that can change. */
const updateLast = (runs: Run[], update: (run: Run) => Run): Run[] => {
  const last = runs.at(-1)
  return last ? [...runs.slice(0, -1), update(last)] : runs
}

type OpenSettings = (options?: { askForKey?: boolean }) => void

/** What the chat panel shows and can do; owned by App through `useChat`. */
export interface ChatState {
  settings: Settings | null
  /** Null until the first status check answers. */
  keyConfigured: boolean | null
  prompt: string
  setPrompt: (prompt: string) => void
  runs: Run[]
  running: boolean
  /** Selected elements, for the placeholder. */
  selected: number
  /** Changes when the message box should take focus. */
  focusRequest: number
  submit: () => Promise<void>
  stop: () => void
  newChat: () => Promise<void>
  /** Copies the conversation as Markdown. */
  copyChat: () => Promise<void>
  /** Saves the conversation as a Markdown file, next to the drawing by default. */
  saveChat: () => Promise<void>
  onOpenSettings: OpenSettings
}

/**
 * The chat's state and actions. It lives in App rather than in the sidebar
 * tab because Excalidraw unmounts a tab that isn't showing, and a run must
 * carry on (and the conversation stay) while the library is open or the
 * sidebar is closed.
 *
 * Also keeps the sidebar and View ▸ Show Chat in step: the setting opens or
 * closes the chat, and closing or opening it in the sidebar updates the setting.
 */
export const useChat = (
  api: ExcalidrawImperativeAPI | null,
  onOpenSettings: OpenSettings,
  /** The open drawing's file, for naming a saved chat. */
  drawingPath: string | null,
): ChatState => {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [prompt, setPrompt] = useState('')
  const [runs, setRuns] = useState<Run[]>([])
  const [selected, setSelected] = useState(0)
  // Bumped by ⌘J; the panel focuses its box when this changes or it mounts.
  const [focusRequest, setFocusRequest] = useState(0)
  // The run main is streaming to us. Events can beat ask()'s reply, so they
  // are held until the runId is known.
  const runId = useRef<string | null>(null)
  const starting = useRef(false)
  const early = useRef<AskEvent[]>([])
  const stopWhenStarted = useRef(false)
  // Bumped by New chat, so a run still starting knows it belongs to the old chat.
  const chatGeneration = useRef(0)
  const showChat = useRef(true)
  showChat.current = settings?.showChat ?? true

  // Settings drive the model menu and Show Chat; status says whether there is a key.
  useEffect(() => {
    let live = true
    const refresh = (next: Settings) => {
      setSettings(next)
      window.tabula.agent.status().then(
        (s) => live && setStatus(s),
        () => {},
      )
    }
    void window.tabula.settings.get().then((s) => live && refresh(s))
    const unsubscribe = window.tabula.settings.onChange(refresh)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  useEffect(
    () =>
      window.tabula.agent.onAskEvent((event) => {
        if (starting.current) early.current.push(event)
        else if (event.runId === runId.current) {
          setRuns((r) => updateLast(r, (run) => applyEvent(run, event)))
        }
      }),
    [],
  )

  // Selection count for the placeholder; sidebar changes update Show Chat.
  useEffect(() => {
    if (!api) return
    setSelected(Object.keys(api.getAppState().selectedElementIds).length)
    let was = api.getAppState().openSidebar
    return api.onChange((_elements, state) => {
      setSelected(Object.keys(state.selectedElementIds).length)
      const now = state.openSidebar
      if (now?.name === was?.name && now?.tab === was?.tab) return
      const closed = was?.name === 'default' && !now
      was = now
      if (closed && showChat.current) void window.tabula.settings.update({ showChat: false })
      else if (isChatOpen(now) && !showChat.current) {
        void window.tabula.settings.update({ showChat: true })
      }
    })
  }, [api])

  // Show Chat (on by default) opens the chat; turning it off closes it.
  const wanted = settings?.showChat
  useEffect(() => {
    if (!api || wanted === undefined) return
    const open = isChatOpen(api.getAppState().openSidebar)
    if (wanted && !open) api.toggleSidebar({ name: 'default', tab: CHAT_TAB, force: true })
    else if (!wanted && open) api.toggleSidebar({ name: 'default', force: false })
  }, [api, wanted])

  // ⌘J: open the chat if it isn't showing, and put the cursor in the box.
  useMenuCommand('ask', () => {
    if (api && !isChatOpen(api.getAppState().openSidebar)) {
      api.toggleSidebar({ name: 'default', tab: CHAT_TAB, force: true })
    }
    setFocusRequest((n) => n + 1)
  })

  const running = runs.at(-1)?.state === 'running'

  const submit = async () => {
    const text = prompt.trim()
    if (!text || running) return
    // No key yet: Settings opens at the key field. The message stays in the
    // box, ready to send once the key is in. Saving a key isn't a settings
    // change, so look again before sending the user back.
    if (!status?.keyConfigured) {
      const latest = await window.tabula.agent.status().catch(() => null)
      if (latest) setStatus(latest)
      if (latest && !latest.keyConfigured) {
        onOpenSettings({ askForKey: true })
        return
      }
    }
    setPrompt('')
    setRuns((r) => [...r, { prompt: text, steps: [], state: 'running' }])
    runId.current = null
    starting.current = true
    stopWhenStarted.current = false
    early.current = []
    const generation = chatGeneration.current
    try {
      const started = await window.tabula.agent.ask({ prompt: text })
      if (generation !== chatGeneration.current) {
        window.tabula.agent.cancel(started.runId)
        return
      }
      runId.current = started.runId
      const buffered = early.current.filter((e) => e.runId === started.runId)
      setRuns((r) => updateLast(r, (run) => buffered.reduce(applyEvent, run)))
      if (stopWhenStarted.current) window.tabula.agent.cancel(started.runId)
    } catch (err) {
      if (generation !== chatGeneration.current) return
      setRuns((r) => updateLast(r, (run) => ({ ...run, state: 'error', error: remoteErrorMessage(err) })))
    } finally {
      starting.current = false
      early.current = []
    }
  }

  const stop = () => {
    if (runId.current) window.tabula.agent.cancel(runId.current)
    else stopWhenStarted.current = true
    setRuns((r) => updateLast(r, (run) => ({ ...run, state: 'stopped' })))
  }

  const newChat = async () => {
    chatGeneration.current++
    // Late events from the old run must not land in the new chat.
    runId.current = null
    setRuns([])
    setFocusRequest((n) => n + 1)
    try {
      await window.tabula.agent.resetChat()
    } catch (err) {
      setRuns([{ prompt: 'New chat', steps: [], state: 'error', error: remoteErrorMessage(err) }])
    }
  }

  const transcript = () => chatMarkdown(runs, drawingPath && drawingTitle(drawingPath))

  const copyChat = async () => {
    await window.tabula.exports.copyText(transcript())
    api?.setToast({ message: 'Copied the chat as Markdown', duration: 2000, closable: false })
  }

  // Next to the drawing, so the two stay together; untitled boards suggest
  // a plain name in the last save folder.
  const saveChat = async () => {
    const name = `${drawingPath ? drawingTitle(drawingPath) : 'Untitled'} chat.md`
    const folder =
      drawingPath && !(await window.tabula.isUntitledPath(drawingPath))
        ? drawingPath.slice(0, drawingPath.lastIndexOf('/') + 1)
        : ''
    try {
      const saved = await window.tabula.exports.save({
        format: 'markdown',
        suggestedName: folder + name,
        data: transcript(),
      })
      if (saved) api?.setToast({ message: `Saved ${saved.split('/').pop()}`, duration: 2500, closable: false })
    } catch (err) {
      api?.setToast({ message: `Couldn't save the chat: ${remoteErrorMessage(err)}`, closable: true })
    }
  }

  return {
    settings,
    keyConfigured: status?.keyConfigured ?? null,
    prompt,
    setPrompt,
    runs,
    running,
    selected,
    focusRequest,
    submit,
    stop,
    newChat,
    copyChat,
    saveChat,
    onOpenSettings,
  }
}

/** "Board" for …/Board.excalidraw.md. */
const drawingTitle = (drawingPath: string) =>
  (drawingPath.split('/').pop() ?? drawingPath).replace(/(\.excalidraw\.md|\.excalidraw|\.md)$/i, '')

const chatIcon = (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
    <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
  </svg>
)

/** The conversation and the message box, as shown in the sidebar tab. */
const ChatPanel = ({ chat }: { chat: ChatState }) => {
  const { settings, runs, running, prompt, setPrompt, selected, onOpenSettings } = chat
  const input = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)

  // Focus on ⌘J, New chat, or whenever the tab opens.
  useEffect(() => {
    input.current?.focus()
  }, [chat.focusRequest])

  // Follow the reply as it streams only while the reader is at the bottom;
  // scrolling up to reread must not be yanked back on every new word. A new
  // message always comes into view.
  const pinned = useRef(true)
  const runCount = useRef(runs.length)
  useEffect(() => {
    const el = log.current
    if (!el) return
    if (runs.length !== runCount.current) {
      runCount.current = runs.length
      pinned.current = true
    }
    if (pinned.current) el.scrollTo({ top: el.scrollHeight })
  }, [runs])
  const onLogScroll = () => {
    const el = log.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Excalidraw answers every copy on the page with the selected shapes, even
  // when the selection is text here. Text selected in the conversation must
  // copy as text, so its copy never reaches Excalidraw's document listener.
  useEffect(() => {
    const keepTextCopy = (event: ClipboardEvent) => {
      const selection = getSelection()
      const node = selection && !selection.isCollapsed ? selection.anchorNode : null
      if (node && log.current?.contains(node)) event.stopPropagation()
    }
    window.addEventListener('copy', keepTextCopy, true)
    return () => window.removeEventListener('copy', keepTextCopy, true)
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    // Typing here must not trigger Excalidraw's single-key shortcuts.
    event.stopPropagation()
    if (event.key !== 'Escape') return
    event.preventDefault()
    // Escape stops a run, or hands the keyboard back to the canvas.
    if (running) chat.stop()
    else input.current?.blur()
  }

  // Enter sends; Shift+Enter starts a new line. Not mid-composition (IME).
  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void chat.submit()
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void chat.submit()
  }

  return (
    <section className="chat" aria-label="Chat" onKeyDown={onKeyDown} onKeyUp={(e) => e.stopPropagation()}>
      <div className="chat-log" ref={log} aria-live="polite" onScroll={onLogScroll}>
        {runs.length === 0 ? (
          <p className="chat-empty">Ask Claude to draw, tidy or explain the board.</p>
        ) : (
          <div className="chat-actions">
            <button type="button" className="chat-new" onClick={() => void chat.copyChat()}>
              Copy
            </button>
            <button type="button" className="chat-new" onClick={() => void chat.saveChat()}>
              Save…
            </button>
            <button type="button" className="chat-new" onClick={() => void chat.newChat()}>
              New chat
            </button>
          </div>
        )}
        {runs.map((run, i) => (
          <div key={i} className="ask-run">
            <p className="ask-prompt">{run.prompt}</p>
            {run.steps.map((step, j) =>
              step.kind === 'text' ? (
                <p key={j} className="ask-text">
                  {step.text.trim()}
                </p>
              ) : (
                <p key={j} className="ask-step">
                  {step.summary}
                </p>
              ),
            )}
            {run.state === 'running' && <p className="ask-step is-working">Working…</p>}
            {run.state === 'stopped' && <p className="ask-step">Stopped</p>}
            {run.state === 'error' && (
              <p className="ask-error">
                {run.error}{' '}
                <button type="button" className="ask-link" onClick={() => onOpenSettings()}>
                  Open Settings
                </button>
              </p>
            )}
          </div>
        ))}
      </div>

      <form className="chat-composer" onSubmit={onSubmit}>
        <textarea
          ref={input}
          className="ask-input"
          rows={2}
          autoComplete="off"
          spellCheck={false}
          aria-label="Message"
          placeholder={selected ? `Ask about the ${selected} selected…` : 'Write a message…'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <div className="chat-tools">
          {settings && (
            <ModelPicker
              agent={settings.agent}
              keyConfigured={chat.keyConfigured}
              onChooseModels={() => onOpenSettings()}
            />
          )}
          {running ? (
            <button type="button" className="chat-send" onClick={chat.stop} aria-label="Stop">
              ■
            </button>
          ) : (
            <button type="submit" className="chat-send" aria-label="Send" disabled={!prompt.trim()}>
              ↑
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

/**
 * Excalidraw's sidebar with the chat as its first-choice tab: the top-right
 * button opens it, and search and the library sit beside it. Rendered as a
 * child of <Excalidraw>.
 */
export const ChatSidebar = ({ chat }: { chat: ChatState }) => (
  <>
    <DefaultSidebar.Trigger tab={CHAT_TAB} icon={chatIcon} title="Chat (⌘J)" />
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        <Sidebar.TabTrigger tab={CHAT_TAB} title="Chat">
          {chatIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      <Sidebar.Tab tab={CHAT_TAB} className="chat-tab">
        <ChatPanel chat={chat} />
      </Sidebar.Tab>
    </DefaultSidebar>
  </>
)

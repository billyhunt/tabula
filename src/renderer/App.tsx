import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  hashElementsVersion,
  loadFromBlob,
  serializeAsJSON,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { WINDOW_NOT_BLANK } from '../shared/agentTools'
import type { OpenedFile } from '../shared/ipc'
import { ChatSidebar, useChat } from './agent/Chat'
import { SettingsDialog, useSettingsDialog } from './agent/SettingsDialog'
import { TextToDiagram } from './agent/TextToDiagram'
import { useAgentActivity } from './agent/useAgentActivity'
import { useCanvasTools } from './agent/useCanvasTools'
import { DEFAULT_FONT_FAMILY } from './canvas/defaultFont'
import { LabelField } from './canvas/LabelField'
import { useEasyLabels } from './canvas/useEasyLabels'
import { LIBRARY_RETURN_URL, useLibrary } from './library/useLibrary'
import { Titlebar } from './components/Titlebar'
import { useExports } from './export/useExports'
import type { DocumentController } from './document'
import {
  isObsidianMarkdown,
  newEnvelope,
  parseObsidian,
  serializeObsidian,
  type ObsidianEnvelope,
  type SceneJson,
} from './format/obsidian'
import { useMermaidPaste } from './mermaid/useMermaidPaste'
import { useMenuCommand } from './menuCommands'
import { useSystemTheme } from './useSystemTheme'
import { useAutosave, useAutosaveEnabled } from './versions/useAutosave'
import { VersionsDialog } from './versions/VersionsDialog'

// Paper, matching Alethia. Excalidraw's dark mode inverts the canvas, which
// turns this into a near-black ground.
const PAPER = '#f2f0eb'

// What a blank board starts with. Opened files keep their own font choice.
const BLANK_APP_STATE = {
  viewBackgroundColor: PAPER,
  currentItemFontFamily: DEFAULT_FONT_FAMILY,
}

const basename = (p: string) => p.split('/').pop() ?? p

const NEW_FILE_NAME = 'Untitled.excalidraw.md'

export const App = () => {
  const theme = useSystemTheme()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  // The drawing's file as of now. Saves queued earlier read this when they
  // run, not the React state from when they were queued, so an autosave can't
  // write to a file the drawing has just moved away from.
  const pathRef = useRef<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  // Hash of the elements as last saved or loaded; anything else is unsaved.
  const savedHash = useRef(hashElementsVersion([]))
  // The non-drawing parts of the open .excalidraw.md, re-emitted on save.
  const envelope = useRef<ObsidianEnvelope>(newEnvelope())

  useEffect(() => window.tabula.setDirty(dirty), [dirty])
  useEffect(() => window.tabula.setTitle(filePath), [filePath])
  useEffect(() => window.tabula.onFullscreen(setFullscreen), [])

  // Dev only: lets scripts driving the app over the remote-debugging port
  // reach the editor. Never present in packaged builds.
  useEffect(() => {
    if (!import.meta.env.DEV || !api) return
    window.__excalidraw = api
  }, [api])

  const markSaved = useCallback(() => {
    if (!api) return
    savedHash.current = hashElementsVersion(api.getSceneElementsIncludingDeleted())
    setDirty(false)
  }, [api])

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], _state: AppState, _files: BinaryFiles) => {
      setDirty(hashElementsVersion(elements) !== savedHash.current)
    },
    [],
  )

  /** Serializes the scene in the format the target path implies. */
  const serialize = useCallback(
    (targetPath: string) => {
      if (!api) return ''
      const json = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        'local',
      )
      if (!isObsidianMarkdown(targetPath)) return json
      return serializeObsidian(JSON.parse(json) as SceneJson, envelope.current)
    },
    [api],
  )

  /**
   * Puts file contents on the canvas. Throws when the contents can't be read
   * as a drawing; the envelope only changes once parsing has succeeded.
   * `beforeCommit` runs after parsing, right before the scene is replaced, and
   * may throw to stop it.
   */
  const applyContents = useCallback(
    async (contents: string, formatPath: string, beforeCommit?: () => void) => {
      if (!api) throw new Error('The editor is still starting')
      let json = contents
      let nextEnvelope = newEnvelope()
      if (isObsidianMarkdown(formatPath)) {
        const parsed = parseObsidian(contents)
        json = JSON.stringify(parsed.scene)
        nextEnvelope = parsed.envelope
      }
      const blob = new Blob([json], { type: 'application/json' })
      const scene = await loadFromBlob(blob, api.getAppState(), api.getSceneElements())
      beforeCommit?.()
      envelope.current = nextEnvelope
      api.updateScene({
        elements: scene.elements,
        appState: { ...scene.appState, theme },
        captureUpdate: 'IMMEDIATELY',
      })
      if (scene.files) api.addFiles(Object.values(scene.files))
      if (scene.elements.length) {
        // Fit inside the area the toolbar, panels and docked chat leave free.
        api.setViewport({ target: api.getSceneElements(), fit: 'scale-down', offsets: { ui: true } })
      }
    },
    [api, theme],
  )

  const load = useCallback(
    async (file: OpenedFile, options?: { throwOnError?: boolean; intoBlankOnly?: boolean }) => {
      if (!api) return
      let claimed = false
      // Checked right before the scene is replaced, after the parse's await,
      // so nothing drawn meanwhile is lost. Taking the path in the same
      // synchronous step keeps a second load from also passing.
      const claimBlank = options?.intoBlankOnly
        ? () => {
            if (pathRef.current || api.getSceneElements().length) throw new Error(WINDOW_NOT_BLANK)
            pathRef.current = file.path
            claimed = true
          }
        : undefined
      try {
        await applyContents(file.contents, file.path, claimBlank)
      } catch (err) {
        if (claimed) pathRef.current = null
        // An agent waiting on the load gets the error; a modal would stall it.
        if (options?.throwOnError) {
          if ((err as Error).message === WINDOW_NOT_BLANK) throw err
          throw new Error(`Not a drawing Tabula can open: ${(err as Error).message}`)
        }
        // Retire main's claim on this file before the modal blocks the window.
        window.tabula.fileLoadFailed()
        window.alert(`Couldn't open ${basename(file.path)}: ${(err as Error).message}`)
        return
      }
      api.history.clear()
      pathRef.current = file.path
      setFilePath(file.path)
      markSaved()
    },
    [api, applyContents, markSaved],
  )

  // Restoring keeps undo history, so a restore can itself be undone.
  const restore = useCallback(
    (contents: string, formatPath: string) => applyContents(contents, formatPath),
    [applyContents],
  )

  const autosaveEnabled = useAutosaveEnabled()
  // The file an untitled drawing autosaves to, chosen on its first autosave
  // and kept until New, so saves racing to start share one file.
  const untitledTarget = useRef<Promise<string> | null>(null)

  // Saves run one at a time, so an older write can never land after a newer
  // one (a manual save racing an autosave, say).
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())

  /** Queues a save to `target`, or with null to the drawing's own file. */
  const queueSave = useCallback(
    (target: string | null) => {
      const run = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (!api) throw new Error('The editor is still starting')
          // The promise is shared, so saves racing to start pick the same file.
          const file =
            target ?? pathRef.current ?? (await (untitledTarget.current ??= window.tabula.untitledPath()))
          // Hash what is written, not what is on the canvas once the write
          // finishes: edits made in the meantime must stay unsaved.
          const hash = hashElementsVersion(api.getSceneElementsIncludingDeleted())
          await window.tabula.saveFile(file, serialize(file))
          pathRef.current = file
          setFilePath(file)
          savedHash.current = hash
          setDirty(hashElementsVersion(api.getSceneElementsIncludingDeleted()) !== hash)
          return file
        })
      saveQueue.current = run
      return run
    },
    [api, serialize],
  )

  const saveTo = queueSave

  const saveAs = useCallback(async () => {
    const target = await window.tabula.pickSavePath(filePath ?? NEW_FILE_NAME)
    if (!target) return null
    const previous = pathRef.current
    const saved = await saveTo(target)
    untitledTarget.current = null
    // Naming an untitled autosave moves it: the timestamped file it was
    // autosaving to goes, rather than lingering as a duplicate. The removal
    // waits its turn in the save queue, so a save already queued (to the old
    // file by name, say) runs first; if one moved the drawing back there,
    // the old file is in use again and stays. Main only deletes files it
    // allocated as autosaves.
    if (previous && previous !== saved) {
      const retire = saveQueue.current
        .catch(() => undefined)
        .then(() => (pathRef.current === previous ? undefined : window.tabula.retireUntitled(previous)))
      saveQueue.current = retire
      await retire
    }
    return saved
  }, [filePath, saveTo])

  // Save on a drawing that only has an autosave name asks for a real one.
  const save = useCallback(async () => {
    const current = pathRef.current
    return current && !(await window.tabula.isUntitledPath(current)) ? saveTo(current) : saveAs()
  }, [saveTo, saveAs])

  const flush = useCallback(async () => {
    if (!api) return true
    const unsaved = () => hashElementsVersion(api.getSceneElementsIncludingDeleted()) !== savedHash.current
    if (!unsaved()) return true
    if (!autosaveEnabled.current) return false
    // A board never saved with nothing left on it (drawn, then deleted) isn't
    // worth a file; it counts as saved.
    if (!pathRef.current && api.getSceneElements().length === 0) {
      savedHash.current = hashElementsVersion(api.getSceneElementsIncludingDeleted())
      setDirty(false)
      return true
    }
    // Edits made while a save is writing stay unsaved; save again for those,
    // so a close never acknowledges work that isn't on disk.
    for (let attempt = 0; attempt < 3 && unsaved(); attempt++) await queueSave(null)
    if (unsaved()) throw new Error('The drawing kept changing while it was being saved.')
    return true
  }, [api, autosaveEnabled, queueSave])

  /** Before the canvas is replaced: save the edits, or with autosave off, ask. */
  const readyToReplace = useCallback(async () => {
    try {
      if (await flush()) return true
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      return window.confirm(`Couldn't save this drawing (${reason}). Discard its changes?`)
    }
    return window.confirm('Discard unsaved changes to this drawing?')
  }, [flush])

  const open = useCallback(async () => {
    if (!(await readyToReplace())) return
    const file = await window.tabula.openFile()
    if (file) await load(file)
  }, [readyToReplace, load])

  const newDrawing = useCallback(
    async () => {
      if (!api || !(await readyToReplace())) return
      // resetScene restores Excalidraw's defaults, which would close the chat.
      const { openSidebar, defaultSidebarDockedPreference } = api.getAppState()
      api.resetScene()
      api.updateScene({ appState: { ...BLANK_APP_STATE, openSidebar, defaultSidebarDockedPreference } })
      api.history.clear()
      pathRef.current = null
      setFilePath(null)
      untitledTarget.current = null
      envelope.current = newEnvelope()
      savedHash.current = hashElementsVersion([])
      setDirty(false)
    },
    [api, readyToReplace],
  )

  /** Handed to features; rebuilt when the document changes. */
  const doc = useMemo<DocumentController>(
    () => ({ filePath, dirty, load, restore, save, saveAs, saveTo, flush, newDrawing, serialize }),
    [filePath, dirty, load, restore, save, saveAs, saveTo, flush, newDrawing, serialize],
  )

  useMenuCommand('new', () => void newDrawing())
  useMenuCommand('open', () => void open())
  useMenuCommand('save', () => void save())
  useMenuCommand('save-as', () => void saveAs())
  useMenuCommand('export-image', () =>
    api?.updateScene({ appState: { openDialog: { name: 'imageExport' } } }),
  )

  // Features hook in here.
  useAutosave(doc, api, autosaveEnabled)
  useExports(api, doc)
  useCanvasTools(api, doc)
  useEasyLabels(api)
  useLibrary(api)
  const onPaste = useMermaidPaste(api)
  const settingsDialog = useSettingsDialog()
  const chat = useChat(api, settingsDialog.show, filePath)
  const agentLabel = useAgentActivity()

  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    if (!api) return
    return window.tabula.onFileOpened((file) => void loadRef.current(file))
  }, [api])

  return (
    <div className={`app${fullscreen ? ' is-fullscreen' : ''}`}>
      <Titlebar name={filePath ? basename(filePath) : 'Untitled'} dirty={dirty} agent={agentLabel} />
      <main className="canvas">
        <Excalidraw
          onExcalidrawAPI={setApi}
          theme={theme}
          onChange={onChange}
          onPaste={onPaste}
          libraryReturnUrl={LIBRARY_RETURN_URL}
          // The sidebar (where the chat lives) docks beside the canvas
          // rather than covering it.
          initialData={{ appState: { ...BLANK_APP_STATE, defaultSidebarDockedPreference: true } }}
          UIOptions={{
            canvasActions: { loadScene: false, saveToActiveFile: false, toggleTheme: false },
          }}
        >
          <MainMenu>
            <MainMenu.Item onSelect={() => void open()} shortcut="⌘O">
              Open…
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => void save()} shortcut="⌘S">
              Save
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => void saveAs()} shortcut="⇧⌘S">
              Save as…
            </MainMenu.Item>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.SearchMenu />
            <MainMenu.DefaultItems.Help />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
          <WelcomeScreen>
            <WelcomeScreen.Center>
              <WelcomeScreen.Center.Heading>Tabula rasa.</WelcomeScreen.Center.Heading>
              <WelcomeScreen.Center.Menu>
                <WelcomeScreen.Center.MenuItem onSelect={() => void open()} shortcut="⌘O">
                  Open a drawing
                </WelcomeScreen.Center.MenuItem>
                <WelcomeScreen.Center.MenuItemHelp />
              </WelcomeScreen.Center.Menu>
            </WelcomeScreen.Center>
            <WelcomeScreen.Hints.ToolbarHint />
            <WelcomeScreen.Hints.MenuHint />
            <WelcomeScreen.Hints.HelpHint />
          </WelcomeScreen>
          <TextToDiagram api={api} />
          <ChatSidebar chat={chat} />
        </Excalidraw>
        <LabelField api={api} />
      </main>
      <VersionsDialog doc={doc} />
      <SettingsDialog
        open={settingsDialog.open}
        askForKey={settingsDialog.askForKey}
        close={settingsDialog.close}
      />
    </div>
  )
}

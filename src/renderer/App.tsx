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
import type { OpenedFile } from '../shared/ipc'
import { AskBar } from './agent/AskBar'
import { SettingsDialog, useSettingsDialog } from './agent/SettingsDialog'
import { TextToDiagram } from './agent/TextToDiagram'
import { useAgentActivity } from './agent/useAgentActivity'
import { useCanvasTools } from './agent/useCanvasTools'
import { LabelField } from './canvas/LabelField'
import { useEasyLabels } from './canvas/useEasyLabels'
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
import { useAutosave } from './versions/useAutosave'
import { VersionsDialog } from './versions/VersionsDialog'

// Paper, matching Alethia. Excalidraw's dark mode inverts the canvas, which
// turns this into a near-black ground.
const PAPER = '#f2f0eb'

const basename = (p: string) => p.split('/').pop() ?? p

const NEW_FILE_NAME = 'Untitled.excalidraw.md'

export const App = () => {
  const theme = useSystemTheme()
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
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
   */
  const applyContents = useCallback(
    async (contents: string, formatPath: string) => {
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
      envelope.current = nextEnvelope
      api.updateScene({
        elements: scene.elements,
        appState: { ...scene.appState, theme },
        captureUpdate: 'IMMEDIATELY',
      })
      if (scene.files) api.addFiles(Object.values(scene.files))
      if (scene.elements.length) {
        api.setViewport({ target: api.getSceneElements(), fit: 'scale-down' })
      }
    },
    [api, theme],
  )

  const load = useCallback(
    async (file: OpenedFile) => {
      if (!api) return
      try {
        await applyContents(file.contents, file.path)
      } catch (err) {
        window.alert(`Couldn't open ${basename(file.path)}: ${(err as Error).message}`)
        return
      }
      api.history.clear()
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

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm('Discard unsaved changes to this drawing?'),
    [dirty],
  )

  // Saves run one at a time, so an older write can never land after a newer
  // one (a manual save racing an autosave, say).
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())

  const saveTo = useCallback(
    (target: string) => {
      const run = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          if (!api) throw new Error('The editor is still starting')
          // Hash what is written, not what is on the canvas once the write
          // finishes: edits made in the meantime must stay unsaved.
          const hash = hashElementsVersion(api.getSceneElementsIncludingDeleted())
          await window.tabula.saveFile(target, serialize(target))
          setFilePath(target)
          savedHash.current = hash
          setDirty(hashElementsVersion(api.getSceneElementsIncludingDeleted()) !== hash)
          return target
        })
      saveQueue.current = run
      return run
    },
    [api, serialize],
  )

  const saveAs = useCallback(async () => {
    const target = await window.tabula.pickSavePath(filePath ?? NEW_FILE_NAME)
    return target ? saveTo(target) : null
  }, [filePath, saveTo])

  const save = useCallback(
    () => (filePath ? saveTo(filePath) : saveAs()),
    [filePath, saveTo, saveAs],
  )

  const open = useCallback(async () => {
    if (!confirmDiscard()) return
    const file = await window.tabula.openFile()
    if (file) await load(file)
  }, [confirmDiscard, load])

  const newDrawing = useCallback(
    (options?: { force?: boolean }) => {
      if (!api || (!options?.force && !confirmDiscard())) return
      api.resetScene()
      api.updateScene({ appState: { viewBackgroundColor: PAPER } })
      api.history.clear()
      setFilePath(null)
      envelope.current = newEnvelope()
      savedHash.current = hashElementsVersion([])
      setDirty(false)
    },
    [api, confirmDiscard],
  )

  /** Handed to features; rebuilt when the document changes. */
  const doc = useMemo<DocumentController>(
    () => ({ filePath, dirty, load, restore, save, saveAs, saveTo, newDrawing, serialize }),
    [filePath, dirty, load, restore, save, saveAs, saveTo, newDrawing, serialize],
  )

  useMenuCommand('new', () => newDrawing())
  useMenuCommand('open', () => void open())
  useMenuCommand('save', () => void save())
  useMenuCommand('save-as', () => void saveAs())
  useMenuCommand('export-image', () =>
    api?.updateScene({ appState: { openDialog: { name: 'imageExport' } } }),
  )

  // Features hook in here.
  useAutosave(doc, api)
  useExports(api, doc)
  useCanvasTools(api, doc)
  useEasyLabels(api)
  const onPaste = useMermaidPaste(api)
  const settingsDialog = useSettingsDialog()
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
          initialData={{ appState: { viewBackgroundColor: PAPER } }}
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
        </Excalidraw>
        <AskBar api={api} onOpenSettings={settingsDialog.show} />
        <LabelField api={api} />
      </main>
      <VersionsDialog doc={doc} />
      <SettingsDialog open={settingsDialog.open} close={settingsDialog.close} />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Titlebar } from './components/Titlebar'
import {
  isObsidianMarkdown,
  newEnvelope,
  parseObsidian,
  serializeObsidian,
  type ObsidianEnvelope,
  type SceneJson,
} from './format/obsidian'
import { useSystemTheme } from './useSystemTheme'

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
    ;(window as unknown as { __excalidraw?: ExcalidrawImperativeAPI }).__excalidraw = api
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

  const load = useCallback(
    async (file: OpenedFile) => {
      if (!api) return
      let json = file.contents
      if (isObsidianMarkdown(file.path)) {
        try {
          const parsed = parseObsidian(file.contents)
          json = JSON.stringify(parsed.scene)
          envelope.current = parsed.envelope
        } catch (err) {
          window.alert(`Couldn't open ${basename(file.path)}: ${(err as Error).message}`)
          return
        }
      } else {
        envelope.current = newEnvelope()
      }
      const blob = new Blob([json], { type: 'application/json' })
      const scene = await loadFromBlob(blob, api.getAppState(), api.getSceneElements())
      api.updateScene({
        elements: scene.elements,
        appState: { ...scene.appState, theme },
        captureUpdate: 'IMMEDIATELY',
      })
      if (scene.files) api.addFiles(Object.values(scene.files))
      api.history.clear()
      if (scene.elements.length) {
        api.setViewport({ target: api.getSceneElements(), fit: 'scale-down' })
      }
      setFilePath(file.path)
      markSaved()
    },
    [api, theme, markSaved],
  )

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm('Discard unsaved changes to this drawing?'),
    [dirty],
  )

  const saveAs = useCallback(async () => {
    const target = await window.tabula.pickSavePath(filePath ?? NEW_FILE_NAME)
    if (!target) return
    await window.tabula.saveFile(target, serialize(target))
    setFilePath(target)
    markSaved()
  }, [serialize, filePath, markSaved])

  const save = useCallback(async () => {
    if (!filePath) return saveAs()
    await window.tabula.saveFile(filePath, serialize(filePath))
    markSaved()
  }, [filePath, serialize, saveAs, markSaved])

  const exportImage = useCallback(() => {
    api?.updateScene({ appState: { openDialog: { name: 'imageExport' } } })
  }, [api])

  const open = useCallback(async () => {
    if (!confirmDiscard()) return
    const file = await window.tabula.openFile()
    if (file) await load(file)
  }, [confirmDiscard, load])

  const newDrawing = useCallback(() => {
    if (!api || !confirmDiscard()) return
    api.resetScene()
    api.updateScene({ appState: { viewBackgroundColor: PAPER } })
    api.history.clear()
    setFilePath(null)
    envelope.current = newEnvelope()
    savedHash.current = hashElementsVersion([])
    setDirty(false)
  }, [api, confirmDiscard])

  // The handlers change identity on every edit, so the subscriptions read
  // them through a ref instead of re-subscribing.
  const handlers = useRef({ newDrawing, open, save, saveAs, load, exportImage })
  handlers.current = { newDrawing, open, save, saveAs, load, exportImage }

  useEffect(
    () =>
      window.tabula.onMenuCommand((cmd) => {
        const h = handlers.current
        if (cmd === 'new') h.newDrawing()
        else if (cmd === 'open') void h.open()
        else if (cmd === 'save') void h.save()
        else if (cmd === 'save-as') void h.saveAs()
        else if (cmd === 'export-image') h.exportImage()
      }),
    [],
  )
  useEffect(() => {
    if (!api) return
    return window.tabula.onFileOpened((file) => void handlers.current.load(file))
  }, [api])

  return (
    <div className={`app${fullscreen ? ' is-fullscreen' : ''}`}>
      <Titlebar name={filePath ? basename(filePath) : 'Untitled'} dirty={dirty} />
      <main className="canvas">
        <Excalidraw
          onExcalidrawAPI={setApi}
          theme={theme}
          onChange={onChange}
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
        </Excalidraw>
      </main>
    </div>
  )
}

import { Menu } from 'electron'
import type { MenuCommand } from '../shared/ipc'
import { getSettings, onSettingsChanged, updateSettings } from './settings'
import { createWindow, sendCommand } from './windows'

type Item = Electron.MenuItemConstructorOptions

const command =
  (cmd: MenuCommand, label: string, accelerator?: string, extra: Partial<Item> = {}): Item => ({
    label,
    accelerator,
    click: () => sendCommand(cmd),
    ...extra,
  })

const buildMenu = () => {
  const settings = getSettings()
  const template: Item[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        command('settings', 'Settings…', 'CmdOrCtrl+,'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        command('new', 'New Drawing', 'CmdOrCtrl+N'),
        command('open', 'Open…', 'CmdOrCtrl+O'),
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        command('save', 'Save', 'CmdOrCtrl+S'),
        command('save-as', 'Save As…', 'CmdOrCtrl+Shift+S'),
        {
          label: 'Autosave',
          type: 'checkbox',
          checked: settings.autosave,
          click: (item) => void updateSettings({ autosave: item.checked }),
        },
        command('browse-versions', 'Browse Versions…'),
        { type: 'separator' },
        command('import-mermaid', 'Import Mermaid…'),
        // Shown for discoverability only: Excalidraw handles ⇧⌘E itself.
        command('export-image', 'Export Image…', 'CmdOrCtrl+Shift+E', {
          registerAccelerator: false,
        }),
        {
          label: 'Export',
          submenu: [
            command('export-png', 'PNG…'),
            command('export-svg', 'SVG…'),
            command('export-pdf', 'PDF…'),
            command('export-pdf-frames', 'PDF, One Page per Frame…'),
            command('export-mermaid', 'Mermaid…'),
          ],
        },
        {
          label: 'Copy As',
          submenu: [
            command('copy-png', 'PNG'),
            command('copy-svg', 'SVG'),
            command('copy-mermaid', 'Mermaid'),
          ],
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    // Keys reach the page first, and Excalidraw claims its shortcuts there,
    // so these roles only act in text fields and dialogs.
    { role: 'editMenu' },
    // Not the stock viewMenu: its ⌘+ / ⌘− / ⌘0 zoom the whole page, which
    // would shadow Excalidraw's canvas zoom on the same keys. Reload has no
    // shortcut because it throws away unsaved work.
    {
      label: 'View',
      submenu: [
        {
          label: 'Show Chat',
          type: 'checkbox',
          checked: settings.showChat,
          click: (item) => void updateSettings({ showChat: item.checked }),
        },
        { type: 'separator' },
        { role: 'reload', accelerator: '' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Agent',
      submenu: [
        // ⌘K is Excalidraw's link shortcut, so the chat takes ⌘J.
        command('ask', 'Chat', 'CmdOrCtrl+J'),
        command('text-to-diagram', 'Text to Diagram…'),
        { type: 'separator' },
        {
          label: 'Allow Agent Connections (MCP)',
          type: 'checkbox',
          checked: settings.agent.mcpEnabled,
          click: (item) => void updateSettings({ agent: { mcpEnabled: item.checked } }),
        },
        command('settings', 'Agent Settings…'),
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Builds the menu and keeps its checkboxes in step with the settings. */
export const installMenu = () => {
  buildMenu()
  onSettingsChanged(buildMenu)
}

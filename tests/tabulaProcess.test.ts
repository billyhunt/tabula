import { describe, expect, it } from 'vitest'
import { tabulaExecutable } from '../scripts/tabula-process.mjs'

const INSTALLED = '/Applications/Tabula.app/Contents/MacOS/Tabula'
const DEV = '/Users/me/dev/tabula/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'

describe('tabulaExecutable', () => {
  it('finds a packaged copy with or without arguments', () => {
    expect(tabulaExecutable(INSTALLED)).toBe(INSTALLED)
    expect(tabulaExecutable(`${INSTALLED} --remote-debugging-port=9223`)).toBe(INSTALLED)
    expect(tabulaExecutable(`${INSTALLED} -psn_0_123`)).toBe(INSTALLED)
  })

  it('finds a copy whose path has spaces', () => {
    const built = '/Users/me/my builds/release/mac-arm64/Tabula.app/Contents/MacOS/Tabula'
    expect(tabulaExecutable(`${built} --flag`)).toBe(built)
  })

  it('skips helpers and other apps', () => {
    expect(
      tabulaExecutable(
        '/Applications/Tabula.app/Contents/Frameworks/Tabula Helper (Renderer).app/Contents/MacOS/Tabula Helper (Renderer) --type=renderer --app-path=/Applications/Tabula.app/Contents/Resources/app.asar',
      ),
    ).toBeNull()
    expect(tabulaExecutable('/Applications/Tabula Pro.app/Contents/MacOS/Tabula Pro')).toBeNull()
    expect(tabulaExecutable('/Applications/Tabula.app/Contents/MacOS/TabulaHelper')).toBeNull()
    expect(tabulaExecutable('Tabula.app/Contents/MacOS/Tabula')).toBeNull()
  })

  it('counts the dev Electron only when asked to', () => {
    expect(tabulaExecutable(`${DEV} .`)).toBeNull()
    expect(tabulaExecutable(`${DEV} .`, DEV)).toBe(DEV)
    expect(tabulaExecutable(DEV, DEV)).toBe(DEV)
    expect(tabulaExecutable(`${DEV}2 .`, DEV)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { tabulaExecutable } from '../scripts/tabula-process.mjs'

const INSTALLED = '/Applications/Tabula.app/Contents/MacOS/Tabula'
const DEV = '/Users/me/dev/tabula/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'

// `ps -o comm=` gives the executable's path, or only its file name in some
// column layouts; both forms must work.
describe('tabulaExecutable', () => {
  it('finds a packaged copy with or without arguments', () => {
    expect(tabulaExecutable(INSTALLED, `${INSTALLED} --remote-debugging-port=9223`)).toBe(INSTALLED)
    expect(tabulaExecutable('Tabula', INSTALLED)).toBe(INSTALLED)
    expect(tabulaExecutable('Tabula', `${INSTALLED} --remote-debugging-port=9223`)).toBe(INSTALLED)
  })

  it('finds a copy whose path has spaces', () => {
    const built = '/Users/me/my builds/release/mac-arm64/Tabula.app/Contents/MacOS/Tabula'
    expect(tabulaExecutable(built, `${built} --flag`)).toBe(built)
    expect(tabulaExecutable('Tabula', `${built} --flag`)).toBe(built)
  })

  it('skips another program that has a Tabula path in its arguments', () => {
    expect(tabulaExecutable('/usr/bin/lldb', `/usr/bin/lldb -- ${INSTALLED} --remote-debugging-port=9223`)).toBeNull()
    expect(tabulaExecutable('lldb', `/usr/bin/lldb -- ${INSTALLED}`)).toBeNull()
    expect(tabulaExecutable('open', `/usr/bin/open ${INSTALLED}`)).toBeNull()
  })

  it('skips helpers, other apps and unknown processes', () => {
    const helper = '/Applications/Tabula.app/Contents/Frameworks/Tabula Helper (Renderer).app/Contents/MacOS/Tabula Helper (Renderer)'
    expect(tabulaExecutable(helper, `${helper} --type=renderer`)).toBeNull()
    expect(tabulaExecutable('Tabula Helper (', `${helper} --type=renderer`)).toBeNull()
    expect(tabulaExecutable('/Applications/Tabula Pro.app/Contents/MacOS/Tabula Pro', '/Applications/Tabula Pro.app/Contents/MacOS/Tabula Pro')).toBeNull()
    expect(tabulaExecutable(undefined, INSTALLED)).toBeNull()
  })

  it('counts the dev Electron only when asked to', () => {
    expect(tabulaExecutable(DEV, `${DEV} .`)).toBeNull()
    expect(tabulaExecutable(DEV, `${DEV} .`, DEV)).toBe(DEV)
    expect(tabulaExecutable('Electron', `${DEV} .`, DEV)).toBe(DEV)
    expect(tabulaExecutable('Electron', `${DEV}2 .`, DEV)).toBeNull()
    expect(tabulaExecutable('/usr/bin/lldb', `/usr/bin/lldb -- ${DEV} .`, DEV)).toBeNull()
  })
})

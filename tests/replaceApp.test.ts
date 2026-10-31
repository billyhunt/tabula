import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { replaceApp } from '../scripts/replace-app.mjs'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

/** A fake app bundle: a folder with one file saying which build it is. */
const app = (parent: string, name: string, build: string) => {
  const dir = path.join(parent, name)
  mkdirSync(path.join(dir, 'Contents'), { recursive: true })
  writeFileSync(path.join(dir, 'Contents', 'build'), build)
  return dir
}
const build = (dir: string) => readFileSync(path.join(dir, 'Contents', 'build'), 'utf8')

const sandbox = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tabula-replace-'))
  dirs.push(dir)
  return dir
}

describe('replaceApp', () => {
  it('swaps in the new build and leaves nothing beside it', () => {
    const dir = sandbox()
    const installed = app(dir, 'Tabula.app', 'old')
    replaceApp(app(dir, 'built.app', 'new'), installed)
    expect(build(installed)).toBe('new')
    expect(existsSync(`${installed}.new`)).toBe(false)
    expect(existsSync(`${installed}.old`)).toBe(false)
  })

  it('installs when nothing is installed yet', () => {
    const dir = sandbox()
    const installed = path.join(dir, 'Tabula.app')
    replaceApp(app(dir, 'built.app', 'new'), installed)
    expect(build(installed)).toBe('new')
  })

  it('keeps the installed app when the copy fails', () => {
    const dir = sandbox()
    const installed = app(dir, 'Tabula.app', 'old')
    expect(() => replaceApp(path.join(dir, 'missing.app'), installed)).toThrow()
    expect(build(installed)).toBe('old')
    expect(existsSync(`${installed}.new`)).toBe(false)
  })

  it('restores the backup an interrupted run left, then installs', () => {
    const dir = sandbox()
    const installed = path.join(dir, 'Tabula.app')
    // The earlier run renamed the installed app aside and died before the second rename.
    app(dir, 'Tabula.app.old', 'old')
    expect(() => replaceApp(path.join(dir, 'missing.app'), installed)).toThrow()
    expect(build(installed)).toBe('old')
  })
})

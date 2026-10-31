import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPath, PathGrants, withDrawingExtension } from '../src/main/pathGrants'

let root: string

beforeAll(async () => {
  // Real location: macOS's tmpdir is itself behind a symlink.
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'tabula-grants-')))
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe('PathGrants', () => {
  it('rejects a path nothing granted', async () => {
    const file = path.join(root, 'ungranted.excalidraw.md')
    await writeFile(file, '')
    await expect(new PathGrants().assertCanSaveDrawing(file)).rejects.toThrow(/Open or Save dialogs/)
  })

  it('accepts a granted path', async () => {
    const grants = new PathGrants()
    const file = path.join(root, 'granted.excalidraw')
    await writeFile(file, '')
    expect(await grants.grant(file)).toBe(true)
    await expect(grants.assertCanSaveDrawing(file)).resolves.toBeUndefined()
  })

  it('grants one file, not its neighbours or folder', async () => {
    const grants = new PathGrants()
    await grants.grant(path.join(root, 'one.excalidraw.md'))
    expect(await grants.has(path.join(root, 'two.excalidraw.md'))).toBe(false)
    expect(await grants.has(root)).toBe(false)
  })

  it('accepts a file a Save dialog chose that does not exist yet', async () => {
    const grants = new PathGrants()
    const chosen = path.join(root, 'brand-new.excalidraw.md')
    expect(await grants.grant(chosen)).toBe(true)
    await expect(grants.assertCanSaveDrawing(chosen)).resolves.toBeUndefined()
  })

  it('does not grant a new file in a folder that does not exist', async () => {
    const grants = new PathGrants()
    const chosen = path.join(root, 'missing-folder', 'x.excalidraw.md')
    expect(await grants.grant(chosen)).toBe(false)
    await expect(grants.assertCanSaveDrawing(chosen)).rejects.toThrow()
  })

  it('rejects relative and non-string paths', async () => {
    const grants = new PathGrants()
    expect(await grants.grant('relative.excalidraw.md')).toBe(false)
    await expect(grants.assertCanSaveDrawing('relative.excalidraw.md')).rejects.toThrow()
    await expect(grants.assertCanSaveDrawing(undefined)).rejects.toThrow()
    await expect(grants.assertCanSaveDrawing({})).rejects.toThrow()
  })

  describe('extension', () => {
    it.each(['a.excalidraw', 'a.excalidraw.md', 'A.EXCALIDRAW', 'A.Excalidraw.MD'])(
      'allows %s',
      async (name) => {
        const grants = new PathGrants()
        const file = path.join(root, name)
        await grants.grant(file)
        await expect(grants.assertCanSaveDrawing(file)).resolves.toBeUndefined()
      },
    )

    it.each(['a.txt', 'a.md', 'a.excalidraw.png', 'a.excalidrawx', '.bashrc', 'a'])(
      'rejects %s even when granted',
      async (name) => {
        const grants = new PathGrants()
        const file = path.join(root, name)
        await grants.grant(file)
        await expect(grants.assertCanSaveDrawing(file)).rejects.toThrow(/\.excalidraw/)
      },
    )
  })

  describe('normalization', () => {
    it('treats a ".." route to a granted file as the same file', async () => {
      const grants = new PathGrants()
      await mkdir(path.join(root, 'sub'), { recursive: true })
      const file = path.join(root, 'dotted.excalidraw.md')
      await writeFile(file, '')
      await grants.grant(file)
      const viaDots = path.join(root, 'sub', '..', 'dotted.excalidraw.md')
      await expect(grants.assertCanSaveDrawing(viaDots)).resolves.toBeUndefined()
    })

    it('does not let ".." escape a granted file into another', async () => {
      const grants = new PathGrants()
      await mkdir(path.join(root, 'sub'), { recursive: true })
      await grants.grant(path.join(root, 'sub', 'inside.excalidraw.md'))
      const escaped = path.join(root, 'sub', '..', 'outside.excalidraw.md')
      await expect(grants.assertCanSaveDrawing(escaped)).rejects.toThrow(/Open or Save dialogs/)
    })

    it('treats a symlinked route to a granted file as the same file', async () => {
      const grants = new PathGrants()
      const realDir = path.join(root, 'real-dir')
      await mkdir(realDir, { recursive: true })
      await symlink(realDir, path.join(root, 'link-dir'))
      const file = path.join(realDir, 'linked.excalidraw.md')
      await writeFile(file, '')
      await grants.grant(file)
      await expect(
        grants.assertCanSaveDrawing(path.join(root, 'link-dir', 'linked.excalidraw.md')),
      ).resolves.toBeUndefined()
    })

    it('resolves a granted symlink to its target, whose name must still be a drawing', async () => {
      const grants = new PathGrants()
      const target = path.join(root, 'secret.txt')
      await writeFile(target, '')
      const link = path.join(root, 'sneaky.excalidraw.md')
      await symlink(target, link)
      await grants.grant(link)
      await expect(grants.assertCanSaveDrawing(link)).rejects.toThrow(/\.excalidraw/)
    })

    it('does not follow a symlink into a path that was never granted', async () => {
      const grants = new PathGrants()
      const target = path.join(root, 'elsewhere.excalidraw.md')
      await writeFile(target, '')
      const link = path.join(root, 'alias.excalidraw.md')
      await symlink(target, link)
      await expect(grants.assertCanSaveDrawing(link)).rejects.toThrow(/Open or Save dialogs/)
    })

    it('refuses a dangling symlink as a new file', async () => {
      const grants = new PathGrants()
      const link = path.join(root, 'dangling.excalidraw.md')
      await symlink(path.join(root, 'does-not-exist.excalidraw.md'), link)
      expect(await canonicalPath(link)).toBeNull()
      expect(await grants.grant(link)).toBe(false)
    })

    it('names a new file in a symlinked folder by the folder\'s real location', async () => {
      const dir = path.join(root, 'real-dir')
      await mkdir(dir, { recursive: true })
      expect(await canonicalPath(path.join(root, 'link-dir', 'later.excalidraw'))).toBe(
        path.join(dir, 'later.excalidraw'),
      )
    })
  })
})

describe('withDrawingExtension', () => {
  it.each([
    ['/a/Board.excalidraw.md', '/a/Board.excalidraw.md'],
    ['/a/Board.excalidraw', '/a/Board.excalidraw'],
    ['/a/Board.EXCALIDRAW.MD', '/a/Board.EXCALIDRAW.MD'],
    ['/a/Board.md', '/a/Board.excalidraw.md'],
    ['/a/Board', '/a/Board.excalidraw.md'],
    ['/a/Board.txt', '/a/Board.txt.excalidraw.md'],
  ])('%s -> %s', (given, expected) => {
    expect(withDrawingExtension(given)).toBe(expected)
  })
})

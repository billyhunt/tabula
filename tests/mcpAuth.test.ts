import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  checkExportPath,
  checkMcpRequest,
  checkOpenPath,
  checkSavePath,
} from '../src/main/agent/mcpChecks'

const PORT = 7337
const TOKEN = 'k3Jq9xQx0Vb7r2YtqzM8fW1aN5dLc6HsE4uPoZiTgAo'
const good = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` }

describe('checkMcpRequest', () => {
  it('lets through the right token on our own host', () => {
    expect(checkMcpRequest(good, PORT, TOKEN)).toEqual({ ok: true })
    expect(checkMcpRequest({ ...good, host: `localhost:${PORT}` }, PORT, TOKEN).ok).toBe(true)
  })

  it('refuses a missing, wrong or truncated token', () => {
    for (const authorization of [undefined, `Bearer nope`, `Bearer ${TOKEN.slice(1)}`, TOKEN, 'Bearer ']) {
      expect(checkMcpRequest({ ...good, authorization }, PORT, TOKEN)).toMatchObject({
        ok: false,
        status: 401,
      })
    }
  })

  it('refuses everything when no token exists', () => {
    expect(checkMcpRequest({ ...good, authorization: 'Bearer ' }, PORT, '').ok).toBe(false)
  })

  it('refuses other hosts, such as a DNS-rebinding page', () => {
    for (const host of [undefined, 'evil.example:7337', `127.0.0.1:${PORT + 1}`, '127.0.0.1', `0.0.0.0:${PORT}`]) {
      expect(checkMcpRequest({ ...good, host }, PORT, TOKEN)).toMatchObject({ ok: false, status: 403 })
    }
  })

  it('refuses browser requests even with the right token', () => {
    for (const origin of ['https://evil.example', 'null', `http://127.0.0.1:${PORT}`]) {
      expect(checkMcpRequest({ ...good, origin }, PORT, TOKEN)).toMatchObject({ ok: false, status: 403 })
    }
  })
})

describe('MCP file paths', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'tabula-mcp-'))
    await writeFile(path.join(dir, 'Board.excalidraw.md'), '# drawing')
    await writeFile(path.join(dir, 'taken.png'), 'png')
    await mkdir(path.join(dir, 'folder.excalidraw'))
  })

  it('exports only to absolute paths with the matching extension', async () => {
    await expect(checkExportPath('png', path.join(dir, 'out.png'), false)).resolves.toBe(
      path.join(dir, 'out.png'),
    )
    await expect(checkExportPath('mermaid', path.join(dir, 'flow.mmd'), false)).resolves.toBeTruthy()
    await expect(checkExportPath('png', 'out.png', false)).rejects.toThrow('absolute')
    await expect(checkExportPath('svg', path.join(dir, 'out.png'), false)).rejects.toThrow('.svg')
    await expect(checkExportPath('pdf', path.join(dir, 'missing', 'out.pdf'), false)).rejects.toThrow(
      "folder doesn't exist",
    )
  })

  it('refuses to replace an existing export unless asked', async () => {
    await expect(checkExportPath('png', path.join(dir, 'taken.png'), false)).rejects.toThrow(
      'overwrite',
    )
    await expect(checkExportPath('png', path.join(dir, 'taken.png'), true)).resolves.toBeTruthy()
  })

  it('opens only existing drawing files', async () => {
    await expect(checkOpenPath(path.join(dir, 'Board.excalidraw.md'))).resolves.toBeTruthy()
    await expect(checkOpenPath(path.join(dir, 'Nope.excalidraw.md'))).rejects.toThrow('No such file')
    await expect(checkOpenPath(path.join(dir, 'taken.png'))).rejects.toThrow('.excalidraw')
    await expect(checkOpenPath(path.join(dir, 'folder.excalidraw'))).rejects.toThrow('No such file')
  })

  it('saves only as .excalidraw.md or .excalidraw', async () => {
    await expect(checkSavePath(path.join(dir, 'New.excalidraw.md'))).resolves.toBeTruthy()
    await expect(checkSavePath(path.join(dir, 'New.excalidraw'))).resolves.toBeTruthy()
    await expect(checkSavePath(path.join(dir, 'Notes.md'))).rejects.toThrow('.excalidraw.md')
    await expect(checkSavePath(path.join(dir, 'folder.excalidraw'))).rejects.toThrow('folder')
  })

  it('refuses drawing files that are symlinks, which could point anywhere', async () => {
    const secret = path.join(dir, 'secret.txt')
    await writeFile(secret, 'not a drawing')
    const link = path.join(dir, 'Link.excalidraw')
    await symlink(secret, link)
    await expect(checkSavePath(link)).rejects.toThrow('symbolic link')
    await expect(checkOpenPath(link)).rejects.toThrow('symbolic link')
    await expect(checkExportPath('svg', path.join(dir, 'link.svg'), true)).resolves.toBeTruthy()
    await symlink(secret, path.join(dir, 'link.svg'))
    await expect(checkExportPath('svg', path.join(dir, 'link.svg'), true)).rejects.toThrow('symbolic link')
  })
})

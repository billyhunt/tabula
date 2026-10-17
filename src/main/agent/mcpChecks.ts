import { createHash, timingSafeEqual } from 'node:crypto'
import { lstat, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ExportFileFormat } from '../../shared/agentTools'

/**
 * What the MCP server lets through. Kept free of Electron so it can be
 * tested on its own.
 */

export type RequestCheck = { ok: true } | { ok: false; status: 401 | 403; message: string }

type Headers = Record<string, string | string[] | undefined>

// Hashing first makes the compare constant-time regardless of length.
const sameSecret = (given: string, expected: string) =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  )

/**
 * Checks a request to the local MCP endpoint. Browsers always send Origin on
 * cross-site requests, and a DNS-rebinding page reaches us under its own host
 * name, so refusing any Origin and any Host but our own keeps web pages out
 * even before the token is checked.
 */
export const checkMcpRequest = (headers: Headers, port: number, token: string): RequestCheck => {
  if (headers.origin !== undefined) {
    return { ok: false, status: 403, message: 'Browser requests are not allowed' }
  }
  const host = headers.host
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (typeof host !== 'string' || !allowedHosts.includes(host.toLowerCase())) {
    return { ok: false, status: 403, message: 'Unexpected Host header' }
  }
  const match = typeof headers.authorization === 'string'
    ? /^Bearer +(\S+) *$/i.exec(headers.authorization)
    : null
  if (!token || !match?.[1] || !sameSecret(match[1], token)) {
    return { ok: false, status: 401, message: 'Missing or wrong bearer token' }
  }
  return { ok: true }
}

const EXPORT_EXTENSIONS: Record<ExportFileFormat, readonly string[]> = {
  png: ['.png'],
  svg: ['.svg'],
  pdf: ['.pdf'],
  mermaid: ['.mmd', '.mermaid'],
}

const statOrNull = (filePath: string) => stat(filePath).catch(() => null)

/**
 * Agents name files by path, and the extension check reads only the name.
 * A symlink called board.excalidraw could point anywhere, so a write would
 * clobber its target and a read could leak it. Symlinked folders are fine:
 * the file itself must not be a link.
 */
const rejectSymlink = async (target: string) => {
  if ((await lstat(target).catch(() => null))?.isSymbolicLink()) {
    throw new Error(`${target} is a symbolic link; give the real file's path`)
  }
}

/** Normalizes an absolute path whose folder exists; throws otherwise. */
const resolveInExistingFolder = async (filePath: string) => {
  if (!path.isAbsolute(filePath)) throw new Error(`The path must be absolute: ${filePath}`)
  const normalized = path.normalize(filePath)
  const folder = path.dirname(normalized)
  if (!(await statOrNull(folder))?.isDirectory()) {
    throw new Error(`The folder doesn't exist: ${folder}`)
  }
  if ((await statOrNull(normalized))?.isDirectory()) {
    throw new Error(`That path is a folder: ${normalized}`)
  }
  await rejectSymlink(normalized)
  return normalized
}

/** Where an export may be written. */
export const checkExportPath = async (
  format: ExportFileFormat,
  filePath: string,
  overwrite: boolean,
): Promise<string> => {
  const target = await resolveInExistingFolder(filePath)
  const extensions = EXPORT_EXTENSIONS[format]
  if (!extensions.some((ext) => target.toLowerCase().endsWith(ext))) {
    throw new Error(`A ${format} export must end in ${extensions.join(' or ')}`)
  }
  if (!overwrite && (await statOrNull(target))) {
    throw new Error(`${target} already exists; pass overwrite: true to replace it`)
  }
  return target
}

/** A drawing an agent may open. */
export const checkOpenPath = async (filePath: string): Promise<string> => {
  if (!path.isAbsolute(filePath)) throw new Error(`The path must be absolute: ${filePath}`)
  const target = path.normalize(filePath)
  if (!/\.(md|excalidraw)$/i.test(target)) {
    throw new Error('Only .excalidraw.md and .excalidraw drawings can be opened')
  }
  if (!(await statOrNull(target))?.isFile()) throw new Error(`No such file: ${target}`)
  await rejectSymlink(target)
  return target
}

/** Where an agent may save the drawing. */
export const checkSavePath = async (filePath: string): Promise<string> => {
  const target = await resolveInExistingFolder(filePath)
  if (!/\.excalidraw(\.md)?$/i.test(target)) {
    throw new Error('Drawings are saved as .excalidraw.md (Obsidian) or .excalidraw')
  }
  return target
}

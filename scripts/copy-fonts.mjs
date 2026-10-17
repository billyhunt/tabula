#!/usr/bin/env node
/**
 * Copies Excalidraw's hand-drawn fonts into public/ so the app works offline.
 * Without a local copy Excalidraw falls back to fetching them from esm.sh,
 * which the production CSP blocks.
 */
import { cpSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
if (existsSync(src)) cpSync(src, path.join(root, 'public/fonts'), { recursive: true })

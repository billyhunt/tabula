import { net, protocol } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The packaged renderer is served from app://tabula/ instead of file://.
 *
 * Under file:// the page has an opaque origin: the CSP's 'self' matches
 * nothing, and fetch() refuses file: URLs. Excalidraw loads its hand-drawn
 * fonts with fetch (to show them, to measure text for the editor, and to
 * inline them into SVG/PDF exports), so under file:// it silently fell back
 * to a CDN the CSP blocks. A standard, secure scheme gives the page a real
 * origin, so the bundled fonts load like any other same-origin asset.
 */
const SCHEME = 'app'
const HOST = 'tabula'
export const RENDERER_URL = `${SCHEME}://${HOST}/index.html`

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist')

/** Must run before the app is ready. */
export const registerRendererScheme = () => {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

/** Must run once the app is ready, before the first window loads. */
export const serveRenderer = () => {
  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    const file = path.normalize(path.join(root, decodeURIComponent(url.pathname)))
    // Only files inside dist/, whatever the URL says.
    if (url.host !== HOST || !file.startsWith(root + path.sep)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })
}

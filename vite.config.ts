import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { defineConfig, type Plugin } from 'vite'

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; " +
  "worker-src 'self' blob:"

// Production-only CSP. Dev must stay open for Vite's HMR client and the
// React Refresh preamble, both of which need inline scripts.
const cspPlugin: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
    ),
}

export default defineConfig({
  // The packaged app loads the renderer over file://, so asset URLs must be
  // relative rather than root-absolute.
  base: './',
  define: {
    // Excalidraw reads process.env.IS_PREACT at import time.
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  resolve: {
    alias: [
      // New Mermaid text gets Tabula's font; see the module. Only the bare
      // specifier: the module itself imports the real one by its dist path.
      {
        find: /^@excalidraw\/mermaid-to-excalidraw$/,
        replacement: fileURLToPath(new URL('src/renderer/mermaid/mermaidWithFont.ts', import.meta.url)),
      },
    ],
  },
  plugins: [
    react(),
    cspPlugin,
    electron({
      main: {
        entry: { main: 'src/main/index.ts' },
        onstart: ({ startup }) => {
          void startup(['.', '--remote-debugging-port=9223'])
        },
        vite: { build: { outDir: 'dist-electron', sourcemap: true } },
      },
      preload: {
        input: { preload: 'src/preload/index.ts' },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: 'inline',
            // A sandboxed preload cannot be ESM, so force CJS + .cjs.
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: '[name].cjs' },
            },
          },
        },
      },
    }),
  ],
})

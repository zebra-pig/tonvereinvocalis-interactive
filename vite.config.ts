import { exec } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// Dev server only. Affinity scripts may only write to the Desktop, so the flyer export ("Vocalis Flyer: 3D-Vorschau
// exportieren") lands there; this pulls every new export into src/assets, and the page reloads.
const flyerExport = (): Plugin => ({
  name: 'flyer-export',
  apply: 'serve',
  configureServer(server) {
    const dir = join(homedir(), 'Desktop/vocalis-flyer')
    if (process.env.VITEST || !existsSync(dir)) return // Vitest starts a server too, and the watcher would keep it alive
    let timer: NodeJS.Timeout
    const watcher = watch(dir, () => {
      clearTimeout(timer) // one export writes two files, in several chunks
      timer = setTimeout(() => exec('pnpm run flyer', (error) => server.config.logger[error ? 'error' : 'info'](error ? `flyer: ${error.message}` : 'flyer: artwork updated from the Affinity export')), 1000)
    })
    server.httpServer?.once('close', () => watcher.close())
  },
  // preview.html swaps the artwork in place instead of reloading.
  handleHotUpdate({ file, server }) {
    if (!file.includes('/src/assets/flyer-')) return
    server.ws.send({ type: 'custom', event: 'flyer' })
    return []
  },
})

export default defineConfig({
  plugins: [flyerExport()],
  server: {
    // Cloudflare quick tunnels. Using a named tunnel? Add its hostname here.
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    // three/webgpu is ~780 kB (~215 kB gzip). It's lazy-loaded after the flyer image, so that's expected.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      // Only the embed and its lazy chunks ship. index.html is the local test site: `pnpm dev` serves it, builds skip it.
      input: { 'vocalis-flyer-interaktiv': 'src/vocalis-flyer-interaktiv.ts' },
      output: {
        // Stable name: this is the URL embedded in Webstudio.
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})

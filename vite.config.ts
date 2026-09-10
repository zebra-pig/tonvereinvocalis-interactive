import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // Cloudflare quick tunnels. Using a named tunnel? Add its hostname here.
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    // three/webgpu is ~780 kB (~215 kB gzip). It's lazy-loaded after the flyer image, so that's expected.
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      input: {
        index: 'index.html',
        'vocalis-flyer-interaktiv': 'src/vocalis-flyer-interaktiv.ts',
      },
      output: {
        // Stable name: this is the URL embedded in Webstudio.
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})

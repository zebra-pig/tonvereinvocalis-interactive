import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // Cloudflare quick tunnels. Using a named tunnel? Add its hostname here.
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    rolldownOptions: {
      input: {
        index: 'index.html',
        'vocalis-flyer': 'src/vocalis-flyer.ts',
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

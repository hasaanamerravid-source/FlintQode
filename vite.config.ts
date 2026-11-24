import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'

/**
 * The renderer is a plain Vite app. Tauri serves it from `devUrl` during
 * development and from `frontendDist` in the packaged application.
 */
const rendererDir = resolve(import.meta.dirname, 'src/renderer')

export default defineConfig({
  root: rendererDir,
  clearScreen: false,
  plugins: [solid()],
  resolve: {
    alias: {
      '@': resolve(rendererDir, 'src'),
      '@shared': resolve(import.meta.dirname, 'src/shared'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    minify: 'oxc',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (!/[\\/]node_modules[\\/]/.test(id)) return undefined
          if (/[\\/]@tauri-apps[\\/]/.test(id)) return 'tauri'
          if (
            /[\\/]@codemirror[\\/](state|view|language|commands|autocomplete|search|lint)[\\/]/.test(
              id,
            )
          ) {
            return 'codemirror-core'
          }
          if (/[\\/](?:marked|dompurify)[\\/]/.test(id)) return 'markdown'
          return undefined
        },
      },
    },
  },
})

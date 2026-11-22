import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The renderer is a plain Vite app. Tauri serves it from `devUrl` during
 * development and from `frontendDist` in the packaged application.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer/src'),
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
    target: 'es2021',
    minify: 'oxc',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    // Keep the initial bundle small: the editor engine, the language packs and
    // the icon data are large and are only needed by the part of the app that
    // is actually on screen.
    rolldownOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules')) {
            if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('/codemirror/')) {
              return 'codemirror'
            }
            if (id.includes('@tauri-apps')) return 'tauri'
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('zustand') || id.includes('scheduler')) {
              return 'vendor'
            }
            if (id.includes('marked') || id.includes('dompurify')) return 'markdown'
            return 'vendor'
          }
          if (id.includes('/core/iconShapes') || id.includes('/core/icons/')) return 'icons'
          return undefined
        },
      },
    },
  },
})

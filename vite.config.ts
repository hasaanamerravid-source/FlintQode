import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The renderer is a plain Vite app. Tauri serves it from `devUrl` during
 * development and from `frontendDist` in the packaged application.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2021',
    minify: 'oxc',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
})

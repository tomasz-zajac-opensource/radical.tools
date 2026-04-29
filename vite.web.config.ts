/**
 * Standalone Vite config for building the renderer as a plain SPA
 * (no Electron shell). Output lands in out/renderer/ — same path as
 * electron-vite build so the GitHub Actions sync script just works.
 *
 * Usage:  npm run build:web
 *
 * Note: window.electronAPI calls in the code are all optional-chained
 * (?.readFile, ?.saveDiagram etc.) so the SPA gracefully degrades —
 * filesystem-backed document storage is disabled in the browser but
 * all diagram editing works via localStorage.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'src/renderer'),
  base: '/',
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  optimizeDeps: {
    include: ['reactflow', 'webcola'],
  },
})

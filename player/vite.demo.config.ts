import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Builds demo.html, not the real app, for the live demo on GitHub Pages.
export default defineConfig({
  plugins: [react()],
  base: '/Aurora/',
  build: {
    outDir: 'dist-demo',
    rollupOptions: { input: 'demo.html' },
  },
})

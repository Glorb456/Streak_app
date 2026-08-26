import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Served under /notes/ by the Streak nginx, so the built asset URLs have to
  // carry that prefix — with the default '/' the app would 404 on its own JS.
  base: '/notes/',
  plugins: [react()],
  server: {
    // Dev only. In production both apps sit behind one nginx (and therefore
    // one oauth2-proxy session); here the notes API is its own uvicorn.
    proxy: {
      '/api/notes': 'http://localhost:8001',
    },
  },
})

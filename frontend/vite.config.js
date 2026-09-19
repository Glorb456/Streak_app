import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Build stamp, surfaced in the sync menu. A tab running an old bundle (stale
// browser cache, or a container that was never rebuilt) is invisible from the
// inside otherwise.
const BUILD_ID = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The UI calls relative /api/... URLs; Vite forwards them to the FastAPI backend (backend/).
const api = { '/api': { target: 'http://localhost:8000', changeOrigin: true } }

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: api },
  preview: { proxy: api },
})

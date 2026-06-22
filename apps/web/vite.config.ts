import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// In docker the API lives at http://server:3000; locally it's http://localhost:3000.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000"

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true },
    },
  },
})

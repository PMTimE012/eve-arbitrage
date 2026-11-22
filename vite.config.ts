import { spawn } from 'node:child_process'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

function localMarketAutoRefreshPlugin(): Plugin {
  return {
    name: 'local-market-auto-refresh',
    configureServer(server) {
      let running = false
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'ensure-fresh-data.mjs')
      const checkAndRefresh = () => {
        if (running) return
        running = true
        const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' })
        child.on('exit', () => {
          running = false
        })
        child.on('error', () => {
          running = false
        })
      }

      // Check every 5m; ensure-fresh-data.mjs only fetches when snapshot age > 30m
      const startupTimer = setTimeout(checkAndRefresh, 5000)
      const interval = setInterval(checkAndRefresh, 5 * 60 * 1000)
      server.httpServer?.once('close', () => {
        clearTimeout(startupTimer)
        clearInterval(interval)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), localMarketAutoRefreshPlugin()],
})

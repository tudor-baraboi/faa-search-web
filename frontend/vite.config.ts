import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import path from 'path'

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true
      }
    }
  }
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Small shell assets are precached explicitly here (logos < 15 KB,
      // icons < 150 KB) — `png` stays out of workbox.globPatterns so any
      // future large png doesn't blow the precache size cap.
      includeAssets: ['favicon.svg', 'icons/*.png', 'logo-full.png', 'logo-small.png'],
      manifest: {
        name: 'MPS TRM - Tricotage Malterre',
        short_name: 'MPS TRM',
        description: 'Système ERP pour Tricotage Malterre - Production tricotage',
        theme_color: '#00243E',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // `png` deliberately omitted (see includeAssets above).
        globPatterns: ['**/*.{js,css,html,ico,svg}'],
        // NEVER remove: without it the SW intercepts /api/ navigations and
        // serves index.html, breaking React Router.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5175
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})

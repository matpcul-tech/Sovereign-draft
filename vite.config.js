import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from the domain root by default. GitHub Pages project sites live
// under /<repo>/, so CI sets VITE_BASE (e.g. "/Sovereign-draft/").
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  build: {
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        embed: 'embed.html'
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Sovereign Draft',
        short_name: 'Sovereign',
        description: 'Touch-first 2D CAD for architectural drafting. DXF in/out, PDF to true scale, AI drafting.',
        theme_color: '#07101f',
        background_color: '#07101f',
        display: 'standalone',
        orientation: 'any',
        // Relative to the manifest, so these resolve under any deploy base.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
});

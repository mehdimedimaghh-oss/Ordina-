import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'Comande Pranzo',
        short_name: 'Comande',
        description: 'Lunch orders · Hotel Concordia & Fugari Bistrot',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F4F5F8',
        theme_color: '#14224A',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        // never cache the database: orders must always be live
        runtimeCaching: [
          { urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com', handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css' } },
          { urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com', handler: 'CacheFirst', options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 }, cacheableResponse: { statuses: [0, 200] } } },
        ],
      },
    }),
  ],
});

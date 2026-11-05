import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    rollupOptions: {
      // the 3D rooftop (Three.js) is a separate file, downloaded only when the owner opens it
      // (only a name: grouping is left to the bundler, so shared app code never moves into the 3D file)
      output: { chunkFileNames: c => (c.moduleIds.some(id => id.includes('node_modules/three') || id.includes('/src/rooftop/')) ? 'assets/rooftop-[hash].js' : 'assets/[name]-[hash].js') },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.png', 'logo.png', 'terrace.jpg', 'apple-touch-icon.png', 'robots.txt'],
      manifest: {
        name: 'Comande Pranzo',
        short_name: 'Comande',
        description: 'Lunch orders · Concordia Hotel & Private Dependance · Fugari Bistrot',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1E1E1E',
        theme_color: '#14224A',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,woff2}'],
        globIgnores: ['**/rooftop-*.js', 'rooftop/**'],   // waiters' devices don't download the 3D part or the guests' rooftop menu
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/rooftop/],   // /rooftop/ is the guests' QR menu, not the staff app
        // never cache the database: orders must always be live
        runtimeCaching: [
          { urlPattern: ({ url }) => /\/assets\/rooftop-.*\.js$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'rooftop-3d' } },
          { urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com', handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css' } },
          { urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com', handler: 'CacheFirst', options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 }, cacheableResponse: { statuses: [0, 200] } } },
        ],
      },
    }),
  ],
});

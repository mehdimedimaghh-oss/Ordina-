// DEMO ONLY — the same app with fake data and a neutral brand, for promo videos.
// Start:  npx vite --config demo/vite.config.js   (needs the local demo database, see demo/README.md)
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { demoApi } from './server.mjs';

const here = p => fileURLToPath(new URL(p, import.meta.url));

// Neutral brand: no real hotel, restaurant or staff names on screen
const REPLACE = [
  [/Ristorante Hotel Concordia/g, 'Ristorante Aurora'],
  [/Concordia Hotel &(amp;)? Private Dependance/g, 'Hotel Aurora'],
  [/Ristorante Concordia/g, 'Ristorante Aurora'],
  [/Hotel Concordia/g, 'Hotel Aurora'],
  [/Fugari Bistrot/g, 'Aurora Bistrot'],
  [/<b>HCO<\/b> Concordia/g, '<b>A</b> Main building'],
  [/<b>DEP<\/b> Dépendance/g, '<b>B</b> Garden wing'],
  [/HCO o DEP/g, 'A o B'], [/HCO or DEP/g, 'A or B'],
  [/Concordia/g, 'Aurora'],
  [/Comande Pranzo/g, 'Comanda Live'],
  [/>Comande</g, '>Comanda Live<'],
  [/<h1>Comande<\/h1>/g, '<h1>Comanda Live</h1>'],
  // staff schedule names -> invented names
  [/MED: 'Mehdi', ZAI: 'Zai', GAB: 'Gabri', NIK: 'Nikola', CRI: 'Cristian'/g, "MED: 'Luca', ZAI: 'Sara', GAB: 'Marco', NIK: 'Giulia', CRI: 'Paolo'"],
  [/“Mehdi”/g, '“Luca”'],
  // building codes shown as A / B
  [/\[o\.building \|\| ''/g, "[({ HCO: 'A', DEP: 'B' })[o.building] || ''"],
];

const brand = {
  name: 'demo-brand',
  enforce: 'pre',
  transform(code, id) {
    if (!/\/src\/.*\.(js|css)$/.test(id)) return null;
    let out = code; for (const [a, b] of REPLACE) out = out.replace(a, b);
    return out === code ? null : { code: out, map: null };
  },
  transformIndexHtml(html) { let out = html; for (const [a, b] of REPLACE) out = out.replace(a, b); return out; },
};

// no offline worker in the demo
const noPwa = { name: 'demo-no-pwa', resolveId: id => (id === 'virtual:pwa-register' ? '\0pwa' : null), load: id => (id === '\0pwa' ? 'export const registerSW = () => () => {};' : null) };

export default defineConfig({
  root: here('..'),
  publicDir: here('./public'),
  resolve: { alias: { '@supabase/supabase-js': here('./supabase-mock.js') } },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://demo.local'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('demo'),
    'import.meta.env.VITE_STAFF_EMAIL': JSON.stringify('staff@demo.app'),
  },
  server: { port: 5199, strictPort: true },
  plugins: [brand, noPwa, demoApi()],
});

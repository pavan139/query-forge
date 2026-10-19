import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Emits sw.js: an offline-capable service worker.
 * - Pages and data files: network first (so updates arrive immediately), cache as fallback (offline).
 * - Hashed build assets (JS/CSS/WASM): cache first (they never change).
 */
function serviceWorker(): Plugin {
  return {
    name: 'sqlquest-service-worker',
    apply: 'build',
    generateBundle() {
      const version = new Date().toISOString();
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// SQL Quest service worker — build ${version}
const CACHE = 'sqlquest-${version}';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('sqlquest-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/assets/')) e.respondWith(cacheFirst(req));
  else e.respondWith(networkFirst(req));
});
`,
      });
    },
  };
}

// Relative base so the built site works from any folder (GitHub Pages, Netlify, a USB stick...).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
} as never);

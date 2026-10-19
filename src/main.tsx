import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles.css';
import { App } from './App.tsx';
import { db } from './db/client.ts';

// Start PostgreSQL in the background right away so the first query is quick.
void db.warmUp().catch((e) => console.error('Database failed to start', e));

// Ask the browser not to evict saved progress when disk space is low.
void navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

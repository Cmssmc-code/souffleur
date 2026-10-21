/* Souffleur — service worker : coquille hors-ligne.
 *
 * - Pré-cache versionné de la coquille (index, souffleur.html, manifest, icônes).
 *   VERSION et SHELL sont réécrits par tools/build.mjs (version = hash du contenu).
 * - Build : stale-while-revalidate pour la coquille ; dev (VERSION 'dev') : réseau d'abord.
 * - Navigation hors-ligne : index.html (ou souffleur.html) depuis le cache.
 * - JAMAIS de cache pour les API IA (googleapis, anthropic) ni pour jsDelivr hors pdf.js.
 * - Messages reçus :  {type:'SKIP_WAITING'} (ou 'SKIP_WAITING') -> active la nouvelle version ;
 *                     {type:'GET_VERSION'} -> répond {type:'VERSION', version, cache, ready, entries}.
 * - Message émis à l'activation : {type:'SW_ACTIVATED', version} à toutes les fenêtres.
 * Côté page : enregistrer avec navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}) ;
 * si registration.waiting -> proposer « Nouvelle version disponible — recharger » ->
 * waiting.postMessage({type:'SKIP_WAITING'}) puis recharger sur 'controllerchange'.
 */
'use strict';

const VERSION = /*@version*/'dev'/*@end*/;
const SHELL = /*@shell*/[
  './index.html', './souffleur.html', './manifest.webmanifest',
  './styles.css', './screens.css',
  './js/util.js', './js/store.js', './js/docs.js', './js/ai.js', './js/audio.js', './js/app.js', './js/screens.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png'
]/*@end*/;

const DEV = VERSION === 'dev';
const PREFIX = 'souffleur-shell-';
const CACHE = PREFIX + VERSION;
const PDFJS_CACHE = 'souffleur-pdfjs';
const SCOPE = new URL(self.registration ? self.registration.scope : './', self.location.href);
const INDEX = new URL('index.html', SCOPE).href;
const SINGLE = new URL('souffleur.html', SCOPE).href;
// Hosts that must never be intercepted (AI APIs, key-bearing requests).
const NEVER = /(^|\.)googleapis\.com$|(^|\.)anthropic\.com$|(^|\.)google\.com$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.allSettled(SHELL.map(async (path) => {
      const url = new URL(path, SCOPE).href;
      const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
      if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status);
      await cache.put(url, res);
    }));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length && !DEV) console.warn('[sw] pré-cache incomplet :', failed.map((f) => String(f.reason)));
    // The shell is mandatory: without an HTML entry point offline mode is impossible.
    if (!(await cache.match(INDEX)) && !(await cache.match(SINGLE))) {
      throw new Error('[sw] coquille introuvable (index.html / souffleur.html)');
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: VERSION }));
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  const type = typeof data === 'string' ? data : data && data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'GET_VERSION') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const entries = (await cache.keys()).length;
      const ready = !!((await cache.match(INDEX)) || (await cache.match(SINGLE)));
      const reply = { type: 'VERSION', version: VERSION, cache: CACHE, ready, entries };
      if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
      else if (event.source) event.source.postMessage(reply);
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
  if (NEVER.test(url.hostname)) return; // AI APIs: straight to the network, never cached.

  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(SCOPE.href)) return;
    if (url.pathname.endsWith('/sw.js') || url.pathname.includes('/.well-known/')) return;
    if (req.mode === 'navigate' || req.destination === 'document') {
      event.respondWith(handleNavigation(event, req, url));
    } else {
      event.respondWith(handleAsset(event, req, url));
    }
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' && /\/npm\/pdfjs-dist@/.test(url.pathname)) {
    event.respondWith(handlePdfjs(event, req, url));
  }
  // Everything else (other CDNs, fonts, analytics…) is left to the browser.
});

function navKey(url) {
  const u = new URL(url.href);
  u.search = ''; u.hash = '';
  if (u.pathname.endsWith('/')) u.pathname += 'index.html';
  return u.href;
}

function cacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.headers.has('content-range');
}

async function handleNavigation(event, req, url) {
  const cache = await caches.open(CACHE);
  const key = navKey(url);
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(cache.put(key, copy).catch(() => {}));
    }
    return res;
  });

  if (cached && !DEV) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  try {
    const res = await network;
    // Server error while we hold a copy: the copy is more useful than an error page.
    return (res.status >= 500 && cached) ? cached : res;
  } catch (err) {
    return cached || (await shellFallback(cache)) || offlinePage();
  }
}

async function shellFallback(cache) {
  return (await cache.match(INDEX)) || (await cache.match(SINGLE)) ||
    (await caches.match(INDEX)) || (await caches.match(SINGLE)) || null;
}

async function handleAsset(event, req, url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(cache.put(req, copy).catch(() => {}));
    }
    return res;
  });
  if (cached && !DEV) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  try {
    return await network;
  } catch (err) {
    if (cached) return cached;
    return new Response('', { status: 504, statusText: 'Hors-ligne' });
  }
}

async function handlePdfjs(event, req, url) {
  const cache = await caches.open(PDFJS_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // Versioned jsDelivr URLs are immutable: keep successful (cors) or opaque (no-cors) answers.
  if ((res.ok && (res.type === 'cors' || res.type === 'basic')) || res.type === 'opaque') {
    const copy = res.clone();
    event.waitUntil(cache.put(req, copy).then(() => trim(cache, 12)).catch(() => {}));
  }
  return res;
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function offlinePage() {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Souffleur — hors-ligne</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:#0b0d1a;color:#f5f5f7;text-align:center;padding:24px}' +
    'h1{font-size:28px;letter-spacing:-.02em;margin:0 0 8px}p{opacity:.75;max-width:30em}button{margin-top:16px;font:inherit;border:0;border-radius:999px;padding:12px 22px;background:#0a84ff;color:#fff}</style></head>' +
    '<body><main><h1>Souffleur est hors-ligne</h1><p>Cette page n’a pas encore été enregistrée sur cet appareil. ' +
    'Reconnectez-vous une fois à Internet pour l’installer, ou ouvrez le fichier unique <b>souffleur.html</b>.</p>' +
    '<button onclick="location.reload()">Réessayer</button></main></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

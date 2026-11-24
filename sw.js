// Service worker: deja abrir la app sin internet.
//  - Archivos propios: primero la red (para recibir actualizaciones) y, si no hay, la copia guardada.
//  - Librerías de CDN (Tailwind, Firebase): copia guardada primero y se renueva en segundo plano.
//  - Firestore/Auth NO pasan por aquí: su propio caché offline guarda los datos.
// Al cambiar archivos de la app, sube VERSION para limpiar copias viejas.

const VERSION = 'p3m-v2';
const ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles.css',
  'icon-192.png',
  'icon-512.png',
  'main.js',
  'config.js',
  'firebase.js',
  'auth.js',
  'data.js',
  'estado.js',
  'ui.js',
  'pos.js',
  'admin.js',
  'money.js',
  'calculos.js',
  'seguridad.js',
  'migracion.js',
  'utils.js',
];
const CDN = ['cdn.tailwindcss.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(ARCHIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copia = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copia));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
        ),
    );
    return;
  }

  if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((guardado) => {
        const red = fetch(req)
          .then((res) => {
            const copia = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copia));
            return res;
          })
          .catch(() => guardado);
        return guardado || red;
      }),
    );
  }
});

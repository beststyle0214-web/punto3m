// Service worker: deja abrir y usar la app sin internet.
//  - Archivos propios: primero la red (para recibir actualizaciones) y, si no hay, la copia guardada.
//  - Librerías de CDN (Tailwind, Firebase): copia guardada primero y se renueva en segundo plano.
//    Se descargan al instalar, así que después de la primera vez la app abre aunque Google no responda.
//  - Firestore/Auth NO pasan por aquí: su propio caché offline guarda los datos.
//  - Avisos: muestra las notificaciones y, al tocarlas, abre la app.
// Al cambiar archivos de la app, sube VERSION para limpiar copias viejas.

const VERSION = 'p3m-v5';
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
  'avisos.js',
  'cuenta.js',
  'escaner.js',
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
const CDN_URLS = [
  'https://cdn.tailwindcss.com',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js',
];
const CDN = ['cdn.tailwindcss.com', 'www.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then(async (c) => {
        await c.addAll(ARCHIVOS);
        // Las librerías externas se guardan "a mejor esfuerzo": si una falla, no se rompe la instalación.
        await Promise.all(
          CDN_URLS.map((u) => c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})),
        );
      })
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
          caches.match(req, { ignoreSearch: true }).then(
            (r) => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()),
          ),
        ),
    );
    return;
  }

  if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((guardado) => {
        const red = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              const copia = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copia));
            }
            return res;
          })
          .catch(() => guardado || Response.error());
        return guardado || red;
      }),
    );
  }
});

// Al tocar un aviso, se abre (o se enfoca) la app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      const abierta = ventanas.find((v) => 'focus' in v);
      return abierta ? abierta.focus() : self.clients.openWindow('./');
    }),
  );
});

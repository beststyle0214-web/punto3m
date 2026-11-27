// Inicialización de Firebase (SDK "compat" cargado por <script> en index.html).
import { firebaseConfig, PROXY_URL } from './config.js';

/* global firebase */
firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
export const FieldValue = firebase.firestore.FieldValue;
export const EmailAuthProvider = firebase.auth.EmailAuthProvider;

const proxy = (PROXY_URL || '').trim().replace(/\/+$/, '');

// Con intermediario (Cuba sin VPN): el inicio de sesión y la base de datos pasan por él.
// Para Auth se usa el mismo mecanismo que el "emulador" del SDK, que permite elegir otra dirección.
if (proxy) {
  try {
    auth.useEmulator(proxy, { disableWarnings: true });
  } catch (e) {
    console.warn('No se pudo usar el intermediario para el inicio de sesión:', e);
  }
}

// Redes malas (como las de Cuba): los proxys y firewalls suelen cortar el canal normal de
// Firestore. Con intermediario se fuerza el modo "long polling" (peticiones normales), que es el que
// atraviesa cualquier red; sin él, "AutoDetectLongPolling" cambia solo cuando hace falta.
// "ignoreUndefinedProperties" evita que un campo vacío haga fallar todo el guardado.
try {
  const ajustes = { ignoreUndefinedProperties: true, merge: true };
  if (proxy) {
    ajustes.host = new URL(proxy).host;
    ajustes.ssl = true;
    ajustes.experimentalForceLongPolling = true;
  } else {
    ajustes.experimentalAutoDetectLongPolling = true;
  }
  db.settings(ajustes);
} catch (e) {
  console.warn('No se pudo ajustar la conexión de Firestore:', e);
}

// Caché local: la app abre y puede vender aunque se caiga el internet;
// las escrituras quedan en cola y se envían al reconectar.
db.enablePersistence({ synchronizeTabs: false }).catch((e) => {
  console.warn('Modo offline no disponible en este navegador:', e.code);
});

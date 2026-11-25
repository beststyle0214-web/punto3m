// Inicialización de Firebase (SDK "compat" cargado por <script> en index.html).
import { firebaseConfig } from './config.js';

/* global firebase */
firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
export const FieldValue = firebase.firestore.FieldValue;
export const EmailAuthProvider = firebase.auth.EmailAuthProvider;

// Redes malas (como las de Cuba): los proxys y firewalls suelen cortar el canal normal de
// Firestore. "AutoDetectLongPolling" cambia solo a un modo más compatible cuando hace falta.
// "ignoreUndefinedProperties" evita que un campo vacío haga fallar todo el guardado.
try {
  db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true, merge: true });
} catch (e) {
  console.warn('No se pudo ajustar la conexión de Firestore:', e);
}

// Caché local: la app abre y puede vender aunque se caiga el internet;
// las escrituras quedan en cola y se envían al reconectar.
db.enablePersistence({ synchronizeTabs: true }).catch((e) => {
  console.warn('Modo offline no disponible en este navegador:', e.code);
});

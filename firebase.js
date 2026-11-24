// Inicialización de Firebase (SDK "compat" cargado por <script> en index.html).
import { firebaseConfig } from './config.js';

/* global firebase */
firebase.initializeApp(firebaseConfig);

export const auth = firebase.auth();
export const db = firebase.firestore();
export const FieldValue = firebase.firestore.FieldValue;
export const EmailAuthProvider = firebase.auth.EmailAuthProvider;

// Caché local: la app abre y puede vender aunque se caiga el internet;
// las escrituras quedan en cola y se envían al reconectar.
db.enablePersistence({ synchronizeTabs: true }).catch((e) => {
  console.warn('Modo offline no disponible en este navegador:', e.code);
});

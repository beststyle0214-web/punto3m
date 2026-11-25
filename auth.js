// Autenticación con Firebase Auth (correo + contraseña).
// "Dueño" = la cuenta tiene un documento en /duenos/{uid} (se crea a mano en la consola).
import { auth, db, EmailAuthProvider } from './firebase.js';
import { hashPin, nuevaSal } from './seguridad.js';
import { conTiempo } from './utils.js';

export const observarSesion = (cb) => auth.onAuthStateChanged(cb);
export const cerrarSesion = () => auth.signOut();

export async function iniciarSesion(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  await recordarClave(cred.user.uid, password);
  return cred;
}

/** Envía el correo para elegir una contraseña nueva (necesita internet). */
export const enviarRecuperacion = (email) => auth.sendPasswordResetEmail(email);

// ---------------------------------------------------------------- clave guardada en el aparato
// Para poder entrar al panel del dueño SIN internet, el aparato guarda una huella (hash) de la
// contraseña; la contraseña en sí nunca se guarda. Solo sirve en este teléfono.

const claveLocal = (uid) => `claveLocal_${uid}`;

async function recordarClave(uid, password) {
  try {
    const sal = nuevaSal();
    localStorage.setItem(claveLocal(uid), JSON.stringify({ sal, hash: await hashPin(password, sal) }));
  } catch (e) {
    /* modo privado: sin esto, entrar al panel sin internet no será posible */
  }
}

async function claveLocalCorrecta(uid, password) {
  try {
    const g = JSON.parse(localStorage.getItem(claveLocal(uid)) || 'null');
    return !!g && (await hashPin(password, g.sal)) === g.hash;
  } catch (e) {
    return false;
  }
}

const hayGuardada = (uid) => {
  try {
    return !!localStorage.getItem(claveLocal(uid));
  } catch (e) {
    return false;
  }
};

// ---------------------------------------------------------------- dueño

export async function esCuentaDueno(user) {
  const marca = `dueno_${user.uid}`;
  try {
    const doc = await conTiempo(db.collection('duenos').doc(user.uid).get(), 7000);
    try {
      localStorage.setItem(marca, doc.exists ? '1' : '0');
    } catch (e) {
      /* sin almacenamiento local */
    }
    return doc.exists;
  } catch (e) {
    if (e && e.code === 'permission-denied') return false;
    // sin internet o muy lenta: se usa lo que se supo la última vez en este aparato
    try {
      return localStorage.getItem(marca) === '1';
    } catch (err) {
      return false;
    }
  }
}

/** Vuelve a pedir la contraseña antes de abrir el panel de administración. */
export async function reautenticar(password) {
  const user = auth.currentUser;
  try {
    const credencial = EmailAuthProvider.credential(user.email, password);
    await user.reauthenticateWithCredential(credencial);
    await recordarClave(user.uid, password);
  } catch (e) {
    const sinRed = e && (e.code === 'auth/network-request-failed' || e.code === 'auth/internal-error');
    if ((sinRed || !navigator.onLine) && hayGuardada(user.uid)) {
      if (await claveLocalCorrecta(user.uid, password)) return;
      throw Object.assign(new Error('clave'), { code: 'auth/wrong-password' });
    }
    throw e;
  }
}

/** Cambia la contraseña de la cuenta actual (pide la actual primero). */
export async function cambiarPassword(actual, nueva) {
  const user = auth.currentUser;
  await user.reauthenticateWithCredential(EmailAuthProvider.credential(user.email, actual));
  await user.updatePassword(nueva);
  await recordarClave(user.uid, nueva);
}

export function mensajeErrorAuth(e) {
  switch (e && e.code) {
    case 'auth/invalid-email':
      return 'El correo no es válido.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Correo o contraseña incorrectos.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
    case 'auth/network-request-failed':
      return 'Sin conexión con Google. Revisa tu internet (si estás en Cuba, puede hacer falta VPN para entrar la primera vez).';
    case 'auth/weak-password':
      return 'La contraseña nueva es muy débil. Usa al menos 8 caracteres.';
    case 'auth/requires-recent-login':
      return 'Por seguridad, cierra sesión, entra otra vez y repite el cambio.';
    case 'auth/missing-email':
      return 'Escribe tu correo.';
    default:
      return 'No se pudo completar. Inténtalo de nuevo.';
  }
}

// Autenticación con Firebase Auth (correo + contraseña).
// "Dueño" = la cuenta tiene un documento en /duenos/{uid} (se crea a mano en la consola).
import { auth, db, EmailAuthProvider } from './firebase.js';

export const observarSesion = (cb) => auth.onAuthStateChanged(cb);
export const iniciarSesion = (email, password) => auth.signInWithEmailAndPassword(email, password);
export const cerrarSesion = () => auth.signOut();

export async function esCuentaDueno(user) {
  try {
    const doc = await db.collection('duenos').doc(user.uid).get();
    return doc.exists;
  } catch (e) {
    return false;
  }
}

/** Vuelve a pedir la contraseña antes de abrir el panel de administración. */
export async function reautenticar(password) {
  const user = auth.currentUser;
  const credencial = EmailAuthProvider.credential(user.email, password);
  await user.reauthenticateWithCredential(credencial);
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
      return 'Sin conexión. Revisa tu internet.';
    default:
      return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
  }
}

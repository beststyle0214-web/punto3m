// PIN de cajero: nunca se guarda en claro, solo su hash PBKDF2-SHA256 con sal propia.
// OJO: un PIN de 4 dígitos es un control "suave" (evita que un cajero use la cuenta de otro
// en el mismo local); la seguridad fuerte del sistema es Firebase Auth + reglas de Firestore.

const enc = new TextEncoder();
const aHex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const pinValido = (pin) => /^\d{4,8}$/.test(String(pin));

export function nuevaSal() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return aHex(bytes);
}

export async function hashPin(pin, sal) {
  const clave = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(sal), iterations: 100000, hash: 'SHA-256' },
    clave,
    256,
  );
  return aHex(bits);
}

export async function verificarPin(pin, sal, hashGuardado) {
  if (!sal || !hashGuardado) return false;
  return (await hashPin(pin, sal)) === hashGuardado;
}

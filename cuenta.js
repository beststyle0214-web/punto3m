// Cuenta: recuperar y cambiar contraseña, avisos del teléfono, instalar la app y buscar actualizaciones.
import { estado } from './estado.js';
import { $ } from './utils.js';
import { abrirModal, cerrarModal, toast, avisar } from './ui.js';
import { enviarRecuperacion, cambiarPassword, mensajeErrorAuth } from './auth.js';
import { alternarAvisos, estadoAvisos } from './avisos.js';

let promptInstalacion = null;

export function guardarPromptInstalacion(evento) {
  promptInstalacion = evento;
  $('btn-instalar').classList.remove('hidden');
  renderCuenta();
}

export function appInstalada() {
  promptInstalacion = null;
  $('btn-instalar').classList.add('hidden');
  renderCuenta();
}

async function instalarApp() {
  if (!promptInstalacion) {
    return avisar(
      'En Chrome toca ⋮ (arriba a la derecha) y elige "Instalar app" o "Añadir a la pantalla de inicio".',
      'Instalar la app',
    );
  }
  promptInstalacion.prompt();
  try {
    await promptInstalacion.userChoice;
  } catch (e) {
    /* el usuario cerró el cuadro */
  }
  promptInstalacion = null;
  $('btn-instalar').classList.add('hidden');
  renderCuenta();
}

// ----------------------------------------------------------------- recuperar contraseña

/** Desde la pantalla de inicio de sesión: manda el correo para elegir una contraseña nueva. */
export async function recuperarDesdeLogin() {
  const email = $('login-email').value.trim();
  const info = $('login-info');
  const error = $('login-error');
  error.classList.add('hidden');
  info.classList.add('hidden');
  if (!email) {
    error.textContent = 'Escribe tu correo arriba y toca otra vez "¿Olvidaste tu contraseña?".';
    return error.classList.remove('hidden');
  }
  try {
    await enviarRecuperacion(email);
    info.textContent = `Listo. Si ${email} es una cuenta de esta app, recibirá un correo con el enlace para elegir una contraseña nueva. Revisa también la carpeta de spam.`;
    info.classList.remove('hidden');
  } catch (e) {
    error.textContent = mensajeErrorAuth(e);
    error.classList.remove('hidden');
  }
}

// ----------------------------------------------------------------- ventana "Mi cuenta"

const TEXTO_AVISOS = {
  activo: '🔔 Avisos activados (toca para pausarlos)',
  pausado: '🔕 Avisos en pausa (toca para activarlos)',
  'sin-permiso': '🔔 Activar avisos en este teléfono',
  bloqueado: '🚫 Avisos bloqueados en Chrome (cámbialo en Ajustes del sitio)',
  'no-soportado': 'Este navegador no permite avisos',
};

export function renderCuenta() {
  if (!estado.user) return;
  $('cuenta-correo').textContent = estado.user.email;
  $('cuenta-rol').textContent = estado.esDueno ? '👑 Dueño' : 'Cuenta de cajas';
  $('btn-avisos').textContent = TEXTO_AVISOS[estadoAvisos()];
  $('btn-avisos').classList.toggle('hidden', !estado.esDueno && estadoAvisos() !== 'activo');
  $('cuenta-instalar').classList.toggle('hidden', !promptInstalacion);
}

function abrirCuenta() {
  ['cuenta-actual', 'cuenta-nueva', 'cuenta-repetir'].forEach((id) => ($(id).value = ''));
  $('cuenta-error').classList.add('hidden');
  renderCuenta();
  abrirModal('modal-cuenta');
}

async function guardarPassword() {
  const actual = $('cuenta-actual').value;
  const nueva = $('cuenta-nueva').value;
  const repetir = $('cuenta-repetir').value;
  const error = (t) => {
    $('cuenta-error').textContent = t;
    $('cuenta-error').classList.remove('hidden');
  };
  if (!actual) return error('Escribe tu contraseña actual.');
  if (nueva.length < 8) return error('La contraseña nueva debe tener al menos 8 caracteres.');
  if (nueva !== repetir) return error('La contraseña nueva y su repetición no coinciden.');
  if (nueva === actual) return error('La contraseña nueva debe ser distinta de la actual.');
  $('btn-guardar-password').disabled = true;
  try {
    await cambiarPassword(actual, nueva);
    cerrarModal('modal-cuenta');
    toast('✅ Contraseña cambiada');
  } catch (e) {
    error(mensajeErrorAuth(e));
  } finally {
    $('btn-guardar-password').disabled = false;
  }
}

async function enviarCorreoRecuperacion() {
  try {
    await enviarRecuperacion(estado.user.email);
    toast(`Te enviamos un correo a ${estado.user.email}`);
  } catch (e) {
    toast(mensajeErrorAuth(e), 'error');
  }
}

async function alternarAvisosUI() {
  const r = await alternarAvisos();
  renderCuenta();
  if (r === 'activo') toast('🔔 Avisos activados');
  else if (r === 'pausado') toast('🔕 Avisos en pausa', 'info');
  else if (r === 'bloqueado') {
    avisar('Chrome tiene bloqueados los avisos de este sitio. Toca el candado junto a la dirección → Permisos → Notificaciones → Permitir.', 'Avisos bloqueados');
  } else if (r === 'no-soportado') toast('Este navegador no permite avisos', 'error');
}

/** Borra las copias guardadas de la app y la recarga, para recibir la versión nueva. */
async function buscarActualizacion() {
  toast('Buscando actualización…', 'info');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const claves = await caches.keys();
      await Promise.all(claves.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn('Actualización:', e);
  }
  setTimeout(() => location.reload(), 400);
}

export const accionesCuenta = {
  'abrir-cuenta': abrirCuenta,
  'guardar-password': guardarPassword,
  'correo-recuperacion': enviarCorreoRecuperacion,
  'alternar-avisos': alternarAvisosUI,
  'instalar-app': instalarApp,
  'buscar-actualizacion': buscarActualizacion,
  'olvide-password': recuperarDesdeLogin,
};

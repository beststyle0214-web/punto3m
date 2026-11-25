// Punto de entrada: sesión, enrutado de eventos y dibujo de la pantalla.
import { estado, reiniciarEstado } from './estado.js';
import { $ } from './utils.js';
import {
  observarSesion, iniciarSesion, cerrarSesion, esCuentaDueno, reautenticar, mensajeErrorAuth,
} from './auth.js';
import * as datos from './data.js';
import {
  abrirModal, cerrarModal, toast, avisar, pedirTexto, resolverDialogo, hayDialogoAbierto, mostrarFallo,
} from './ui.js';
import {
  renderPOS, accionesPOS, actualizarSugerencias, ocultarSugerencias, teclaBuscador,
  teclaCodigoBarras, calcularVueltoEnVivo, teclaCobro, calcularTotalArqueo,
} from './pos.js';
import {
  renderAdmin, accionesAdmin, actualizarCronometros, renderInventario, renderHistorial, importarRespaldo,
  cargarFoto, cambioFormularioProducto,
} from './admin.js';
import { accionesCuenta, guardarPromptInstalacion, appInstalada, renderCuenta } from './cuenta.js';
import { manejarEvento } from './avisos.js';
import { cerrarEscaner } from './escaner.js';

// ------------------------------------------------------------- pantalla de carga

let esperaLenta = null;

function setCarga(texto, conSalida = false) {
  $('carga-texto').textContent = texto;
  $('carga-salir').classList.toggle('hidden', !conSalida);
  abrirModal('pantalla-carga');
}

function falloEscucha(e) {
  const c = estado.cargado;
  if (c.config && c.productos && c.empleados && c.turno) return mostrarFallo(e, 'Sincronización');
  setCarga(
    e && e.code === 'permission-denied'
      ? 'Firestore rechazó la lectura. Publica las reglas (firestore.rules) y revisa que esta cuenta tenga permiso.'
      : 'No se pudieron cargar los datos. Revisa tu conexión e inténtalo de nuevo.',
    true,
  );
}

/** Si cargar tarda mucho (internet lento), explica qué pasa en vez de dejar la pantalla muda. */
function vigilarCarga() {
  clearTimeout(esperaLenta);
  esperaLenta = setTimeout(() => {
    const c = estado.cargado;
    if (c.config && c.productos && c.empleados && c.turno) return;
    setCarga(
      'La conexión está muy lenta o no hay internet. Si ya usaste la app en este teléfono, los datos guardados deberían aparecer en unos segundos; si es la primera vez, hace falta conexión (en Cuba, quizás VPN) solo para esta primera carga.',
      true,
    );
  }, 15000);
}

// ------------------------------------------------------------- dibujo

let renderPendiente = false;
let sembrando = false;

export function programarRender() {
  if (renderPendiente) return;
  renderPendiente = true;
  setTimeout(() => {
    renderPendiente = false;
    renderTodo();
  }, 0);
}

function renderCabecera() {
  $('badge-usuario').textContent = estado.user ? `${estado.user.email}${estado.esDueno ? ' 👑' : ''}` : 'Sin sesión';
  $('btn-cambiar-modo').textContent = estado.modoDueno ? '🔓 Salir del panel' : '🔒 Dueño';
  $('btn-dark-mode').textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
  $('badge-conexion').textContent = navigator.onLine ? '🟢 En línea' : '🔴 Sin conexión (se guarda en el teléfono)';
  const p = estado.pendientes;
  $('badge-pendientes').textContent = p > 0 ? `⏳ ${p} venta(s) por sincronizar` : '';
  $('badge-pendientes').classList.toggle('hidden', p <= 0);
}

function actualizarVisibilidad() {
  $('vista-pos').classList.toggle('hidden', estado.modoDueno);
  $('panel-gestion-dueno').classList.toggle('hidden', !estado.modoDueno);
}

function renderTodo() {
  renderCabecera();
  const c = estado.cargado;
  if (!(c.config && c.productos && c.empleados && c.turno)) return;
  clearTimeout(esperaLenta);

  if (!estado.configExiste || !estado.turno) {
    if (estado.esDueno) {
      if (!sembrando) {
        sembrando = true;
        setCarga('Creando la configuración inicial…');
        datos.sembrarDatosIniciales().catch((e) => {
          sembrando = false;
          mostrarFallo(e, 'Configuración inicial');
        });
      }
    } else {
      setCarga('Falta la configuración inicial: el dueño debe iniciar sesión una vez en la app.', true);
    }
    return;
  }

  cerrarModal('pantalla-carga');
  actualizarVisibilidad();
  renderPOS();
  renderCuenta();
  if (estado.modoDueno) renderAdmin();
}

// ------------------------------------------------------------- modo oscuro

function aplicarModoOscuro(activo) {
  document.documentElement.classList.toggle('dark', activo);
  renderCabecera();
}

function alternarModoOscuro() {
  const activo = !document.documentElement.classList.contains('dark');
  try {
    localStorage.setItem('modoOscuro', activo ? '1' : '0');
  } catch (e) {
    /* modo privado: no se recuerda la preferencia */
  }
  aplicarModoOscuro(activo);
}

// ------------------------------------------------------------- sesión y modo dueño

async function salir() {
  estado.modoDueno = false;
  sessionStorage.removeItem('cajeroId');
  await cerrarSesion();
}

async function accesoDueno() {
  if (estado.modoDueno) return salirModoDueno();
  if (!estado.esDueno) {
    return avisar(
      'Esta cuenta no tiene permisos de dueño. Para entrar al panel, cierra sesión e inicia con la cuenta del dueño.',
      'Solo para el dueño',
    );
  }
  const clave = await pedirTexto('Confirma tu contraseña de dueño', { tipo: 'password', si: 'Entrar' });
  if (clave === null) return;
  try {
    await reautenticar(clave);
  } catch (e) {
    return toast(mensajeErrorAuth(e), 'error');
  }
  estado.modoDueno = true;
  toast('🔓 Modo Dueño activado');
  programarRender();
}

function salirModoDueno() {
  estado.modoDueno = false;
  toast('Sesión de dueño cerrada', 'info');
  programarRender();
}

observarSesion(async (user) => {
  if (!user) {
    clearTimeout(esperaLenta);
    datos.detenerEscuchas();
    reiniciarEstado();
    sembrando = false;
    cerrarModal('pantalla-carga');
    abrirModal('pantalla-login');
    renderCabecera();
    return;
  }
  cerrarModal('pantalla-login');
  setCarga('Cargando datos…');
  vigilarCarga();
  estado.user = user;
  estado.esDueno = await esCuentaDueno(user);
  estado.cajeroId = sessionStorage.getItem('cajeroId');
  datos.iniciarEscuchas(programarRender, falloEscucha);
  renderCabecera();
});

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const boton = $('btn-login');
  const error = $('login-error');
  error.classList.add('hidden');
  $('login-info').classList.add('hidden');
  boton.disabled = true;
  boton.textContent = 'Entrando…';
  try {
    await iniciarSesion($('login-email').value.trim(), $('login-password').value);
    $('login-password').value = '';
  } catch (err) {
    error.textContent = mensajeErrorAuth(err);
    error.classList.remove('hidden');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

// ------------------------------------------------------------- eventos

const acciones = {
  ...accionesPOS,
  ...accionesAdmin,
  ...accionesCuenta,
  'cerrar-modal': (d) => cerrarModal(d.modal),
  'cerrar-escaner': cerrarEscaner,
  imprimir: () => window.print(),
  'modo-oscuro': alternarModoOscuro,
  'cerrar-sesion': salir,
  'acceso-dueno': accesoDueno,
  'cerrar-modo-dueno': salirModoDueno,
  'dialogo-ok': () => resolverDialogo(true),
  'dialogo-cancelar': () => resolverDialogo(false),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) {
    const fn = acciones[el.dataset.action];
    if (fn) fn(el.dataset, el, e);
  }
  if (!e.target.closest('#input-buscador-predictivo, #lista-sugerencias')) ocultarSugerencias();
});

document.addEventListener('input', (e) => {
  if (e.target.dataset && e.target.dataset.input === 'arqueo') calcularTotalArqueo();
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'nuevo-categoria' || e.target.id === 'nuevo-subcategoria') cambioFormularioProducto(e);
  if (e.target.id === 'input-foto-camara' || e.target.id === 'input-foto-galeria') cargarFoto(e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && hayDialogoAbierto()) resolverDialogo(false);
});

$('dialogo-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    resolverDialogo(true);
  }
});

$('input-buscador-predictivo').addEventListener('input', actualizarSugerencias);
$('input-buscador-predictivo').addEventListener('keydown', teclaBuscador);
$('input-codigo-barras').addEventListener('keydown', teclaCodigoBarras);
$('input-efectivo-recibido').addEventListener('input', calcularVueltoEnVivo);
$('input-efectivo-recibido').addEventListener('keydown', teclaCobro);
$('input-buscador-inventario').addEventListener('input', renderInventario);
$('filtro-historial-cajero').addEventListener('change', renderHistorial);
$('input-importar').addEventListener('change', importarRespaldo);

window.addEventListener('online', renderCabecera);
window.addEventListener('offline', renderCabecera);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  guardarPromptInstalacion(e);
});
window.addEventListener('appinstalled', appInstalada);
setInterval(actualizarCronometros, 1000);

// Avisos del teléfono (ventas, stock, productos nuevos) para la cuenta del dueño.
datos.alEvento(manejarEvento);

// ------------------------------------------------------------- arranque

try {
  const guardado = localStorage.getItem('modoOscuro');
  aplicarModoOscuro(guardado === null ? window.matchMedia('(prefers-color-scheme: dark)').matches : guardado === '1');
} catch (e) {
  aplicarModoOscuro(false);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

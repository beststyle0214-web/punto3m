// Punto de entrada: sesión, enrutado de eventos y dibujo de la pantalla.
import { estado, reiniciarEstado } from './estado.js';
import { $ } from './utils.js';
import {
  observarSesion, iniciarSesion, cerrarSesion, esCuentaDueno, reautenticar, mensajeErrorAuth,
  registrarCajero, esperarRegistro,
} from './auth.js';
import * as datos from './data.js';
import {
  abrirModal, cerrarModal, toast, avisar, pedirTexto, resolverDialogo, hayDialogoAbierto, mostrarFallo,
} from './ui.js';
import { hashPin, nuevaSal, pinValido, verificarPin } from './seguridad.js';
import {
  renderPOS, accionesPOS, actualizarSugerencias, ocultarSugerencias, teclaBuscador,
  teclaCodigoBarras, calcularVueltoEnVivo, teclaCobro, calcularTotalArqueo,
} from './pos.js';
import {
  renderAdmin, renderMercancia, etiquetarTablas, accionesAdmin, actualizarCronometros, renderInventario, renderHistorial, importarRespaldo,
  cargarFoto, cambioFormularioProducto,
} from './admin.js';
import { accionesCuenta, guardarPromptInstalacion, appInstalada, renderCuenta } from './cuenta.js';
import { manejarEvento } from './avisos.js';
import { cerrarEscaner } from './escaner.js';

// ------------------------------------------------------------- pantalla de carga

let esperaLenta = null;
let accionCarga = null; // función del botón grande de la pantalla de carga (si lo hay)

/** Pantalla completa de estado. accion = { texto, fn } añade un botón grande. */
function setCarga(texto, conSalida = false, accion = null) {
  $('carga-texto').textContent = texto;
  $('carga-salir').classList.toggle('hidden', !conSalida);
  accionCarga = accion ? accion.fn : null;
  $('carga-accion').textContent = accion ? accion.texto : '';
  $('carga-accion').classList.toggle('hidden', !accion);
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
      'La conexión está muy lenta o no hay internet. Si ya usaste la app en este teléfono, los datos guardados deberían aparecer en unos segundos; si es la primera vez, hace falta conexión solo para esta primera carga.',
      true,
    );
  }, 15000);
}

// ------------------------------------------------------------- dibujo

let renderPendiente = false;
let sembrando = false;
let creandoPerfilDueno = false;
let desbloqueando = false;
let pinAutoLanzado = false;
let arrancado = false; // ya se están escuchando los datos del negocio

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
  $('txt-modo-dueno').textContent = estado.modoDueno ? '🔓 Salir del panel del dueño' : '🔒 Panel del dueño';
  $('btn-cambiar-modo').classList.toggle('hidden', !!estado.user && !estado.esDueno);
  $('menu-usuario').textContent = estado.user ? estado.user.email : '';
  const textoTema = `🌓 Tema: ${NOMBRE_TEMA[temaGuardado()]} (toca para cambiar)`;
  document.querySelectorAll('[data-action="modo-oscuro"]').forEach((b) => (b.textContent = textoTema));
  const solicitudes = estado.esDueno ? estado.empleados.filter((e) => e.pendiente).length : 0;
  for (const [id, texto] of [['punto-menu', solicitudes], ['badge-solicitudes', `${solicitudes} nueva(s)`], ['badge-tab-personal', solicitudes]]) {
    $(id).textContent = texto;
    $(id).classList.toggle('hidden', !solicitudes);
  }
  $('badge-conexion').textContent = navigator.onLine ? '🟢 En línea' : '🔴 Sin conexión (se guarda en el teléfono)';
  const p = estado.pendientes;
  $('badge-pendientes').textContent = p > 0 ? `⏳ ${p} venta(s) por sincronizar` : '';
  $('badge-pendientes').classList.toggle('hidden', p <= 0);
}

function actualizarVisibilidad() {
  $('vista-pos').classList.toggle('hidden', estado.modoDueno);
  $('panel-gestion-dueno').classList.toggle('hidden', !estado.modoDueno);
  $('nav-dueno').classList.toggle('hidden', !estado.modoDueno);
  const tabs = ['resumen', 'productos', 'personal', 'caja', 'ajustes'];
  if (!tabs.includes(estado.tabDueno)) estado.tabDueno = 'resumen';
  document.querySelectorAll('[data-pestana]').forEach((el) => el.classList.toggle('hidden', el.dataset.pestana !== estado.tabDueno));
  document.querySelectorAll('#nav-dueno .pestana').forEach((b) => b.classList.toggle('activa', b.dataset.tab === estado.tabDueno));
  $('titulo-pestana-dueno').textContent = TITULO_PESTANA[estado.tabDueno];
}

const TITULO_PESTANA = {
  resumen: '📊 Resumen',
  productos: '📦 Productos',
  personal: '👥 Personal',
  caja: '💰 Caja y cierre',
  ajustes: '⚙️ Ajustes',
};

function abrirMenu() {
  renderCabecera();
  $('menu-principal').classList.remove('hidden');
}
function cerrarMenu() {
  $('menu-principal').classList.add('hidden');
}

function irPestana(tab) {
  estado.tabDueno = tab;
  actualizarVisibilidad();
  window.scrollTo({ top: 0 });
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

  // El dueño también puede vender: se le crea su perfil de cajero la primera vez.
  if (estado.esDueno && !estado.empleados.some((e) => e.id === estado.user.uid) && !creandoPerfilDueno) {
    creandoPerfilDueno = true;
    datos.crearPerfilDueno(estado.user.uid, estado.user.email).catch((e) => {
      creandoPerfilDueno = false;
      mostrarFallo(e, 'Perfil del dueño');
    });
  }

  // Un cajero debe poner su PIN personal antes de ver la caja.
  if (!estado.esDueno && estado.cajeroId !== estado.user.uid) {
    setCarga('🔒 Introduce tu PIN personal para abrir tu caja.', true, { texto: 'Introducir mi PIN', fn: desbloquear });
    if (!desbloqueando && !pinAutoLanzado) {
      pinAutoLanzado = true;
      desbloquear();
    }
    return;
  }

  cerrarModal('pantalla-carga');
  actualizarVisibilidad();
  renderPOS();
  renderCuenta();
  if (estado.modoDueno) renderAdmin();
}

// ------------------------------------------------------------- tema (automático / claro / oscuro)

const NOMBRE_TEMA = { auto: 'Automático', claro: 'Claro', oscuro: 'Oscuro' };

function temaGuardado() {
  try {
    const t = localStorage.getItem('tema');
    if (t === 'auto' || t === 'claro' || t === 'oscuro') return t;
    const viejo = localStorage.getItem('modoOscuro');
    return viejo === '1' ? 'oscuro' : viejo === '0' ? 'claro' : 'auto';
  } catch (e) {
    return 'auto';
  }
}

function aplicarTema() {
  const t = temaGuardado();
  const oscuro = t === 'oscuro' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', oscuro);
  renderCabecera();
}

function alternarModoOscuro() {
  const orden = ['auto', 'claro', 'oscuro'];
  const siguiente = orden[(orden.indexOf(temaGuardado()) + 1) % orden.length];
  try {
    localStorage.setItem('tema', siguiente);
  } catch (e) {
    /* modo privado: no se recuerda la preferencia */
  }
  aplicarTema();
  toast(`Tema: ${NOMBRE_TEMA[siguiente]}`, 'info');
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

// ------------------------------------------------------------- PIN personal del cajero

let fallosPin = 0;
let sinIntentosHasta = 0;

/** Pide el PIN del cajero (o le hace crear uno la primera vez / tras un reinicio). */
async function desbloquear() {
  if (desbloqueando || !estado.user || estado.esDueno) return;
  desbloqueando = true;
  try {
    const uid = estado.user.uid;
    const espera = Math.ceil((sinIntentosHasta - Date.now()) / 1000);
    if (espera > 0) return toast(`Demasiados intentos. Espera ${espera} segundos.`, 'error');

    let guardado;
    try {
      guardado = await datos.leerPin(uid);
    } catch (e) {
      return toast('No se pudo leer tu PIN. Revisa la conexión e inténtalo de nuevo.', 'error');
    }
    const opciones = { tipo: 'password', inputmode: 'numeric', placeholder: 'PIN' };

    if (!guardado) {
      const nuevo = await pedirTexto('Crea tu PIN personal (4 a 8 números)', {
        ...opciones,
        texto: 'Solo tú lo sabrás: ni el dueño puede verlo. Lo usarás cada vez que abras tu caja.',
      });
      if (nuevo === null) return;
      if (!pinValido(nuevo)) return toast('El PIN debe tener de 4 a 8 números', 'error');
      const repetido = await pedirTexto('Repite tu PIN', opciones);
      if (repetido === null) return;
      if (repetido !== nuevo) return toast('Los dos PIN no coinciden. Inténtalo de nuevo.', 'error');
      const sal = nuevaSal();
      datos.guardarPin(uid, sal, await hashPin(nuevo, sal)).catch((e) => mostrarFallo(e, 'PIN'));
      toast('✅ PIN creado');
    } else {
      const pin = await pedirTexto(`PIN de ${estado.empleados[0] ? estado.empleados[0].nombre : 'cajero'}`, {
        ...opciones,
        texto: 'Si lo olvidaste, pídele al dueño que reinicie tu PIN y elige uno nuevo.',
      });
      if (pin === null) return;
      if (!(await verificarPin(pin, guardado.sal, guardado.pinHash))) {
        fallosPin++;
        if (fallosPin >= 5) {
          sinIntentosHasta = Date.now() + 30000;
          fallosPin = 0;
        }
        return toast('PIN incorrecto', 'error');
      }
    }
    fallosPin = 0;
    estado.cajeroId = uid;
    try {
      sessionStorage.setItem('cajeroId', uid);
    } catch (e) {
      /* sin almacenamiento de sesión */
    }
    programarRender();
  } finally {
    desbloqueando = false;
  }
}

// ------------------------------------------------------------- perfil del cajero (aprobación)

async function enviarSolicitud() {
  const nombre = await pedirTexto('¿Cómo te llamas?', { placeholder: 'Tu nombre', si: 'Enviar solicitud' });
  if (nombre === null) return;
  if (!nombre.trim()) return toast('Escribe tu nombre', 'error');
  datos.crearPerfilCajero(estado.user.uid, nombre.trim().slice(0, 40), estado.user.email).catch((e) => mostrarFallo(e, 'Solicitud'));
  toast('Solicitud enviada. El dueño debe aprobarla.');
}

function arrancarDatos() {
  if (arrancado) return;
  arrancado = true;
  setCarga('Cargando datos…');
  vigilarCarga();
  datos.iniciarEscuchas(programarRender, falloEscucha);
}

function pararDatos() {
  if (!arrancado) return;
  arrancado = false;
  datos.detenerDatos();
  reiniciarCarga();
}

function reiniciarCarga() {
  estado.cargado = { config: false, productos: false, empleados: false, turno: false };
}

/** El perfil del cajero cambió en la nube (se creó, lo aprobaron o lo quitaron). */
function perfilCambio(perfil) {
  clearTimeout(esperaLenta);
  if (!perfil) {
    pararDatos();
    return setCarga('Tu cuenta todavía no está registrada como cajero en este negocio.', true, {
      texto: 'Enviar solicitud al dueño',
      fn: enviarSolicitud,
    });
  }
  if (!perfil.aprobado && perfil.enviando) {
    pararDatos();
    return setCarga(
      '📤 Enviando tu solicitud al dueño… Necesita internet. No cierres la app hasta que cambie este mensaje.',
      true,
      { texto: '🔄 Comprobar ahora', fn: comprobarAhora },
    );
  }
  if (!perfil.aprobado) {
    pararDatos();
    return setCarga(
      `⏳ ${perfil.nombre}, tu cuenta está esperando la aprobación del dueño. Cuando la apruebe, esta pantalla se abrirá sola.`,
      true,
      { texto: '🔄 Comprobar ahora', fn: comprobarAhora },
    );
  }
  arrancarDatos();
}

/** Pregunta al servidor si ya te aprobaron; si no hay conexión, dice cuál es el problema. */
async function comprobarAhora() {
  if (!estado.user) return;
  setCarga('Preguntando al servidor…', true);
  try {
    const perfil = await datos.perfilDelServidor(estado.user.uid);
    if (!perfil) return setCarga('El servidor no tiene tu solicitud. Toca "Cerrar sesión" y crea la cuenta otra vez.', true);
    if (!perfil.aprobado) {
      return setCarga(`⏳ El servidor responde: todavía no te aprobaron (conexión OK). Pídele al dueño que te apruebe.`, true, {
        texto: '🔄 Comprobar ahora',
        fn: comprobarAhora,
      });
    }
    perfilCambio(perfil);
  } catch (e) {
    const causa = e && e.code === 'permission-denied' ? 'las reglas de Firebase rechazaron la lectura' : 'no hay conexión con el servidor';
    setCarga(`❌ No se pudo comprobar: ${causa}${e && e.code ? ` (${e.code})` : ''}. Revisa tu internet y vuelve a intentar.`, true, {
      texto: '🔄 Comprobar ahora',
      fn: comprobarAhora,
    });
  }
}

function falloPerfil(e) {
  clearTimeout(esperaLenta);
  setCarga(
    e && e.code === 'permission-denied'
      ? 'Firestore rechazó la lectura. Revisa que las reglas (firestore.rules) estén publicadas.'
      : 'No se pudo cargar tu cuenta. Revisa tu conexión e inténtalo de nuevo.',
    true,
  );
}

observarSesion(async (user) => {
  if (!user) {
    clearTimeout(esperaLenta);
    datos.detenerEscuchas();
    reiniciarEstado();
    sembrando = false;
    arrancado = false;
    creandoPerfilDueno = false;
    desbloqueando = false;
    pinAutoLanzado = false;
    accionCarga = null;
    cerrarModal('pantalla-carga');
    cerrarModal('pantalla-registro');
    abrirModal('pantalla-login');
    renderCabecera();
    return;
  }
  cerrarModal('pantalla-login');
  cerrarModal('pantalla-registro');
  setCarga('Cargando datos…');
  vigilarCarga();
  estado.user = user;
  await esperarRegistro(); // si la cuenta se acaba de crear, espera a que se guarde su perfil
  estado.esDueno = await esCuentaDueno(user);
  pinAutoLanzado = false;

  if (estado.esDueno) {
    estado.cajeroId = user.uid; // el dueño vende con su propia sesión (ya inició con contraseña)
    arrancarDatos();
  } else {
    let guardado = null;
    try {
      guardado = sessionStorage.getItem('cajeroId');
    } catch (e) {
      /* sin almacenamiento de sesión */
    }
    estado.cajeroId = guardado === user.uid ? user.uid : null;
    datos.escucharPerfil(user.uid, perfilCambio, falloPerfil);
  }
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

$('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('registro-error');
  const boton = $('btn-registro');
  const falla = (t) => {
    error.textContent = t;
    error.classList.remove('hidden');
  };
  error.classList.add('hidden');
  const nombre = $('registro-nombre').value.trim();
  const email = $('registro-email').value.trim();
  const clave = $('registro-password').value;
  if (nombre.length < 2) return falla('Escribe tu nombre.');
  if (clave.length < 8) return falla('La contraseña debe tener al menos 8 caracteres.');
  if (clave !== $('registro-repetir').value) return falla('Las dos contraseñas no coinciden.');
  boton.disabled = true;
  boton.textContent = 'Creando tu cuenta…';
  try {
    await registrarCajero(nombre.slice(0, 40), email, clave);
    ['registro-password', 'registro-repetir'].forEach((id) => ($(id).value = ''));
  } catch (err) {
    falla(mensajeErrorAuth(err));
  } finally {
    boton.disabled = false;
    boton.textContent = 'Crear mi cuenta';
  }
});

// ------------------------------------------------------------- eventos

const acciones = {
  ...accionesPOS,
  ...accionesAdmin,
  ...accionesCuenta,
  'cerrar-modal': (d) => cerrarModal(d.modal),
  'cerrar-escaner': cerrarEscaner,
  'abrir-registro': () => {
    $('registro-error').classList.add('hidden');
    abrirModal('pantalla-registro');
  },
  'cerrar-registro': () => cerrarModal('pantalla-registro'),
  'carga-accion': () => accionCarga && accionCarga(),
  imprimir: () => window.print(),
  'modo-oscuro': alternarModoOscuro,
  'abrir-menu': abrirMenu,
  'cerrar-menu': cerrarMenu,
  'tab-dueno': (d) => irPestana(d.tab),
  'cerrar-sesion': salir,
  'acceso-dueno': accesoDueno,
  'cerrar-modo-dueno': salirModoDueno,
  'dialogo-ok': () => resolverDialogo(true),
  'dialogo-cancelar': () => resolverDialogo(false),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) {
    if (el.closest('#menu-principal') && el.dataset.action !== 'modo-oscuro') cerrarMenu();
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
$('buscar-mercancia').addEventListener('input', () => { renderMercancia(); etiquetarTablas(); });
$('orden-mercancia').addEventListener('change', () => { renderMercancia(); etiquetarTablas(); });
$('filtro-historial-cajero').addEventListener('change', renderHistorial);
$('input-importar').addEventListener('change', importarRespaldo);

// Desde "Mi caja": el cajero bloquea su caja y se le vuelve a pedir el PIN.
window.addEventListener('p3m:bloquear', () => {
  pinAutoLanzado = false;
  desbloqueando = false;
  programarRender();
});

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

aplicarTema();
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => temaGuardado() === 'auto' && aplicarTema());
} catch (e) {
  /* navegador sin este aviso: el tema automático se aplica al abrir la app */
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

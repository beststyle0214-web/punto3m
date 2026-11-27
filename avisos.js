// Avisos para el dueño: ventas nuevas (con el dinero que va entrando), producto que se agota,
// producto agotado, stock agregado y producto nuevo.
//
// IMPORTANTE (límite real de las páginas web): estos avisos llegan mientras la app esté abierta
// o en segundo plano en el teléfono. Con la app totalmente cerrada, un aviso necesita un servidor
// de pago de Google (Cloud Functions + FCM). Para eso la app también puede preparar un SMS.
import { estado } from './estado.js';
import { fmtMinor, fmtUSD } from './money.js';
import { resumenTurno } from './calculos.js';
import { toast } from './ui.js';

const CLAVE = 'avisosActivados';

export const avisosSoportados = () => 'Notification' in window;
export const permisoAvisos = () => (avisosSoportados() ? Notification.permission : 'unsupported');

function preferencia() {
  try {
    return localStorage.getItem(CLAVE) !== '0'; // por defecto, activados
  } catch (e) {
    return true;
  }
}

function guardarPreferencia(activo) {
  try {
    localStorage.setItem(CLAVE, activo ? '1' : '0');
  } catch (e) {
    /* sin almacenamiento local */
  }
}

/** Estado para mostrarlo en pantalla. */
export function estadoAvisos() {
  if (!avisosSoportados()) return 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueado';
  if (Notification.permission === 'granted') return preferencia() ? 'activo' : 'pausado';
  return 'sin-permiso';
}

/** Pide permiso (hay que llamarlo desde un toque del usuario) o activa/pausa los avisos. */
export async function alternarAvisos() {
  const e = estadoAvisos();
  if (e === 'no-soportado') return 'no-soportado';
  if (e === 'bloqueado') return 'bloqueado';
  if (e === 'activo') {
    guardarPreferencia(false);
    return 'pausado';
  }
  if (e === 'pausado') {
    guardarPreferencia(true);
    return 'activo';
  }
  const r = await Notification.requestPermission();
  if (r === 'granted') {
    guardarPreferencia(true);
    return 'activo';
  }
  return r === 'denied' ? 'bloqueado' : 'sin-permiso';
}

async function mostrarSistema(titulo, cuerpo, tag) {
  if (estadoAvisos() !== 'activo') return;
  const opciones = { body: cuerpo, icon: 'icon-192.png', badge: 'icon-192.png', tag, renotify: true, vibrate: [120, 60, 120] };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) return await reg.showNotification(titulo, opciones);
    new Notification(titulo, opciones); // eslint-disable-line no-new
  } catch (e) {
    console.warn('No se pudo mostrar el aviso:', e);
  }
}

function avisar(titulo, cuerpo, tag, tipo = 'info') {
  toast(`${titulo} ${cuerpo}`.trim(), tipo);
  mostrarSistema(titulo, cuerpo, tag);
}

const textoCaja = () => {
  const r = resumenTurno({ ventas: estado.ventas, mermas: estado.mermas, categorias: [], tasaUSD: estado.tasaUSD });
  const partes = [];
  if (r.caja.CUP) partes.push(`${r.caja.CUP} CUP`);
  if (r.caja.USD) partes.push(`${fmtMinor(r.caja.USD, 'USD')}`);
  if (r.caja.MLC) partes.push(`${fmtMinor(r.caja.MLC, 'MLC')}`);
  const tr = [r.transf.CUP && `${r.transf.CUP} CUP`, r.transf.USD && fmtMinor(r.transf.USD, 'USD'), r.transf.MLC && fmtMinor(r.transf.MLC, 'MLC')].filter(Boolean);
  return `Caja del turno: ${partes.join(' + ') || '0'}${tr.length ? ` · transferencias: ${tr.join(' + ')}` : ''} · ${r.tickets} ventas`;
};

/** Recibe los eventos de data.js. Solo la cuenta del dueño recibe avisos. */
export function manejarEvento(ev) {
  if (!estado.esDueno) return;

  if (ev.tipo === 'ventas') {
    if (ev.ventas.length === 1) {
      const v = ev.ventas[0];
      const detalle = v.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(', ');
      avisar(`💰 Venta: ${fmtMinor(v.cobrado, v.moneda)}${v.transferencia ? ` (🏦 ${fmtMinor(v.transferencia, v.moneda)} por transferencia)` : ''}`, `${v.cajero || ''} — ${detalle}. ${textoCaja()}`, 'venta', 'ok');
    } else {
      const usd = ev.ventas.reduce((s, v) => s + v.totalUSD, 0);
      avisar(`💰 ${ev.ventas.length} ventas nuevas`, `Suman ${fmtUSD(usd)} USD. ${textoCaja()}`, 'venta', 'ok');
    }
    return;
  }

  if (ev.tipo === 'stock') {
    const { producto: p, antes, ahora } = ev;
    const nombre = p.variante ? `${p.nombre} · ${p.variante}` : p.nombre;
    if (ahora > antes) {
      avisar('📦 Stock agregado', `${nombre}: +${ahora - antes} (ahora ${ahora})`, `stock-${p.id}`, 'info');
    } else if (ahora <= 0 && antes > 0) {
      avisar('🚫 Producto AGOTADO', nombre, `stock-${p.id}`, 'error');
    } else if (ahora < estado.umbralStock && antes >= estado.umbralStock) {
      avisar('⚠️ Se está agotando', `${nombre}: quedan ${ahora}`, `stock-${p.id}`, 'error');
    }
    return;
  }

  if (ev.tipo === 'solicitud') {
    const e = ev.empleado;
    avisar('🆕 Solicitud de cajero', `${e.nombre} (${e.email}) pide entrar. Apruébalo en Personal.`, `solicitud-${e.id}`, 'info');
    return;
  }

  if (ev.tipo === 'producto-nuevo') {
    const p = ev.producto;
    avisar('🆕 Producto nuevo', `${p.nombre}${p.variante ? ' · ' + p.variante : ''} (${p.stock} un.)`, `nuevo-${p.id}`, 'info');
  }
}

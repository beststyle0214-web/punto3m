// Piezas de interfaz reutilizables: modales, avisos (toasts) y diálogos que reemplazan
// a alert() / confirm() / prompt() del navegador.
import { $ } from './utils.js';

export function abrirModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.remove('hidden');
  m.classList.add('flex');
}

export function cerrarModal(id) {
  const m = $(id);
  if (!m) return;
  m.classList.add('hidden');
  m.classList.remove('flex');
}

// ------------------------------------------------------------------ toasts

export function toast(mensaje, tipo = 'ok') {
  const colores = {
    ok: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-slate-700',
  };
  const el = document.createElement('div');
  el.className = `${colores[tipo] || colores.info} text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg`;
  el.textContent = mensaje;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3000);
}

/** Muestra un error de Firestore de forma entendible. */
export function mostrarFallo(e, contexto = '') {
  console.error(contexto, e);
  const permiso = e && e.code === 'permission-denied';
  const base = permiso ? 'No tienes permiso para hacer esto.' : 'Ocurrió un error.';
  toast(`${contexto ? contexto + ': ' : ''}${base}`, 'error');
}

// ---------------------------------------------------------------- diálogos

let dialogo = null; // { resolver, conInput }

function abrirDialogo({ titulo, texto, input, si, no, peligro }) {
  return new Promise((resolver) => {
    if (dialogo) resolverDialogo(false); // si había otro abierto, se cancela

    dialogo = { resolver, conInput: !!input };
    $('dialogo-titulo').textContent = titulo || '';
    $('dialogo-texto').textContent = texto || '';
    $('dialogo-texto').classList.toggle('hidden', !texto);

    const inp = $('dialogo-input');
    if (input) {
      inp.classList.remove('hidden');
      inp.type = input.tipo || 'text';
      inp.value = input.valor || '';
      inp.placeholder = input.placeholder || '';
      inp.setAttribute('inputmode', input.inputmode || 'text');
    } else {
      inp.classList.add('hidden');
    }

    const ok = $('dialogo-ok');
    ok.textContent = si || 'Aceptar';
    ok.className = `w-1/2 py-2 rounded-lg text-sm font-bold text-white ${peligro ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`;

    const cancelar = $('dialogo-cancelar');
    cancelar.textContent = no || 'Cancelar';
    cancelar.classList.toggle('hidden', no === false);
    ok.classList.toggle('w-full', no === false);
    ok.classList.toggle('w-1/2', no !== false);

    abrirModal('modal-dialogo');
    setTimeout(() => (input ? inp : ok).focus(), 30);
  });
}

/** Cierra el diálogo abierto. Con aceptar=false devuelve false / null. */
export function resolverDialogo(aceptar) {
  if (!dialogo) return;
  const d = dialogo;
  dialogo = null;
  cerrarModal('modal-dialogo');
  if (d.conInput) d.resolver(aceptar ? $('dialogo-input').value : null);
  else d.resolver(!!aceptar);
}

export const hayDialogoAbierto = () => dialogo !== null;

/** ¿Seguro? -> Promise<boolean> */
export const confirmar = (texto, o = {}) =>
  abrirDialogo({ titulo: o.titulo || 'Confirmar', texto, si: o.si, no: o.no, peligro: o.peligro });

/** Solo informa (un botón). */
export const avisar = (texto, titulo = 'Aviso') =>
  abrirDialogo({ titulo, texto, si: 'Entendido', no: false });

/** Pide un dato -> Promise<string | null> (null si cancela). */
export const pedirTexto = (titulo, o = {}) =>
  abrirDialogo({
    titulo,
    texto: o.texto,
    si: o.si,
    input: { tipo: o.tipo, valor: o.valor, placeholder: o.placeholder, inputmode: o.inputmode },
  });

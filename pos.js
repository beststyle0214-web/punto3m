// Pantalla de ventas (POS): productos, carrito, cobro, ticket, cajero y arqueo.
import { estado, cajeroActual } from './estado.js';
import { $, esc, normalizar, formatoFechaHora } from './utils.js';
import {
  aMinor, fmtMinor, fmtUSD, precioUnitCUP, precioUnitUSD, precioPrincipal, precioSecundario,
  totalesCarrito, montoACobrar,
} from './money.js';
import { resumenTurno, diferenciaArqueo } from './calculos.js';
import { verificarPin } from './seguridad.js';
import { DENOMINACIONES_CUP } from './config.js';
import { abrirModal, cerrarModal, toast, pedirTexto, mostrarFallo } from './ui.js';
import * as datos from './data.js';

const tasas = () => ({ usd: estado.tasaUSD, mlc: estado.tasaMLC });
const enCarrito = (id) => (estado.carrito.find((c) => c.id === id) || { cantidad: 0 }).cantidad;

let cobro = null; // { moneda, monto } mientras el modal de cobro está abierto
let ultimoTicket = null;

// ------------------------------------------------------------- carrito

/** Quita del carrito lo que ya no existe o supera el stock (por cambios desde otra caja). */
function sanearCarrito() {
  estado.carrito = estado.carrito
    .map((c) => {
      const p = estado.productos.find((x) => x.id === c.id);
      return p ? { id: c.id, cantidad: Math.min(c.cantidad, Math.max(p.stock, 0)) } : null;
    })
    .filter((c) => c && c.cantidad > 0);
}

export function lineasCarrito() {
  return estado.carrito
    .map((c) => ({ producto: estado.productos.find((p) => p.id === c.id), cantidad: c.cantidad }))
    .filter((l) => l.producto);
}

export function agregarAlCarrito(id) {
  const p = estado.productos.find((x) => x.id === id);
  if (!p) return;
  if (p.stock - enCarrito(id) <= 0) {
    toast(`${p.nombre}: agotado`, 'error');
    return;
  }
  const linea = estado.carrito.find((c) => c.id === id);
  if (linea) linea.cantidad++;
  else estado.carrito.push({ id, cantidad: 1 });
  renderCarrito();
  renderGrid();
}

function cambiarCantidad(id, delta) {
  const linea = estado.carrito.find((c) => c.id === id);
  const p = estado.productos.find((x) => x.id === id);
  if (!linea || !p) return;
  if (delta > 0) {
    if (p.stock - linea.cantidad <= 0) return toast('No hay más stock de este producto', 'error');
    linea.cantidad++;
  } else {
    linea.cantidad--;
    if (linea.cantidad <= 0) estado.carrito = estado.carrito.filter((c) => c.id !== id);
  }
  renderCarrito();
  renderGrid();
}

function vaciarCarrito() {
  estado.carrito = [];
  renderCarrito();
  renderGrid();
}

// ------------------------------------------------------------- render

export function renderCategorias() {
  const botones = [['*', 'Todos'], ...estado.categorias.map((c) => [c, c])];
  $('botones-categorias').innerHTML = botones
    .map(([valor, texto]) => {
      const activo = valor === estado.categoriaFiltro;
      return `<button type="button" data-action="filtrar-categoria" data-cat="${esc(valor)}"
        class="px-3 py-1.5 rounded text-xs ${activo ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700'}">${esc(texto)}</button>`;
    })
    .join('');
}

export function renderGrid() {
  const lista =
    estado.categoriaFiltro === '*'
      ? estado.productos
      : estado.productos.filter((p) => p.categoria === estado.categoriaFiltro);

  if (!lista.length) {
    $('product-grid').innerHTML = `<p class="col-span-full text-sm text-slate-400 italic">${
      estado.productos.length ? 'No hay productos en esta categoría.' : 'Aún no hay productos. El dueño puede añadirlos desde el panel de administración.'
    }</p>`;
    return;
  }

  $('product-grid').innerHTML = lista
    .map((p) => {
      const disp = p.stock - enCarrito(p.id);
      const agotado = disp <= 0;
      return `<button type="button" data-action="agregar-producto" data-id="${esc(p.id)}"
        class="text-left border dark:border-slate-700 p-3 rounded-xl bg-white dark:bg-slate-800 transition ${agotado ? 'opacity-50 cursor-not-allowed' : 'hover:border-indigo-500 cursor-pointer'}">
        <div class="font-bold text-sm">${esc(p.nombre)}</div>
        <div class="text-indigo-600 dark:text-indigo-400 font-semibold mt-1">${esc(precioPrincipal(p))}</div>
        <div class="text-xs text-emerald-600">${esc(precioSecundario(p, estado.tasaUSD))}</div>
        <div class="text-xs mt-2 ${agotado ? 'text-red-500 font-bold' : 'text-slate-400'}">${agotado ? 'AGOTADO' : 'Stock: ' + disp}</div>
      </button>`;
    })
    .join('');
}

export function renderCarrito() {
  sanearCarrito();
  const lineas = lineasCarrito();
  const t = totalesCarrito(lineas, tasas());

  $('lista-carrito').innerHTML = lineas.length
    ? lineas
        .map(({ producto: p, cantidad }) => {
          const sub = precioUnitUSD(p, estado.tasaUSD) * cantidad;
          return `<div class="py-1.5 flex justify-between items-center text-xs border-b dark:border-slate-700">
            <div><strong>${esc(p.nombre)}</strong>
              <div class="text-[10px] text-slate-500">${esc(precioPrincipal(p))} c/u</div></div>
            <div class="flex items-center space-x-1">
              <button type="button" data-action="cambiar-cantidad" data-id="${esc(p.id)}" data-delta="-1" class="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded font-bold">-</button>
              <span class="px-2 font-bold">${cantidad}</span>
              <button type="button" data-action="cambiar-cantidad" data-id="${esc(p.id)}" data-delta="1" class="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded font-bold">+</button>
              <span class="font-semibold w-14 text-right">${fmtUSD(sub)}</span>
            </div>
          </div>`;
        })
        .join('')
    : '<p class="text-slate-400 text-sm italic">Carrito vacío.</p>';

  $('total-usd').textContent = fmtUSD(t.usd);
  $('total-cup').textContent = `${t.cup} CUP`;
}

export function renderCajero() {
  const c = cajeroActual();
  const texto = c ? `Cajero: ${c.nombre}` : 'Cajero: Ninguno';
  $('badge-rol').textContent = texto;
  $('barra-estado-cajero-activo').textContent = `${c ? '🟢' : '⚪'} ${texto}`;
  $('lbl-tasa-usd').textContent = estado.tasaUSD;
  $('lbl-tasa-mlc').textContent = estado.tasaMLC;
}

export function renderPOS() {
  if (estado.cajeroId && !cajeroActual() && estado.cargado.empleados) {
    estado.cajeroId = null; // el cajero fue eliminado
    sessionStorage.removeItem('cajeroId');
  }
  renderCategorias();
  renderGrid();
  renderCarrito();
  renderCajero();
}

// ------------------------------------------------------------- búsqueda

export function actualizarSugerencias() {
  const texto = normalizar($('input-buscador-predictivo').value.trim());
  const caja = $('lista-sugerencias');
  if (!texto) {
    caja.classList.add('hidden');
    return;
  }
  const hallados = estado.productos.filter(
    (p) => normalizar(p.nombre).includes(texto) || (p.codigo && p.codigo.includes(texto)),
  );
  caja.innerHTML = hallados.length
    ? hallados
        .map(
          (p) => `<button type="button" data-action="sugerencia" data-id="${esc(p.id)}"
            class="w-full text-left p-2.5 hover:bg-indigo-50 dark:hover:bg-slate-700 flex justify-between text-xs border-b dark:border-slate-700">
            <span>${esc(p.nombre)}</span><span class="font-bold">${esc(precioPrincipal(p))} (${p.stock} un.)</span></button>`,
        )
        .join('')
    : '<div class="p-3 text-xs text-slate-400">Sin resultados.</div>';
  caja.classList.remove('hidden');
}

export function ocultarSugerencias() {
  $('lista-sugerencias').classList.add('hidden');
}

function agregarDesdeSugerencia(id) {
  agregarAlCarrito(id);
  $('input-buscador-predictivo').value = '';
  ocultarSugerencias();
}

export function teclaBuscador(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const texto = normalizar($('input-buscador-predictivo').value.trim());
  if (!texto) return;
  const primero = estado.productos.find(
    (p) => normalizar(p.nombre).includes(texto) || (p.codigo && p.codigo.includes(texto)),
  );
  if (primero) agregarDesdeSugerencia(primero.id);
}

export function teclaCodigoBarras(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const codigo = $('input-codigo-barras').value.trim();
  if (!codigo) return;
  const p = estado.productos.find((x) => x.codigo === codigo);
  if (p) agregarAlCarrito(p.id);
  else toast(`No existe un producto con el código "${codigo}"`, 'error');
  $('input-codigo-barras').value = '';
}

// ------------------------------------------------------------- cajero

export function abrirSeleccionCajero() {
  const lista = $('lista-modal-cajeros');
  lista.innerHTML = estado.empleados.length
    ? estado.empleados
        .map(
          (e) => `<button type="button" data-action="elegir-cajero" data-id="${esc(e.id)}"
            class="w-full text-left p-2 bg-slate-100 dark:bg-slate-700 rounded font-bold flex justify-between items-center ${e.id === estado.cajeroId ? 'ring-2 ring-indigo-500' : ''}">
            <span>${esc(e.nombre)}</span>
            <span class="text-[10px] font-semibold">${e.pinHash ? '🔒 PIN' : ''} ${e.activo ? '🟢 En turno' : ''}</span></button>`,
        )
        .join('')
    : '<p class="text-xs text-slate-400 italic">No hay cajeros. El dueño debe añadirlos en el panel de administración.</p>';
  $('btn-quitar-cajero').classList.toggle('hidden', !estado.cajeroId);
  abrirModal('modal-seleccion-cajero');
}

async function elegirCajero(id) {
  const e = estado.empleados.find((x) => x.id === id);
  if (!e) return;
  if (e.pinHash) {
    const pin = await pedirTexto(`PIN de ${e.nombre}`, { tipo: 'password', inputmode: 'numeric', placeholder: 'PIN' });
    if (pin === null) return;
    if (!(await verificarPin(pin, e.sal, e.pinHash))) return toast('PIN incorrecto', 'error');
  }
  estado.cajeroId = id;
  sessionStorage.setItem('cajeroId', id);
  cerrarModal('modal-seleccion-cajero');
  renderCajero();
  toast(`Cajero activo: ${e.nombre}`);
}

function quitarCajero() {
  estado.cajeroId = null;
  sessionStorage.removeItem('cajeroId');
  cerrarModal('modal-seleccion-cajero');
  renderCajero();
}

// ------------------------------------------------------------- cobro

function iniciarCobro(moneda) {
  sanearCarrito();
  if (!estado.carrito.length) return toast('El carrito está vacío', 'error');
  if (!cajeroActual()) {
    toast('Primero selecciona un cajero', 'error');
    return abrirSeleccionCajero();
  }
  const monto = montoACobrar(totalesCarrito(lineasCarrito(), tasas()), moneda);
  cobro = { moneda, monto };

  $('cobro-moneda-titulo').textContent = moneda;
  $('cobro-total-pagar').textContent = fmtMinor(monto, moneda);
  const entrada = $('input-efectivo-recibido');
  entrada.value = '';
  entrada.step = moneda === 'CUP' ? '1' : '0.01';
  $('cobro-vuelto-texto').textContent = fmtMinor(0, moneda);
  $('cobro-error').classList.add('hidden');
  abrirModal('modal-cobro');
  setTimeout(() => entrada.focus(), 30);
}

export function calcularVueltoEnVivo() {
  if (!cobro) return;
  const txt = $('input-efectivo-recibido').value.trim();
  const error = $('cobro-error');
  if (txt === '') {
    error.classList.add('hidden');
    $('cobro-vuelto-texto').textContent = fmtMinor(0, cobro.moneda);
    return;
  }
  const recibido = aMinor(txt, cobro.moneda);
  if (!Number.isFinite(recibido) || recibido < cobro.monto) {
    error.textContent = Number.isFinite(recibido)
      ? `Faltan ${fmtMinor(cobro.monto - recibido, cobro.moneda)}`
      : 'Monto no válido';
    error.classList.remove('hidden');
    $('cobro-vuelto-texto').textContent = fmtMinor(0, cobro.moneda);
    return;
  }
  error.classList.add('hidden');
  $('cobro-vuelto-texto').textContent = fmtMinor(recibido - cobro.monto, cobro.moneda);
}

export function teclaCobro(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    confirmarVenta();
  }
}

function confirmarVenta() {
  if (!cobro) return;
  const cajero = cajeroActual();
  if (!cajero) return toast('Selecciona un cajero', 'error');
  if (!estado.turno) return toast('No hay un turno abierto', 'error');

  sanearCarrito();
  const lineas = lineasCarrito();
  if (!lineas.length) {
    cerrarModal('modal-cobro');
    return toast('El carrito quedó vacío (cambió el stock)', 'error');
  }
  const faltante = lineas.find((l) => l.cantidad > l.producto.stock);
  if (faltante) return toast(`Stock insuficiente de ${faltante.producto.nombre}`, 'error');

  const t = totalesCarrito(lineas, tasas());
  const monto = montoACobrar(t, cobro.moneda);
  const txt = $('input-efectivo-recibido').value.trim();
  const recibido = txt === '' ? monto : aMinor(txt, cobro.moneda);
  if (!Number.isFinite(recibido) || recibido < monto) return calcularVueltoEnVivo(); // no deja cobrar de menos

  const venta = {
    turnoId: estado.turno.id,
    ts: Date.now(),
    cajeroId: cajero.id,
    cajero: cajero.nombre,
    moneda: cobro.moneda,
    cobrado: monto,
    recibido,
    vuelto: recibido - monto,
    totalUSD: t.usd,
    totalCUP: t.cup,
    costoCents: t.costo,
    tasaUSD: estado.tasaUSD,
    tasaMLC: estado.tasaMLC,
    items: lineas.map(({ producto: p, cantidad }) => ({
      id: p.id,
      nombre: p.nombre,
      categoria: p.categoria,
      cantidad,
      moneda: p.moneda,
      precio: p.precio,
      costoUnit: p.costoCents || 0,
      usdUnit: precioUnitUSD(p, estado.tasaUSD),
      cupUnit: precioUnitCUP(p, estado.tasaUSD),
    })),
  };

  const { id, promesa } = datos.registrarVenta(venta);
  promesa.catch((e) => mostrarFallo(e, 'La venta no se pudo guardar en la nube'));

  estado.carrito = [];
  cobro = null;
  cerrarModal('modal-cobro');
  renderCarrito();
  renderGrid();
  mostrarTicket({ id, ...venta });
}

// ------------------------------------------------------------- ticket

export function mostrarTicket(v) {
  ultimoTicket = v;
  $('ticket-cajero').textContent = `Cajero: ${v.cajero}`;
  $('ticket-fecha-hora').textContent = formatoFechaHora(v.ts);
  $('ticket-lista-items').innerHTML = v.items
    .map((i) => `<div>${i.cantidad}x ${esc(i.nombre)}</div>`)
    .join('');
  $('ticket-total').textContent = fmtMinor(v.cobrado, v.moneda);
  $('ticket-recibido').textContent = fmtMinor(v.recibido, v.moneda);
  $('ticket-vuelto').textContent = fmtMinor(v.vuelto, v.moneda);
  abrirModal('modal-ticket');
}

function verTicket(id) {
  const v = estado.ventas.find((x) => x.id === id);
  if (v) mostrarTicket(v);
}

async function copiarTicket() {
  if (!ultimoTicket) return;
  const v = ultimoTicket;
  const texto = [
    'PUNTO 3 M',
    formatoFechaHora(v.ts),
    ...v.items.map((i) => `${i.cantidad}x ${i.nombre}`),
    `Total: ${fmtMinor(v.cobrado, v.moneda)}`,
    `Vuelto: ${fmtMinor(v.vuelto, v.moneda)}`,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(texto);
    toast('Ticket copiado');
  } catch (e) {
    toast('No se pudo copiar', 'error');
  }
}

// ------------------------------------------------------------- arqueo

const resumen = () => resumenTurno({ ventas: estado.ventas, mermas: estado.mermas, categorias: estado.categorias });

export function abrirArqueo() {
  $('tabla-arqueo-denominaciones').innerHTML = DENOMINACIONES_CUP.map(
    (d) => `<tr>
      <td class="p-2 font-bold">${d} CUP</td>
      <td class="p-2 text-center"><input type="number" min="0" value="0" id="arqueo-cant-${d}" data-input="arqueo"
        class="w-16 border dark:border-slate-700 rounded p-1 text-center text-xs dark:bg-slate-900"></td>
      <td class="p-2 text-right font-bold" id="arqueo-sub-${d}">0 CUP</td>
    </tr>`,
  ).join('');
  $('arqueo-esperado').textContent = `${resumen().caja.CUP} CUP`;
  calcularTotalArqueo();
  abrirModal('modal-arqueo');
}

export function calcularTotalArqueo() {
  let total = 0;
  DENOMINACIONES_CUP.forEach((d) => {
    const cant = Math.max(0, parseInt($(`arqueo-cant-${d}`).value, 10) || 0);
    total += cant * d;
    $(`arqueo-sub-${d}`).textContent = `${cant * d} CUP`;
  });
  const esperado = resumen().caja.CUP;
  const dif = diferenciaArqueo(total, esperado);
  $('arqueo-total-contado').textContent = `${total} CUP`;
  const el = $('arqueo-diferencia');
  el.textContent = dif === 0 ? 'Cuadra ✅' : `${dif > 0 ? 'Sobra' : 'Falta'} ${Math.abs(dif)} CUP`;
  el.className = `font-extrabold ${dif === 0 ? 'text-emerald-600' : 'text-red-600'}`;
}

// ------------------------------------------------------------- acciones

export const accionesPOS = {
  'filtrar-categoria': (d) => {
    estado.categoriaFiltro = d.cat;
    renderCategorias();
    renderGrid();
  },
  'agregar-producto': (d) => agregarAlCarrito(d.id),
  sugerencia: (d) => agregarDesdeSugerencia(d.id),
  'cambiar-cantidad': (d) => cambiarCantidad(d.id, Number(d.delta)),
  'vaciar-carrito': vaciarCarrito,
  cobrar: (d) => iniciarCobro(d.moneda),
  'confirmar-venta': confirmarVenta,
  'abrir-cajeros': abrirSeleccionCajero,
  'elegir-cajero': (d) => elegirCajero(d.id),
  'quitar-cajero': quitarCajero,
  'abrir-arqueo': abrirArqueo,
  'copiar-ticket': copiarTicket,
  'ver-ticket': (d) => verTicket(d.id),
};

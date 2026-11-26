// Pantalla de ventas (POS): productos, carrito, cobro, ticket, cajero y arqueo por cajero.
import { estado, cajeroActual, subcategoriasDe } from './estado.js';
import { $, esc, normalizar, formatoFechaHora, nombreProducto } from './utils.js';
import {
  aMinor, fmtMinor, fmtUSD, precioUnitCUP, precioUnitUSD, precioPrincipal, precioSecundario,
  totalesCarrito, montoACobrar,
} from './money.js';
import {
  resumenTurno, ventasDeCajero, esperadoArqueo, diferenciaArqueo, textoReporteSMS, enlaceSMS,
} from './calculos.js';
import { verificarPin, hashPin, nuevaSal, pinValido } from './seguridad.js';
import { DENOMINACIONES_CUP } from './config.js';
import { abrirModal, cerrarModal, toast, pedirTexto, confirmar, mostrarFallo } from './ui.js';
import { abrirEscaner } from './escaner.js';
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
  if (!p) return false;
  if (p.stock - enCarrito(id) <= 0) {
    toast(`${nombreProducto(p)}: agotado`, 'error');
    return false;
  }
  const linea = estado.carrito.find((c) => c.id === id);
  if (linea) linea.cantidad++;
  else estado.carrito.push({ id, cantidad: 1 });
  renderCarrito();
  renderGrid();
  return true;
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

/** Deja la pantalla de ventas lista para el siguiente cliente. */
function limpiarVenta() {
  estado.carrito = [];
  cobro = null;
  $('input-buscador-predictivo').value = '';
  $('input-codigo-barras').value = '';
  $('input-efectivo-recibido').value = '';
  ocultarSugerencias();
  renderCarrito();
  renderGrid();
}

// ------------------------------------------------------------- render

const iconoCategoria = (cat) => {
  const c = normalizar(cat);
  if (c.includes('beb') || c.includes('refresc') || c.includes('jugo')) return '🥤';
  if (c.includes('com') || c.includes('aliment')) return '🍔';
  return '📦';
};

export function renderCategorias() {
  const botones = [['*', 'Todos'], ...estado.categorias.map((c) => [c, c])];
  const chip = (accion, atributo, valor, texto, activo) =>
    `<button type="button" data-action="${accion}" data-${atributo}="${esc(valor)}"
      class="px-3 py-2 rounded-lg text-xs font-semibold ${activo ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700'}">${esc(texto)}</button>`;

  $('botones-categorias').innerHTML = botones
    .map(([valor, texto]) => chip('filtrar-categoria', 'cat', valor, texto, valor === estado.categoriaFiltro))
    .join('');

  const subs = estado.categoriaFiltro === '*' ? [] : subcategoriasDe(estado.categoriaFiltro);
  if (estado.subFiltro !== '*' && !subs.includes(estado.subFiltro)) estado.subFiltro = '*';
  const caja = $('botones-subcategorias');
  caja.classList.toggle('hidden', !subs.length);
  caja.innerHTML = subs.length
    ? [['*', 'Todas'], ...subs.map((s) => [s, s])]
        .map(([valor, texto]) => chip('filtrar-sub', 'sub', valor, texto, valor === estado.subFiltro))
        .join('')
    : '';
}

function tarjetaProducto(p) {
  const disp = p.stock - enCarrito(p.id);
  const agotado = disp <= 0;
  const bajo = !agotado && disp < estado.umbralStock;
  const foto = p.foto
    ? `<img src="${esc(p.foto)}" alt="" loading="lazy" decoding="async" class="w-full h-24 sm:h-28 object-cover rounded-lg mb-2 bg-slate-100">`
    : `<div class="w-full h-24 sm:h-28 rounded-lg mb-2 bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-3xl">${iconoCategoria(p.categoria)}</div>`;
  return `<button type="button" data-action="agregar-producto" data-id="${esc(p.id)}"
    class="text-left border dark:border-slate-700 p-2.5 rounded-xl bg-white dark:bg-slate-800 transition ${agotado ? 'opacity-50 cursor-not-allowed' : 'hover:border-indigo-500 active:scale-95 cursor-pointer'}">
    ${foto}
    <div class="font-bold text-sm leading-tight">${esc(p.nombre)}</div>
    ${p.variante ? `<div class="text-xs text-slate-500 dark:text-slate-400">${esc(p.variante)}</div>` : ''}
    <div class="text-indigo-600 dark:text-indigo-400 font-semibold mt-1">${esc(precioPrincipal(p))}</div>
    <div class="text-xs text-emerald-600">${esc(precioSecundario(p, estado.tasaUSD))}</div>
    <div class="text-xs mt-1.5 ${agotado ? 'text-red-500 font-bold' : bajo ? 'text-amber-600 font-semibold' : 'text-slate-400'}">${agotado ? 'AGOTADO' : (bajo ? '⚠️ Quedan: ' : 'Stock: ') + disp}</div>
  </button>`;
}

export function renderGrid() {
  let lista = estado.productos;
  if (estado.categoriaFiltro !== '*') lista = lista.filter((p) => p.categoria === estado.categoriaFiltro);
  if (estado.subFiltro !== '*') lista = lista.filter((p) => p.subcategoria === estado.subFiltro);

  if (!lista.length) {
    $('product-grid').innerHTML = `<p class="col-span-full text-sm text-slate-400 italic">${
      estado.productos.length ? 'No hay productos aquí.' : 'Aún no hay productos. El dueño puede añadirlos desde el panel de administración.'
    }</p>`;
    return;
  }

  // Con una categoría elegida que tiene subcategorías, se agrupa por subcategoría.
  const subs = estado.categoriaFiltro === '*' ? [] : subcategoriasDe(estado.categoriaFiltro);
  if (subs.length && estado.subFiltro === '*') {
    const grupos = [...subs, ''].map((s) => [s, lista.filter((p) => (p.subcategoria || '') === s)]).filter(([, l]) => l.length);
    $('product-grid').innerHTML = grupos
      .map(
        ([s, l]) =>
          `<h4 class="col-span-full text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mt-2">${esc(s || 'Otros')}</h4>${l.map(tarjetaProducto).join('')}`,
      )
      .join('');
    return;
  }
  $('product-grid').innerHTML = lista.map(tarjetaProducto).join('');
}

export function renderCarrito() {
  sanearCarrito();
  const lineas = lineasCarrito();
  const t = totalesCarrito(lineas, tasas());

  $('lista-carrito').innerHTML = lineas.length
    ? lineas
        .map(({ producto: p, cantidad }) => {
          const sub = precioUnitUSD(p, estado.tasaUSD) * cantidad;
          return `<div class="py-2 flex justify-between items-center text-xs border-b dark:border-slate-700 gap-2">
            <div class="min-w-0"><strong class="block truncate">${esc(nombreProducto(p))}</strong>
              <div class="text-[10px] text-slate-500">${esc(precioPrincipal(p))} c/u</div></div>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" data-action="cambiar-cantidad" data-id="${esc(p.id)}" data-delta="-1" class="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-lg font-bold text-base" aria-label="Quitar uno">−</button>
              <span class="w-6 text-center font-bold">${cantidad}</span>
              <button type="button" data-action="cambiar-cantidad" data-id="${esc(p.id)}" data-delta="1" class="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-lg font-bold text-base" aria-label="Añadir uno">+</button>
              <span class="font-semibold w-14 text-right">${fmtUSD(sub)}</span>
            </div>
          </div>`;
        })
        .join('')
    : '<p class="text-slate-400 text-sm italic">Carrito vacío.</p>';

  $('total-usd').textContent = fmtUSD(t.usd);
  $('total-cup').textContent = `${t.cup} CUP`;

  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  $('total-movil').textContent = `${fmtUSD(t.usd)} · ${t.cup} CUP`;
  $('unidades-movil').textContent = `${unidades} ${unidades === 1 ? 'producto' : 'productos'}`;
  $('barra-carrito-movil').classList.toggle('hidden', !unidades || estado.modoDueno);
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
  renderCategorias();
  renderGrid();
  renderCarrito();
  renderCajero();
}

// ------------------------------------------------------------- búsqueda y código de barras

const coincide = (p, texto) =>
  normalizar(p.nombre).includes(texto) ||
  normalizar(p.variante).includes(texto) ||
  normalizar(p.subcategoria).includes(texto) ||
  (p.codigo && p.codigo.includes(texto));

export function actualizarSugerencias() {
  const texto = normalizar($('input-buscador-predictivo').value.trim());
  const caja = $('lista-sugerencias');
  if (!texto) {
    caja.classList.add('hidden');
    return;
  }
  const hallados = estado.productos.filter((p) => coincide(p, texto)).slice(0, 30);
  caja.innerHTML = hallados.length
    ? hallados
        .map(
          (p) => `<button type="button" data-action="sugerencia" data-id="${esc(p.id)}"
            class="w-full text-left p-3 hover:bg-indigo-50 dark:hover:bg-slate-700 flex justify-between gap-2 text-xs border-b dark:border-slate-700">
            <span>${esc(nombreProducto(p))}</span><span class="font-bold whitespace-nowrap">${esc(precioPrincipal(p))} (${p.stock} un.)</span></button>`,
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
  const primero = estado.productos.find((p) => coincide(p, texto));
  if (primero) agregarDesdeSugerencia(primero.id);
}

/** Agrega al carrito el producto con ese código. Devuelve true si lo encontró. */
function agregarPorCodigo(codigo) {
  const p = estado.productos.find((x) => x.codigo === codigo);
  if (!p) {
    toast(`No existe un producto con el código "${codigo}"`, 'error');
    return false;
  }
  const ok = agregarAlCarrito(p.id);
  if (ok) toast(`➕ ${nombreProducto(p)}`, 'info');
  return ok;
}

export function teclaCodigoBarras(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const codigo = $('input-codigo-barras').value.trim();
  if (!codigo) return;
  agregarPorCodigo(codigo);
  $('input-codigo-barras').value = '';
}

const abrirEscanerVentas = () => abrirEscaner(agregarPorCodigo, { continuo: true });

// ------------------------------------------------------------- cajero y PIN

export function abrirSeleccionCajero() {
  const c = cajeroActual();
  $('lista-modal-cajeros').innerHTML = c
    ? `<div class="p-3 bg-slate-100 dark:bg-slate-700 rounded-lg">
         <div class="font-bold">${esc(c.nombre)} ${c.activo ? '<span class="text-[10px] font-semibold">🟢 En turno</span>' : ''}</div>
         <div class="text-[11px] text-slate-500 break-all">${esc(estado.user ? estado.user.email : '')}</div>
       </div>
       ${estado.esDueno ? '' : '<button type="button" data-action="cambiar-pin" class="w-full p-3 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm font-bold text-left">🔑 Cambiar mi PIN</button>'}`
    : '<p class="text-xs text-slate-400 italic">Tu perfil todavía se está cargando.</p>';
  $('btn-quitar-cajero').classList.toggle('hidden', estado.esDueno || !c);
  abrirModal('modal-seleccion-cajero');
}

/** El cajero cambia su propio PIN (pide el actual y el nuevo dos veces). */
async function cambiarPinPropio() {
  const uid = estado.user.uid;
  let guardado;
  try {
    guardado = await datos.leerPin(uid);
  } catch (e) {
    return toast('No se pudo leer tu PIN. Revisa la conexión.', 'error');
  }
  const opciones = { tipo: 'password', inputmode: 'numeric', placeholder: 'PIN' };
  if (guardado) {
    const actual = await pedirTexto('Tu PIN actual', opciones);
    if (actual === null) return;
    if (!(await verificarPin(actual, guardado.sal, guardado.pinHash))) return toast('El PIN actual no es correcto', 'error');
  }
  const nuevo = await pedirTexto('PIN nuevo (4 a 8 números)', opciones);
  if (nuevo === null) return;
  if (!pinValido(nuevo)) return toast('El PIN debe tener de 4 a 8 dígitos', 'error');
  const repetido = await pedirTexto('Repite el PIN nuevo', opciones);
  if (repetido === null) return;
  if (repetido !== nuevo) return toast('Los dos PIN no coinciden', 'error');
  const sal = nuevaSal();
  datos.guardarPin(uid, sal, await hashPin(nuevo, sal)).catch((err) => mostrarFallo(err, 'PIN'));
  cerrarModal('modal-seleccion-cajero');
  toast('✅ PIN cambiado');
}

/** Bloquea la caja: se vuelve a pedir el PIN (para cambiar de turno o dejar el mostrador). */
async function quitarCajero() {
  const c = cajeroActual();
  if (c) {
    const sinCuadrar = ventasDeCajero(estado.ventas, c.id, c.corteTs).length;
    if (sinCuadrar > 0) {
      const hacer = await confirmar(
        `${c.nombre} tiene ${sinCuadrar} venta(s) sin cuadrar. Lo mejor es hacer el arqueo antes de salir, para que la caja del siguiente cajero empiece limpia.`,
        { titulo: '¿Hacer el arqueo ahora?', si: 'Hacer arqueo', no: 'Bloquear sin arqueo' },
      );
      if (hacer) {
        cerrarModal('modal-seleccion-cajero');
        return abrirArqueo();
      }
    }
  }
  estado.cajeroId = null;
  try {
    sessionStorage.removeItem('cajeroId');
  } catch (e) {
    /* sin almacenamiento de sesión */
  }
  cerrarModal('modal-seleccion-cajero');
  renderCajero();
  window.dispatchEvent(new Event('p3m:bloquear'));
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
  if (faltante) return toast(`Stock insuficiente de ${nombreProducto(faltante.producto)}`, 'error');

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
    costoCUP: t.costoCUP,
    tasaUSD: estado.tasaUSD,
    tasaMLC: estado.tasaMLC,
    items: lineas.map(({ producto: p, cantidad }) => ({
      id: p.id,
      nombre: nombreProducto(p),
      categoria: p.categoria,
      subcategoria: p.subcategoria || '',
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

  cerrarModal('modal-cobro');
  limpiarVenta(); // el carrito, el buscador y el cobro quedan limpios para el siguiente cliente
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

// ------------------------------------------------------------- arqueo (por cajero)
// El arqueo de un cajero cuenta SOLO sus ventas desde su último arqueo cerrado. Así no se
// acumulan las ventas de otros cajeros ni las de arqueos anteriores.

const ventasArqueo = () => {
  const c = cajeroActual();
  return c ? ventasDeCajero(estado.ventas, c.id, c.corteTs) : [];
};

const fondoArqueo = () => Math.max(0, Math.round(parseFloat($('arqueo-fondo').value.replace(',', '.')) || 0));

function contarBilletes() {
  const billetes = {};
  let total = 0;
  DENOMINACIONES_CUP.forEach((d) => {
    const cant = Math.max(0, parseInt($(`arqueo-cant-${d}`).value, 10) || 0);
    if (cant) billetes[d] = cant;
    total += cant * d;
  });
  return { billetes, total };
}

export function abrirArqueo() {
  const c = cajeroActual();
  if (!c) {
    toast('Selecciona un cajero para hacer su arqueo', 'error');
    return abrirSeleccionCajero();
  }
  $('tabla-arqueo-denominaciones').innerHTML = DENOMINACIONES_CUP.map(
    (d) => `<tr>
      <td class="p-2 font-bold">${d} CUP</td>
      <td class="p-2 text-center"><input type="number" min="0" value="0" id="arqueo-cant-${d}" data-input="arqueo" inputmode="numeric"
        class="w-20 border dark:border-slate-700 rounded p-1.5 text-center text-sm dark:bg-slate-900"></td>
      <td class="p-2 text-right font-bold" id="arqueo-sub-${d}">0 CUP</td>
    </tr>`,
  ).join('');
  $('arqueo-fondo').value = '';
  $('arqueo-cajero').textContent = c.nombre;
  const ventas = ventasArqueo();
  const desde = c.corteTs || (estado.turno && estado.turno.inicio);
  $('arqueo-desde').textContent = `${ventas.length} venta(s) desde ${desde ? formatoFechaHora(desde) : 'el inicio del turno'}`;
  calcularTotalArqueo();
  abrirModal('modal-arqueo');
}

export function calcularTotalArqueo() {
  if (!cajeroActual()) return;
  const { total } = contarBilletes();
  DENOMINACIONES_CUP.forEach((d) => {
    const cant = Math.max(0, parseInt($(`arqueo-cant-${d}`).value, 10) || 0);
    $(`arqueo-sub-${d}`).textContent = `${cant * d} CUP`;
  });
  const esperado = esperadoArqueo(ventasArqueo());
  const esperadoCUP = fondoArqueo() + esperado.caja.CUP;
  const dif = diferenciaArqueo(total, esperadoCUP);
  $('arqueo-esperado').textContent = `${esperadoCUP} CUP`;
  $('arqueo-otros').textContent =
    esperado.caja.USD || esperado.caja.MLC
      ? `También debe haber ${fmtMinor(esperado.caja.USD, 'USD')} y ${fmtMinor(esperado.caja.MLC, 'MLC')} (cuéntalos aparte).`
      : '';
  $('arqueo-total-contado').textContent = `${total} CUP`;
  const el = $('arqueo-diferencia');
  el.textContent = dif === 0 ? 'Cuadra ✅' : `${dif > 0 ? 'Sobra' : 'Falta'} ${Math.abs(dif)} CUP`;
  el.className = `font-extrabold ${dif === 0 ? 'text-emerald-600' : 'text-red-600'}`;
}

function limpiarArqueo() {
  DENOMINACIONES_CUP.forEach((d) => ($(`arqueo-cant-${d}`).value = '0'));
  $('arqueo-fondo').value = '';
  calcularTotalArqueo();
}

async function cerrarArqueo() {
  const c = cajeroActual();
  if (!c || !estado.turno) return toast('Selecciona un cajero', 'error');
  const hasta = Date.now();
  const ventas = ventasArqueo().filter((v) => v.ts <= hasta);
  const esperado = esperadoArqueo(ventas);
  const fondo = fondoArqueo();
  const { billetes, total } = contarBilletes();
  const dif = diferenciaArqueo(total, fondo + esperado.caja.CUP);
  const resultado = dif === 0 ? 'La caja cuadra.' : `${dif > 0 ? 'Sobran' : 'Faltan'} ${Math.abs(dif)} CUP.`;

  const ok = await confirmar(
    `${resultado} Al cerrar, el arqueo de ${c.nombre} empieza de cero y estas ventas no se vuelven a contar.`,
    { titulo: '¿Cerrar el arqueo?', si: 'Cerrar arqueo' },
  );
  if (!ok) return;

  const corte = {
    turnoId: estado.turno.id,
    cajeroId: c.id,
    cajero: c.nombre,
    desde: c.corteTs || estado.turno.inicio || 0,
    hasta,
    tickets: esperado.tickets,
    esperado: esperado.caja,
    fondoCUP: fondo,
    contadoCUP: total,
    diferenciaCUP: dif,
    billetes,
  };
  datos.registrarCorte(corte, c.id).catch((e) => mostrarFallo(e, 'Arqueo'));
  cerrarModal('modal-arqueo');
  toast(`✅ Arqueo cerrado. ${resultado}`);
}

// ------------------------------------------------------------- reporte por SMS

const resumen = () =>
  resumenTurno({ ventas: estado.ventas, mermas: estado.mermas, categorias: estado.categorias, tasaUSD: estado.tasaUSD });

/** Prepara el reporte del turno en la app de mensajes (sirve sin internet: el SMS sale por la línea del teléfono). */
export async function enviarReporteSMS() {
  if (!estado.turno) return toast('No hay un turno abierto', 'error');
  const bajos = estado.productos.filter((p) => p.stock < estado.umbralStock).map(nombreProducto);
  const texto = textoReporteSMS({ resumen: resumen(), pendientes: estado.pendientes, stockBajo: bajos });
  try {
    await navigator.clipboard.writeText(texto); // copia de respaldo por si no se abre la app de mensajes
  } catch (e) {
    /* sin permiso del portapapeles */
  }
  toast(`Abriendo mensajes para ${estado.telefonoReporte}…`, 'info');
  window.location.href = enlaceSMS(estado.telefonoReporte, texto);
}

// ------------------------------------------------------------- acciones

export const accionesPOS = {
  'filtrar-categoria': (d) => {
    estado.categoriaFiltro = d.cat;
    estado.subFiltro = '*';
    renderCategorias();
    renderGrid();
  },
  'filtrar-sub': (d) => {
    estado.subFiltro = d.sub;
    renderCategorias();
    renderGrid();
  },
  'agregar-producto': (d) => agregarAlCarrito(d.id),
  sugerencia: (d) => agregarDesdeSugerencia(d.id),
  'cambiar-cantidad': (d) => cambiarCantidad(d.id, Number(d.delta)),
  'vaciar-carrito': vaciarCarrito,
  'limpiar-busqueda': () => {
    $('input-buscador-predictivo').value = '';
    ocultarSugerencias();
  },
  'limpiar-codigo': () => {
    $('input-codigo-barras').value = '';
  },
  'abrir-escaner': abrirEscanerVentas,
  'ver-carrito': () => $('seccion-carrito').scrollIntoView({ behavior: 'smooth', block: 'start' }),
  cobrar: (d) => iniciarCobro(d.moneda),
  'confirmar-venta': confirmarVenta,
  'abrir-cajeros': abrirSeleccionCajero,
  'cambiar-pin': cambiarPinPropio,
  'quitar-cajero': quitarCajero,
  'abrir-arqueo': abrirArqueo,
  'limpiar-arqueo': limpiarArqueo,
  'cerrar-arqueo': cerrarArqueo,
  'sms-reporte': enviarReporteSMS,
  'copiar-ticket': copiarTicket,
  'ver-ticket': (d) => verTicket(d.id),
};

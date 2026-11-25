// Panel de administración (solo dueño): inventario con fotos, categorías y subcategorías, personal,
// mermas, historial, panel financiero (USD y CUP), Reporte Z / cierre de turno, reporte de la
// semana, turnos cerrados, respaldos y migración.
import { estado, subcategoriasDe } from './estado.js';
import {
  $, esc, normalizar, formatoHora, formatoFechaHora, duracion, descargarArchivo, nombreProducto,
  comprimirImagen,
} from './utils.js';
import { aMinor, fmtMinor, fmtUSD, precioPrincipal, costoPrincipal } from './money.js';
import {
  resumenTurno, cuadreInventario, rangoReporte, reportePeriodo, enlaceSMS,
} from './calculos.js';
import { hashPin, nuevaSal, pinValido } from './seguridad.js';
import { planDesdeAntiguo, planDesdeRespaldo } from './migracion.js';
import { LADO_FOTO } from './config.js';
import {
  abrirModal, cerrarModal, toast, confirmar, avisar, pedirTexto, mostrarFallo,
} from './ui.js';
import { abrirEscaner } from './escaner.js';
import * as datos from './data.js';

function exigirDueno() {
  if (estado.esDueno && estado.modoDueno) return true;
  toast('Esta acción es solo para el dueño', 'error');
  return false;
}

/** Ejecuta una escritura sin bloquear la pantalla (con internet caído queda en cola). */
function enviar(promesa, contexto) {
  promesa.catch((e) => mostrarFallo(e, contexto));
}

const resumen = () =>
  resumenTurno({ ventas: estado.ventas, mermas: estado.mermas, categorias: estado.categorias, tasaUSD: estado.tasaUSD });

const cup = (n) => `${Math.round(n || 0)} CUP`;
const fechaDia = (ms) => new Date(ms).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

// ------------------------------------------------------------- render

export function renderStockCritico() {
  const criticos = estado.productos.filter((p) => p.stock < estado.umbralStock);
  $('contenedor-stock-critico').innerHTML = criticos.length
    ? criticos
        .map(
          (p) => `<div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 rounded-lg flex justify-between items-center text-xs gap-2">
            <div><strong class="text-red-900 dark:text-red-200 block">${esc(nombreProducto(p))}</strong>
              <span class="text-red-600 dark:text-red-400 font-bold">${p.stock <= 0 ? 'AGOTADO' : `Quedan: ${p.stock} un.`} (inició con ${p.stockInicial})</span></div>
            <button type="button" data-action="reabastecer" data-id="${esc(p.id)}" class="bg-red-600 text-white px-3 py-2 rounded-lg font-bold shadow shrink-0">➕ Rellenar</button>
          </div>`,
        )
        .join('')
    : '<p class="text-xs text-emerald-600 dark:text-emerald-400 font-medium italic col-span-full">🟢 Todo el inventario tiene niveles óptimos de stock.</p>';
}

export function renderChipsCategorias() {
  $('contenedor-chips-categorias').innerHTML = estado.categorias
    .map((c) => {
      const subs = subcategoriasDe(c);
      return `<div class="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 rounded-lg text-xs">
        <div class="flex items-center gap-2 font-semibold">
          <span>📁 ${esc(c)}</span>
          <button type="button" data-action="eliminar-categoria" data-cat="${esc(c)}" class="text-red-500 hover:text-red-700 font-bold ml-1 px-1" aria-label="Eliminar categoría">✕</button>
        </div>
        ${
          subs.length
            ? `<div class="flex flex-wrap gap-1 mt-1.5">${subs
                .map(
                  (s) => `<span class="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-full px-2 py-0.5 flex items-center gap-1">
                    ${esc(s)}<button type="button" data-action="eliminar-subcategoria" data-cat="${esc(c)}" data-sub="${esc(s)}" class="text-red-500 font-bold px-0.5" aria-label="Eliminar subcategoría">✕</button></span>`,
                )
                .join('')}</div>`
            : '<div class="text-[10px] text-slate-400 mt-1">Sin subcategorías</div>'
        }
      </div>`;
    })
    .join('');

  const sel = $('select-sub-categoria');
  const actual = sel.value;
  sel.innerHTML = estado.categorias.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (estado.categorias.includes(actual)) sel.value = actual;
}

export function renderEmpleados() {
  $('tabla-empleados-admin').innerHTML = estado.empleados.length
    ? estado.empleados
        .map(
          (e) => `<tr>
            <td class="p-3"><span class="px-2 py-0.5 text-xs rounded-full font-bold ${e.activo ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">${e.activo ? 'En turno' : 'Inactivo'}</span></td>
            <td class="p-3 font-bold">${esc(e.nombre)}
              ${e.pinHash ? '' : '<span class="block text-[10px] text-amber-600 font-semibold">⚠️ Sin PIN</span>'}</td>
            <td class="p-3 font-mono text-indigo-600 dark:text-indigo-400 font-bold" id="crono-emp-${esc(e.id)}">${e.activo && e.inicioTurno ? duracion(e.inicioTurno) : '00:00:00'}</td>
            <td class="p-3 text-right space-x-1 whitespace-nowrap">
              <button type="button" data-action="turno-empleado" data-id="${esc(e.id)}" class="text-xs px-3 py-2 rounded-lg font-bold text-white ${e.activo ? 'bg-red-600' : 'bg-emerald-600'}">${e.activo ? 'Finalizar turno' : 'Iniciar turno'}</button>
              <button type="button" data-action="pin-empleado" data-id="${esc(e.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg font-bold" title="Cambiar PIN" aria-label="Cambiar PIN">🔑</button>
              <button type="button" data-action="eliminar-empleado" data-id="${esc(e.id)}" class="text-xs bg-red-100 text-red-700 px-3 py-2 rounded-lg font-bold" title="Eliminar" aria-label="Eliminar">🗑️</button>
            </td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4" class="p-4 text-center text-slate-400 italic">Aún no hay trabajadores. Añade el primero.</td></tr>';
}

export function actualizarCronometros() {
  if (!estado.modoDueno) return;
  estado.empleados.forEach((e) => {
    if (!e.activo || !e.inicioTurno) return;
    const el = $(`crono-emp-${e.id}`);
    if (el) el.textContent = duracion(e.inicioTurno);
  });
}

export function renderInventario() {
  const filtro = normalizar($('input-buscador-inventario').value.trim());
  const lista = estado.productos.filter(
    (p) =>
      normalizar(nombreProducto(p)).includes(filtro) ||
      normalizar(p.categoria).includes(filtro) ||
      normalizar(p.subcategoria).includes(filtro) ||
      (p.codigo && p.codigo.includes(filtro)),
  );
  $('tabla-inventario').innerHTML = lista.length
    ? lista
        .map(
          (p) => `<tr>
            <td class="p-3"><div class="flex items-center gap-3">
              ${p.foto ? `<img src="${esc(p.foto)}" alt="" loading="lazy" class="w-12 h-12 rounded-lg object-cover shrink-0">` : '<div class="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xl shrink-0">📦</div>'}
              <div><span class="font-medium">${esc(nombreProducto(p))}</span><div class="text-[10px] text-slate-400">Cód: ${esc(p.codigo || 'S/N')}</div></div></div></td>
            <td class="p-3"><span class="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">${esc(p.categoria)}${p.subcategoria ? ' › ' + esc(p.subcategoria) : ''}</span></td>
            <td class="p-3 whitespace-nowrap">${esc(costoPrincipal(p))} / <strong class="text-indigo-600 dark:text-indigo-400">${esc(precioPrincipal(p))}</strong></td>
            <td class="p-3 whitespace-nowrap"><span class="text-xs text-slate-400">Ini: ${p.stockInicial}</span> ➔
              <strong class="${p.stock <= 0 ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}">${p.stock} un.</strong></td>
            <td class="p-3 text-right space-x-1 whitespace-nowrap">
              <button type="button" data-action="reabastecer" data-id="${esc(p.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg">➕ Stock</button>
              <button type="button" data-action="editar-producto" data-id="${esc(p.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg">✏️ Editar</button>
              <button type="button" data-action="eliminar-producto" data-id="${esc(p.id)}" class="text-xs bg-red-100 text-red-700 px-3 py-2 rounded-lg font-bold" aria-label="Eliminar">🗑️</button>
            </td></tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">${estado.productos.length ? 'No se encontraron productos.' : 'Aún no hay productos. Usa "+ Producto" o restaura un respaldo.'}</td></tr>`;
}

export function renderMermas() {
  $('tabla-mermas').innerHTML = estado.mermas.length
    ? estado.mermas
        .map(
          (m) => `<tr><td class="p-3 text-xs">${formatoHora(m.ts)}</td><td class="p-3 font-bold">${esc(m.producto)}</td>
            <td class="p-3 text-red-600">${m.cantidad} un.</td><td class="p-3">${esc(m.motivo)}</td>
            <td class="p-3 whitespace-nowrap">-${fmtUSD(m.perdidaCents)}${Number.isFinite(m.perdidaCUP) ? ` / -${m.perdidaCUP} CUP` : ''}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Sin mermas.</td></tr>';
}

function actualizarFiltroCajeros() {
  const sel = $('filtro-historial-cajero');
  const actual = sel.value || 'TODOS';
  const nombres = [...new Set([...estado.empleados.map((e) => e.nombre), ...estado.ventas.map((v) => v.cajero)])];
  sel.innerHTML =
    '<option value="TODOS">Todos los cajeros</option>' +
    nombres.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = actual === 'TODOS' || nombres.includes(actual) ? actual : 'TODOS';
}

export function renderHistorial() {
  actualizarFiltroCajeros();
  const filtro = $('filtro-historial-cajero').value;
  const lista = filtro === 'TODOS' ? estado.ventas : estado.ventas.filter((v) => v.cajero === filtro);
  $('contador-tickets').textContent = `${lista.length} tickets`;
  $('tabla-historial').innerHTML = lista.length
    ? lista
        .map(
          (v) => `<tr><td class="p-3 text-xs">${formatoHora(v.ts)}</td>
            <td class="p-3 font-semibold text-indigo-600 dark:text-indigo-400">${esc(v.cajero)}</td>
            <td class="p-3">${esc(v.items.map((i) => `${i.cantidad}x ${i.nombre}`).join(', '))}</td>
            <td class="p-3 whitespace-nowrap">${esc(fmtMinor(v.cobrado, v.moneda))}</td>
            <td class="p-3 whitespace-nowrap">${fmtUSD(v.totalUSD)}${Number.isFinite(v.totalCUP) ? ` / ${v.totalCUP} CUP` : ''}</td>
            <td class="p-3 text-right"><button type="button" data-action="ver-ticket" data-id="${esc(v.id)}" class="px-2 py-1" aria-label="Ver ticket">🧾</button></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No hay ventas registradas para este filtro.</td></tr>';
}

export function renderFinanciero() {
  const r = resumen();
  $('ventas-dia').textContent = `${fmtUSD(r.ventasUSD)} USD`;
  $('ventas-dia-cup').textContent = cup(r.ventasCUP);
  $('gastos-dia').textContent = `${fmtUSD(r.gastosUSD)} USD`;
  $('gastos-dia-cup').textContent = cup(r.gastosCUP);
  $('ganancia-neta-dia').textContent = `${fmtUSD(r.netoUSD)} USD`;
  $('ganancia-neta-dia-cup').textContent = cup(r.netoCUP);
  $('caja-turno').textContent = `CUP ${r.caja.CUP} · ${fmtMinor(r.caja.USD, 'USD')} · ${fmtMinor(r.caja.MLC, 'MLC')}`;

  $('desglose-categorias-grid').innerHTML = r.porCategoria
    .map(
      (c) => `<div class="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border dark:border-slate-700 flex justify-between items-center">
        <span class="text-xs font-bold text-slate-600 dark:text-slate-300">📁 ${esc(c.categoria)}</span>
        <div class="text-right"><span class="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">${c.cup} CUP</span>
        <div class="text-[10px] text-slate-400">(${fmtUSD(c.usd)} USD)</div></div></div>`,
    )
    .join('');

  $('desglose-cajeros').innerHTML = r.porCajero.length
    ? r.porCajero
        .map(
          (c) => `<div class="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border dark:border-slate-700 flex justify-between items-center gap-2">
            <span class="text-xs font-bold text-slate-600 dark:text-slate-300">👤 ${esc(c.cajero)} <span class="font-normal text-slate-400">· ${c.tickets} venta(s)</span></span>
            <div class="text-right"><span class="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">${c.ventasCUP} CUP</span>
            <div class="text-[10px] text-slate-400">(${fmtUSD(c.ventasUSD)} USD)</div></div></div>`,
        )
        .join('')
    : '<p class="text-xs text-slate-400 italic">Aún no hay ventas en este turno.</p>';
}

export function renderCortes() {
  $('tabla-cortes').innerHTML = estado.cortes.length
    ? estado.cortes
        .map((c) => {
          const dif = c.diferenciaCUP || 0;
          return `<tr><td class="p-3 text-xs">${formatoHora(c.hasta)}</td><td class="p-3 font-semibold">${esc(c.cajero)}</td>
            <td class="p-3">${c.tickets}</td><td class="p-3">${(c.esperado ? c.esperado.CUP : 0) + (c.fondoCUP || 0)} CUP</td>
            <td class="p-3">${c.contadoCUP} CUP</td>
            <td class="p-3 font-bold ${dif === 0 ? 'text-emerald-600' : 'text-red-600'}">${dif === 0 ? 'Cuadró ✅' : (dif > 0 ? 'Sobra ' : 'Falta ') + Math.abs(dif) + ' CUP'}</td></tr>`;
        })
        .join('')
    : '<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">Ningún cajero ha cerrado su arqueo en este turno.</td></tr>';
}

export function renderCierres() {
  if (estado.errorCierres) {
    $('tabla-cierres').innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-600 text-xs">No se pudieron leer los turnos cerrados (${esc(estado.errorCierres)}). ${
      estado.errorCierres === 'permission-denied' ? 'Publica las reglas nuevas (firestore.rules).' : 'Revisa tu conexión.'
    }</td></tr>`;
    return;
  }
  $('tabla-cierres').innerHTML = estado.cierres.length
    ? estado.cierres
        .map(
          (c) => `<tr><td class="p-3 text-xs">${formatoFechaHora(c.cerradoEn)}</td>
            <td class="p-3">${c.tickets}</td><td class="p-3 whitespace-nowrap">${fmtUSD(c.ventasUSD)}${Number.isFinite(c.ventasCUP) ? ` / ${c.ventasCUP} CUP` : ''}</td>
            <td class="p-3 font-bold whitespace-nowrap">${fmtUSD(c.netoUSD)}${Number.isFinite(c.netoCUP) ? ` / ${c.netoCUP} CUP` : ''}</td>
            <td class="p-3 text-xs text-slate-500">${esc(c.cerradoPor || '')}</td>
            <td class="p-3 text-right"><button type="button" data-action="ver-cierre" data-id="${esc(c.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg">Ver</button></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No hay turnos cerrados en los últimos 30 días.</td></tr>';
}

export function renderAdmin() {
  renderStockCritico();
  renderChipsCategorias();
  renderEmpleados();
  renderInventario();
  renderMermas();
  renderHistorial();
  renderFinanciero();
  renderCortes();
  renderCierres();
}

// ------------------------------------------------------------- categorías y subcategorías

function agregarCategoria() {
  if (!exigirDueno()) return;
  const input = $('input-nueva-categoria');
  const nombre = input.value.trim();
  if (!nombre) return toast('Escribe un nombre para la categoría', 'error');
  if (estado.categorias.some((c) => normalizar(c) === normalizar(nombre))) return toast('Esa categoría ya existe', 'error');
  enviar(datos.guardarConfig({ categorias: [...estado.categorias, nombre] }), 'Categoría');
  input.value = '';
  toast(`Categoría "${nombre}" agregada`);
}

async function eliminarCategoria(cat) {
  if (!exigirDueno()) return;
  if (estado.categorias.length <= 1) return toast('Debe quedar al menos una categoría', 'error');
  const usados = estado.productos.filter((p) => p.categoria === cat).length;
  if (usados) return avisar(`No puedes eliminar "${cat}": tiene ${usados} producto(s) asignado(s).`);
  if (!(await confirmar(`¿Eliminar la categoría "${cat}"?`, { peligro: true, si: 'Eliminar' }))) return;
  if (estado.categoriaFiltro === cat) estado.categoriaFiltro = '*';
  enviar(
    datos.guardarConfig({
      categorias: estado.categorias.filter((c) => c !== cat),
      subcategorias: estado.subcategorias.filter((s) => s.cat !== cat),
    }),
    'Categoría',
  );
}

/** Crea una subcategoría (por ejemplo "Refresco" dentro de "Bebidas"). Devuelve true si se creó. */
function crearSubcategoria(cat, nombre) {
  const limpio = nombre.trim();
  if (!cat || !limpio) {
    toast('Elige la categoría y escribe el nombre', 'error');
    return false;
  }
  if (estado.subcategorias.some((s) => s.cat === cat && normalizar(s.nombre) === normalizar(limpio))) {
    toast('Esa subcategoría ya existe', 'error');
    return false;
  }
  estado.subcategorias = [...estado.subcategorias, { cat, nombre: limpio }];
  enviar(datos.guardarConfig({ subcategorias: estado.subcategorias }), 'Subcategoría');
  return true;
}

function agregarSubcategoria() {
  if (!exigirDueno()) return;
  const input = $('input-nueva-subcategoria');
  const cat = $('select-sub-categoria').value;
  if (crearSubcategoria(cat, input.value)) {
    toast(`Subcategoría "${input.value.trim()}" agregada a ${cat}`);
    input.value = '';
    renderChipsCategorias();
  }
}

async function eliminarSubcategoria(cat, sub) {
  if (!exigirDueno()) return;
  const usados = estado.productos.filter((p) => p.categoria === cat && p.subcategoria === sub).length;
  if (usados) return avisar(`No puedes eliminar "${sub}": tiene ${usados} producto(s). Cámbialos de subcategoría primero.`);
  if (!(await confirmar(`¿Eliminar la subcategoría "${sub}" de ${cat}?`, { peligro: true, si: 'Eliminar' }))) return;
  estado.subcategorias = estado.subcategorias.filter((s) => !(s.cat === cat && s.nombre === sub));
  enviar(datos.guardarConfig({ subcategorias: estado.subcategorias }), 'Subcategoría');
  renderChipsCategorias();
}

// ------------------------------------------------------------- productos

let fotoEdicion; // undefined = sin cambios · null = quitar la foto · texto = foto nueva

const OPCION_NUEVA_SUB = '__nueva__';

function llenarSelectCategorias(seleccion) {
  $('nuevo-categoria').innerHTML = estado.categorias
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join('');
  if (seleccion) $('nuevo-categoria').value = seleccion;
}

function llenarSelectSub(cat, seleccion) {
  const subs = subcategoriasDe(cat);
  $('nuevo-subcategoria').innerHTML =
    '<option value="">(Sin subcategoría)</option>' +
    subs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('') +
    `<option value="${OPCION_NUEVA_SUB}">＋ Nueva subcategoría…</option>`;
  $('nuevo-subcategoria').value = subs.includes(seleccion) ? seleccion : '';
}

function pintarFoto() {
  const url = fotoEdicion === undefined ? $('foto-preview').dataset.original || '' : fotoEdicion || '';
  const img = $('foto-preview');
  img.classList.toggle('hidden', !url);
  $('foto-vacia').classList.toggle('hidden', !!url);
  if (url) img.src = url;
  else img.removeAttribute('src');
  $('btn-quitar-foto').classList.toggle('hidden', !url);
}

function abrirModalProducto(id) {
  if (!exigirDueno()) return;
  if (!estado.categorias.length) return toast('Primero crea una categoría', 'error');
  const p = id ? estado.productos.find((x) => x.id === id) : null;
  $('producto-modal-titulo').textContent = p ? '✏️ Editar Producto' : '📦 Nuevo Producto';
  $('nuevo-id').value = p ? p.id : '';
  $('nuevo-nombre').value = p ? p.nombre : '';
  $('nuevo-variante').value = p ? p.variante : '';
  $('nuevo-codigo').value = p ? p.codigo : '';
  llenarSelectCategorias(p ? p.categoria : null);
  llenarSelectSub($('nuevo-categoria').value, p ? p.subcategoria : '');
  $('nuevo-moneda-base').value = p ? p.moneda : 'USD';
  $('input-precio-base').value = p ? (p.moneda === 'CUP' ? p.precio : p.precio / 100) : '';
  $('nuevo-costo-moneda').value = p ? p.costoMoneda : 'USD';
  $('nuevo-costo').value = p ? (p.costoMoneda === 'CUP' ? p.costo : p.costo / 100) : '';
  $('nuevo-stock').value = '';
  $('grupo-stock-inicial').classList.toggle('hidden', !!p);
  fotoEdicion = undefined;
  $('foto-preview').dataset.original = p ? p.foto : '';
  pintarFoto();
  abrirModal('modal-producto');
  setTimeout(() => $('nuevo-nombre').focus(), 30);
}

function limpiarFormularioProducto() {
  ['nuevo-nombre', 'nuevo-variante', 'nuevo-codigo', 'input-precio-base', 'nuevo-costo', 'nuevo-stock'].forEach(
    (id) => ($(id).value = ''),
  );
  $('nuevo-moneda-base').value = 'USD';
  $('nuevo-costo-moneda').value = 'USD';
  llenarSelectSub($('nuevo-categoria').value, '');
  fotoEdicion = $('nuevo-id').value ? null : undefined;
  pintarFoto();
  $('nuevo-nombre').focus();
}

/** Cambios en los selectores del formulario de producto (categoría / subcategoría). */
export async function cambioFormularioProducto(e) {
  if (e.target.id === 'nuevo-categoria') {
    llenarSelectSub(e.target.value, '');
  } else if (e.target.id === 'nuevo-subcategoria' && e.target.value === OPCION_NUEVA_SUB) {
    const cat = $('nuevo-categoria').value;
    const nombre = await pedirTexto(`Nueva subcategoría en "${cat}"`, { placeholder: 'Por ejemplo: Refresco', si: 'Crear' });
    if (nombre !== null && crearSubcategoria(cat, nombre)) llenarSelectSub(cat, nombre.trim());
    else llenarSelectSub(cat, '');
  }
}

/** Una foto elegida o tomada con la cámara: se reduce y queda lista para guardarse. */
export async function cargarFoto(evento) {
  const archivo = evento.target.files[0];
  evento.target.value = '';
  if (!archivo) return;
  try {
    fotoEdicion = await comprimirImagen(archivo, LADO_FOTO);
    pintarFoto();
  } catch (e) {
    toast('No se pudo leer esa foto. Prueba con otra.', 'error');
  }
}

function quitarFoto() {
  fotoEdicion = null;
  pintarFoto();
}

function guardarProducto() {
  if (!exigirDueno()) return;
  const id = $('nuevo-id').value;
  const nombre = $('nuevo-nombre').value.trim();
  const variante = $('nuevo-variante').value.trim();
  const moneda = $('nuevo-moneda-base').value === 'CUP' ? 'CUP' : 'USD';
  const precio = aMinor($('input-precio-base').value, moneda);
  const costoMoneda = $('nuevo-costo-moneda').value === 'CUP' ? 'CUP' : 'USD';
  const txtCosto = $('nuevo-costo').value.trim();
  const costo = txtCosto === '' ? 0 : aMinor(txtCosto, costoMoneda);
  const codigo = $('nuevo-codigo').value.trim() || codigoLibre();
  const categoria = $('nuevo-categoria').value;
  const sub = $('nuevo-subcategoria').value;
  const subcategoria = sub === OPCION_NUEVA_SUB ? '' : sub;

  if (!nombre) return toast('Escribe un nombre', 'error');
  if (!Number.isFinite(precio) || precio <= 0) return toast('Escribe un precio válido', 'error');
  if (!Number.isFinite(costo) || costo < 0) return toast('El costo no es válido', 'error');
  if (estado.productos.some((p) => p.codigo && p.codigo === codigo && p.id !== id)) {
    return toast(`El código ${codigo} ya lo usa otro producto`, 'error');
  }

  const base = {
    nombre, variante, codigo, categoria, subcategoria, moneda, precio,
    costo, costoMoneda, costoCents: costoMoneda === 'USD' ? costo : 0,
  };
  if (fotoEdicion !== undefined) base.foto = fotoEdicion; // texto = nueva, null = quitar

  if (id) {
    enviar(datos.actualizarProducto(id, base), 'Producto');
  } else {
    const stock = parseInt($('nuevo-stock').value, 10) || 0;
    if (stock < 0) return toast('El stock no puede ser negativo', 'error');
    if (base.foto === null) delete base.foto;
    enviar(datos.crearProducto({ ...base, stockInicial: stock, stock }), 'Producto');
  }
  cerrarModal('modal-producto');
}

function codigoLibre() {
  let codigo;
  do codigo = `750${Math.floor(1000 + Math.random() * 9000)}`;
  while (estado.productos.some((p) => p.codigo === codigo));
  return codigo;
}

async function reabastecer(id) {
  if (!exigirDueno()) return;
  const p = estado.productos.find((x) => x.id === id);
  if (!p) return;
  const txt = await pedirTexto(`Unidades a sumar a "${nombreProducto(p)}"`, { valor: '10', inputmode: 'numeric', si: 'Sumar' });
  if (txt === null) return;
  const n = parseInt(txt, 10);
  if (!Number.isFinite(n) || n <= 0) return toast('Escribe una cantidad mayor que 0', 'error');
  enviar(datos.reabastecerProducto(id, n), 'Stock');
}

async function eliminarProducto(id) {
  if (!exigirDueno()) return;
  const p = estado.productos.find((x) => x.id === id);
  if (!p) return;
  if (!(await confirmar(`¿Eliminar "${nombreProducto(p)}" del inventario?`, { peligro: true, si: 'Eliminar' }))) return;
  enviar(datos.eliminarProducto(id), 'Producto');
}

// ------------------------------------------------------------- tasas y ajustes

function abrirModalTasa() {
  if (!exigirDueno()) return;
  $('input-tasa-usd').value = estado.tasaUSD;
  $('input-tasa-mlc').value = estado.tasaMLC;
  $('input-telefono').value = estado.telefonoReporte;
  abrirModal('modal-tasa');
}

function guardarTasa() {
  if (!exigirDueno()) return;
  const usd = parseFloat($('input-tasa-usd').value);
  const mlc = parseFloat($('input-tasa-mlc').value);
  const telefono = $('input-telefono').value.trim();
  if (!(usd > 0) || !(mlc > 0)) return toast('Las tasas deben ser números mayores que 0', 'error');
  if (telefono && !/^\+?[\d\s-]{8,16}$/.test(telefono)) return toast('El teléfono no es válido (ej.: +5353463594)', 'error');
  const cambios = { tasaUSD: usd, tasaMLC: mlc };
  if (telefono) cambios.telefonoReporte = telefono.replace(/[\s-]/g, '');
  enviar(datos.guardarConfig(cambios), 'Ajustes');
  cerrarModal('modal-tasa');
  toast('Ajustes guardados');
}

// ------------------------------------------------------------- personal

function abrirModalEmpleado(id) {
  if (!exigirDueno()) return;
  const e = id ? estado.empleados.find((x) => x.id === id) : null;
  $('empleado-modal-titulo').textContent = e ? `🔑 Cambiar PIN de ${e.nombre}` : '👤 Nuevo Trabajador';
  $('empleado-id').value = e ? e.id : '';
  $('empleado-nombre').value = e ? e.nombre : '';
  $('empleado-nombre').disabled = !!e;
  $('empleado-pin').value = '';
  $('empleado-error').classList.add('hidden');
  abrirModal('modal-empleado');
  setTimeout(() => (e ? $('empleado-pin') : $('empleado-nombre')).focus(), 30);
}

async function guardarEmpleado() {
  if (!exigirDueno()) return;
  const id = $('empleado-id').value;
  const nombre = $('empleado-nombre').value.trim();
  const pin = $('empleado-pin').value.trim();
  const error = (t) => {
    $('empleado-error').textContent = t;
    $('empleado-error').classList.remove('hidden');
  };
  if (!nombre) return error('Escribe el nombre.');
  if (!pinValido(pin)) return error('El PIN debe tener de 4 a 8 dígitos.');

  const sal = nuevaSal();
  const pinHash = await hashPin(pin, sal);
  if (id) enviar(datos.actualizarEmpleado(id, { sal, pinHash }), 'PIN');
  else enviar(datos.crearEmpleado({ nombre, activo: false, inicioTurno: null, sal, pinHash }), 'Trabajador');
  cerrarModal('modal-empleado');
  toast(id ? 'PIN actualizado' : `${nombre} añadido`);
}

function alternarTurno(id) {
  if (!exigirDueno()) return;
  const e = estado.empleados.find((x) => x.id === id);
  if (!e) return;
  enviar(
    datos.actualizarEmpleado(id, e.activo ? { activo: false, inicioTurno: null } : { activo: true, inicioTurno: Date.now() }),
    'Turno',
  );
}

async function eliminarEmpleado(id) {
  if (!exigirDueno()) return;
  const e = estado.empleados.find((x) => x.id === id);
  if (!e) return;
  if (!(await confirmar(`¿Eliminar a ${e.nombre}? Sus ventas anteriores se conservan.`, { peligro: true, si: 'Eliminar' }))) return;
  enviar(datos.eliminarEmpleado(id), 'Trabajador');
}

// ------------------------------------------------------------- mermas

function abrirModalMerma() {
  if (!exigirDueno()) return;
  const con = estado.productos.filter((p) => p.stock > 0);
  if (!con.length) return toast('No hay productos con stock', 'error');
  $('merma-producto-select').innerHTML = con
    .map((p) => `<option value="${esc(p.id)}">${esc(nombreProducto(p))} (Stock: ${p.stock})</option>`)
    .join('');
  $('merma-cantidad').value = 1;
  abrirModal('modal-merma');
}

function guardarMerma() {
  if (!exigirDueno()) return;
  const p = estado.productos.find((x) => x.id === $('merma-producto-select').value);
  const cantidad = parseInt($('merma-cantidad').value, 10);
  const motivo = $('merma-motivo').value;
  if (!p || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad > p.stock) {
    return toast('Cantidad inválida o mayor que el stock', 'error');
  }
  if (!estado.turno) return toast('No hay un turno abierto', 'error');
  enviar(datos.registrarMerma({ ...p, nombre: nombreProducto(p) }, cantidad, motivo), 'Merma');
  cerrarModal('modal-merma');
}

// ------------------------------------------------------------- Reporte Z / cierre

export function abrirReporteZ() {
  if (!exigirDueno()) return;
  const r = resumen();
  $('rz-fecha').textContent = formatoFechaHora(Date.now());
  $('rz-usd').textContent = fmtMinor(r.caja.USD, 'USD');
  $('rz-mlc').textContent = fmtMinor(r.caja.MLC, 'MLC');
  $('rz-cup').textContent = fmtMinor(r.caja.CUP, 'CUP');
  $('rz-tickets').textContent = String(r.tickets);
  $('rz-ventas').textContent = `${fmtUSD(r.ventasUSD)} / ${r.ventasCUP} CUP`;
  $('rz-gastos').textContent = `-${fmtUSD(r.gastosUSD)} / -${r.gastosCUP} CUP`;
  $('rz-neto').textContent = `${fmtUSD(r.netoUSD)} / ${r.netoCUP} CUP`;

  $('rz-cajeros').innerHTML = r.porCajero.length
    ? r.porCajero
        .map((c) => `<div class="fila"><span>${esc(c.cajero)} (${c.tickets})</span><span>${c.ventasCUP} CUP</span></div>`)
        .join('')
    : '<div>Sin ventas</div>';

  const cuadre = cuadreInventario(estado.productos);
  $('rz-cuadre-inventario').innerHTML = cuadre.length
    ? cuadre
        .map(
          (c) => `<div style="display:flex; justify-content:space-between; gap:6px; border-bottom:1px dotted #ccc; padding:2px 0;">
            <span style="max-width:55%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(c.nombre)}</span>
            <span>${c.inicial}->${c.final} (${c.salidas >= 0 ? '-' + c.salidas : '+' + Math.abs(c.salidas)})</span></div>`,
        )
        .join('')
    : '<div>Sin productos</div>';
  $('rz-respaldo').checked = true;
  abrirModal('modal-reportez');
}

async function cerrarTurno() {
  if (!exigirDueno()) return;
  if (!estado.turno) return toast('No hay un turno abierto', 'error');
  const sinCerrar = estado.empleados.filter((e) => {
    const c = estado.ventas.filter((v) => v.cajeroId === e.id && v.ts > (e.corteTs || 0)).length;
    return c > 0;
  });
  const aviso = sinCerrar.length
    ? `\n\n⚠️ Estos cajeros no cerraron su arqueo: ${sinCerrar.map((e) => e.nombre).join(', ')}.`
    : '';
  const ok = await confirmar(
    `Se guardará el reporte Z, la caja volverá a 0 y el stock actual será el stock inicial del nuevo turno.${aviso}`,
    { titulo: '¿Cerrar el turno?', si: 'Cerrar turno', peligro: true },
  );
  if (!ok) return;

  if ($('rz-respaldo').checked) exportarRespaldo(); // respaldo descargado ANTES de cerrar

  const r = resumen();
  const cierre = {
    turnoId: estado.turno.id,
    inicio: estado.turno.inicio,
    cerradoEn: Date.now(),
    cerradoPor: estado.user.email,
    tickets: r.tickets,
    ventasUSD: r.ventasUSD,
    ventasCUP: r.ventasCUP,
    costoUSD: r.costoUSD,
    costoCUP: r.costoCUP,
    gastosUSD: r.gastosUSD,
    gastosCUP: r.gastosCUP,
    netoUSD: r.netoUSD,
    netoCUP: r.netoCUP,
    caja: r.caja,
    porCategoria: r.porCategoria,
    porCajero: r.porCajero,
    arqueos: estado.cortes.map((c) => ({
      cajero: c.cajero, hasta: c.hasta, tickets: c.tickets, contadoCUP: c.contadoCUP, diferenciaCUP: c.diferenciaCUP,
    })),
    tasaUSD: estado.tasaUSD,
    tasaMLC: estado.tasaMLC,
    inventario: cuadreInventario(estado.productos),
  };
  enviar(datos.cerrarTurno(cierre, estado.productos), 'Cierre de turno');
  cerrarModal('modal-reportez');
  toast('✅ Turno cerrado. Nuevo turno abierto.');
}

function verCierre(id) {
  const c = estado.cierres.find((x) => x.id === id);
  if (!c) return;
  const fila = (a, b) => `<div class="fila"><span>${a}</span><span>${b}</span></div>`;
  const caja = c.caja || {};
  $('cierre-detalle').innerHTML = [
    `<div class="centro negrita">PUNTO 3 M - REPORTE Z</div>`,
    `<div class="centro">${esc(formatoFechaHora(c.cerradoEn))}</div>`,
    `<div class="linea"></div>`,
    `<div class="negrita">EFECTIVO EN CAJA:</div>`,
    fila('USD:', fmtMinor(caja.USD || 0, 'USD')),
    fila('MLC:', fmtMinor(caja.MLC || 0, 'MLC')),
    fila('CUP:', fmtMinor(caja.CUP || 0, 'CUP')),
    `<div class="linea"></div>`,
    fila('Tickets:', String(c.tickets)),
    fila('Ventas:', `${fmtUSD(c.ventasUSD)}${Number.isFinite(c.ventasCUP) ? ` / ${c.ventasCUP} CUP` : ''}`),
    fila('Mermas:', `-${fmtUSD(c.gastosUSD)}${Number.isFinite(c.gastosCUP) ? ` / -${c.gastosCUP} CUP` : ''}`),
    fila('<b>GANANCIA NETA:</b>', `<b>${fmtUSD(c.netoUSD)}${Number.isFinite(c.netoCUP) ? ` / ${c.netoCUP} CUP` : ''}</b>`),
    `<div class="linea"></div>`,
    `<div class="negrita">POR CAJERO:</div>`,
    ...(Array.isArray(c.porCajero) && c.porCajero.length
      ? c.porCajero.map((x) => fila(`${esc(x.cajero)} (${x.tickets})`, `${x.ventasCUP} CUP`))
      : ['<div>—</div>']),
    ...(Array.isArray(c.arqueos) && c.arqueos.length
      ? [
          `<div class="linea"></div>`,
          `<div class="negrita">ARQUEOS:</div>`,
          ...c.arqueos.map((a) =>
            fila(esc(a.cajero), a.diferenciaCUP === 0 ? 'Cuadró' : `${a.diferenciaCUP > 0 ? '+' : ''}${a.diferenciaCUP} CUP`),
          ),
        ]
      : []),
    `<div class="linea"></div>`,
    `<div class="negrita">INVENTARIO (Ini->Fin):</div>`,
    ...(Array.isArray(c.inventario) ? c.inventario : []).map(
      (i) => `<div style="display:flex; justify-content:space-between; gap:6px; border-bottom:1px dotted #ccc;"><span>${esc(i.nombre)}</span><span>${i.inicial}->${i.final}</span></div>`,
    ),
  ].join('');
  abrirModal('modal-cierre');
}

// ------------------------------------------------------------- reporte de la semana

let ultimoReporte = null;

function textoSemana(rep) {
  const l = [`PUNTO 3 M ${fechaDia(rep.desde)} a ${fechaDia(rep.hasta)}`];
  rep.dias.filter((d) => d.tickets).forEach((d) => l.push(`${fechaDia(d.ms)}: ${d.tickets}v ${fmtUSD(d.ventasUSD)} / ${d.ventasCUP} CUP`));
  l.push(`TOTAL: ${rep.tickets} ventas | ${fmtUSD(rep.ventasUSD)} USD / ${rep.ventasCUP} CUP`);
  l.push(`Neto: ${fmtUSD(rep.netoUSD)} USD / ${rep.netoCUP} CUP`);
  rep.productos.slice(0, 3).forEach((p) => l.push(`Top: ${p.nombre} x${p.cantidad}`));
  return l.join('\n');
}

function dibujarReporte(rep, deCache) {
  const tile = (t, a, b, color) => `<div class="${color} p-3 rounded-xl border dark:border-slate-700">
    <p class="text-xs font-medium">${t}</p><p class="text-lg font-extrabold">${a}</p><p class="text-xs opacity-80">${b}</p></div>`;
  $('semana-resultado').innerHTML = `
    ${deCache ? '<p class="text-xs text-amber-700 dark:text-amber-300 font-semibold mb-2">⚠️ Sin internet: se muestra solo lo guardado en este teléfono.</p>' : ''}
    <p class="text-xs text-slate-500 mb-3">${esc(fechaDia(rep.desde))} → ${esc(fechaDia(rep.hasta))}</p>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      ${tile('Ventas', `${fmtUSD(rep.ventasUSD)} USD`, cup(rep.ventasCUP), 'bg-indigo-50 dark:bg-indigo-950/40')}
      ${tile('Mermas / gastos', `${fmtUSD(rep.gastosUSD)} USD`, cup(rep.gastosCUP), 'bg-amber-50 dark:bg-amber-950/40')}
      ${tile('Ganancia neta', `${fmtUSD(rep.netoUSD)} USD`, cup(rep.netoCUP), 'bg-emerald-50 dark:bg-emerald-950/40')}
    </div>
    <h4 class="text-sm font-bold mb-1">Por día</h4>
    <div class="overflow-x-auto mb-4"><table class="w-full text-left text-sm">
      <thead class="bg-slate-50 dark:bg-slate-900 border-b dark:border-slate-700"><tr><th class="p-2">Día</th><th class="p-2">Ventas</th><th class="p-2">USD</th><th class="p-2">CUP</th></tr></thead>
      <tbody class="divide-y dark:divide-slate-700">${rep.dias
        .map((d) => `<tr><td class="p-2 capitalize">${esc(fechaDia(d.ms))}</td><td class="p-2">${d.tickets}</td><td class="p-2">${fmtUSD(d.ventasUSD)}</td><td class="p-2">${d.ventasCUP} CUP</td></tr>`)
        .join('')}
      <tr class="font-bold"><td class="p-2">Total</td><td class="p-2">${rep.tickets}</td><td class="p-2">${fmtUSD(rep.ventasUSD)}</td><td class="p-2">${rep.ventasCUP} CUP</td></tr></tbody></table></div>
    <h4 class="text-sm font-bold mb-1">Por cajero</h4>
    <div class="overflow-x-auto mb-4"><table class="w-full text-left text-sm"><tbody class="divide-y dark:divide-slate-700">${
      rep.porCajero.length
        ? rep.porCajero.map((c) => `<tr><td class="p-2">${esc(c.cajero)}</td><td class="p-2">${c.tickets} venta(s)</td><td class="p-2">${fmtUSD(c.ventasUSD)}</td><td class="p-2">${c.ventasCUP} CUP</td></tr>`).join('')
        : '<tr><td class="p-2 text-slate-400 italic">Sin ventas en este periodo.</td></tr>'
    }</tbody></table></div>
    <h4 class="text-sm font-bold mb-1">Lo más vendido</h4>
    <div class="overflow-x-auto"><table class="w-full text-left text-sm"><tbody class="divide-y dark:divide-slate-700">${
      rep.productos.length
        ? rep.productos.slice(0, 10).map((p) => `<tr><td class="p-2">${esc(p.nombre)}</td><td class="p-2">${p.cantidad} un.</td><td class="p-2">${fmtUSD(p.usd)}</td><td class="p-2">${p.cup} CUP</td></tr>`).join('')
        : '<tr><td class="p-2 text-slate-400 italic">Sin ventas en este periodo.</td></tr>'
    }</tbody></table></div>`;
  $('semana-acciones').classList.remove('hidden');
}

async function generarReporteSemana() {
  if (!exigirDueno()) return;
  const { desde, hasta } = rangoReporte($('semana-rango').value);
  $('semana-resultado').innerHTML = '<p class="text-sm text-slate-400 italic">Calculando…</p>';
  $('semana-acciones').classList.add('hidden');
  try {
    const [ventas, mermas] = await Promise.all([datos.ventasDesde(desde), datos.mermasDesde(desde)]);
    ultimoReporte = reportePeriodo({ ventas: ventas.lista, mermas, desde, hasta, tasaUSD: estado.tasaUSD });
    dibujarReporte(ultimoReporte, ventas.deCache);
  } catch (e) {
    $('semana-resultado').innerHTML = '<p class="text-sm text-red-600">No se pudo calcular el reporte. Revisa tu conexión e inténtalo otra vez.</p>';
    mostrarFallo(e, 'Reporte');
  }
}

async function copiarReporteSemana() {
  if (!ultimoReporte) return;
  try {
    await navigator.clipboard.writeText(textoSemana(ultimoReporte));
    toast('Reporte copiado');
  } catch (e) {
    toast('No se pudo copiar', 'error');
  }
}

function smsReporteSemana() {
  if (!ultimoReporte) return;
  window.location.href = enlaceSMS(estado.telefonoReporte, textoSemana(ultimoReporte));
}

function csvReporteSemana() {
  if (!ultimoReporte) return;
  const filas = [['fecha', 'ventas', 'ventas_USD', 'ventas_CUP', 'costo_USD', 'costo_CUP']];
  ultimoReporte.dias.forEach((d) =>
    filas.push([d.fecha, d.tickets, (d.ventasUSD / 100).toFixed(2), d.ventasCUP, (d.costoUSD / 100).toFixed(2), d.costoCUP]),
  );
  descargarArchivo(`reporte_${filas[1][0]}_a_${filas[filas.length - 1][0]}.csv`, filas.map((f) => f.join(',')).join('\n'), 'text/csv');
}

// ------------------------------------------------------------- respaldos y migración

function exportarRespaldo() {
  if (!exigirDueno()) return;
  const respaldo = {
    version: 3,
    fecha: new Date().toISOString(),
    config: {
      tasaUSD: estado.tasaUSD,
      tasaMLC: estado.tasaMLC,
      categorias: estado.categorias,
      subcategorias: estado.subcategorias,
      telefonoReporte: estado.telefonoReporte,
    },
    productos: estado.productos,
    // el PIN (hash y sal) no se incluye en el respaldo; hay que asignarlo de nuevo
    empleados: estado.empleados.map(({ id, nombre, activo, inicioTurno }) => ({ id, nombre, activo, inicioTurno })),
    turno: estado.turno,
    ventas: estado.ventas,
    mermas: estado.mermas,
    arqueos: estado.cortes,
  };
  descargarArchivo(`respaldo_punto3m_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(respaldo, null, 2));
}

export async function importarRespaldo(evento) {
  const archivo = evento.target.files[0];
  evento.target.value = '';
  if (!archivo || !exigirDueno()) return;

  let plan;
  try {
    plan = planDesdeRespaldo(JSON.parse(await archivo.text()));
  } catch (e) {
    plan = null;
  }
  if (!plan) return avisar('El archivo no es un respaldo válido de Punto 3 M.', 'Archivo no válido');

  const ok = await confirmar(
    `Se restaurarán ${plan.productos.length} producto(s) y ${plan.empleados.length} trabajador(es), reemplazando los que tengan el mismo identificador. Las ventas del respaldo no se importan.`,
    { titulo: '¿Restaurar respaldo?', si: 'Restaurar' },
  );
  if (!ok) return;
  const r = datos.aplicarPlan(plan, { omitirExistentes: false });
  enviar(r.promesa, 'Restaurar respaldo');
  toast(`Restaurando ${r.productos} producto(s) y ${r.empleados} trabajador(es)…`);
}

async function importarDatosAntiguos() {
  if (!exigirDueno()) return;
  let crudo;
  try {
    crudo = await datos.leerDatosAntiguosNube();
  } catch (e) {
    return mostrarFallo(e, 'No se pudo leer la versión anterior');
  }
  if (!crudo) return avisar('No se encontró información de la versión anterior (negocio/datosConfig).', 'Nada que importar');

  const plan = planDesdeRespaldo(crudo) || planDesdeAntiguo(crudo);
  const ok = await confirmar(
    `Se encontraron ${plan.productos.length} producto(s) y ${plan.empleados.length} trabajador(es) de la versión anterior. Los que ya existan aquí no se tocan.`,
    { titulo: 'Importar datos anteriores', si: 'Importar' },
  );
  if (!ok) return;
  const r = datos.aplicarPlan(plan, { omitirExistentes: true });
  enviar(r.promesa, 'Importación');
  toast(`Importando ${r.productos} producto(s) y ${r.empleados} trabajador(es)…`);
  if (r.empleados) {
    avisar('Los trabajadores importados no tienen PIN. Asígnaselo con el botón 🔑 en "Control de Asistencia".', 'Falta asignar PIN');
  }
}

// ------------------------------------------------------------- acciones

export const accionesAdmin = {
  'agregar-categoria': agregarCategoria,
  'eliminar-categoria': (d) => eliminarCategoria(d.cat),
  'agregar-subcategoria': agregarSubcategoria,
  'eliminar-subcategoria': (d) => eliminarSubcategoria(d.cat, d.sub),
  'nuevo-producto': () => abrirModalProducto(null),
  'editar-producto': (d) => abrirModalProducto(d.id),
  'guardar-producto': guardarProducto,
  'limpiar-producto': limpiarFormularioProducto,
  'quitar-foto': quitarFoto,
  'escanear-codigo-producto': () =>
    abrirEscaner(
      (codigo) => {
        $('nuevo-codigo').value = codigo;
        toast(`Código leído: ${codigo}`, 'info');
        return true;
      },
      { continuo: false },
    ),
  'limpiar-filtro-inventario': () => {
    $('input-buscador-inventario').value = '';
    renderInventario();
  },
  'limpiar-filtro-historial': () => {
    $('filtro-historial-cajero').value = 'TODOS';
    renderHistorial();
  },
  reabastecer: (d) => reabastecer(d.id),
  'eliminar-producto': (d) => eliminarProducto(d.id),
  'abrir-tasa': abrirModalTasa,
  'guardar-tasa': guardarTasa,
  'nuevo-empleado': () => abrirModalEmpleado(null),
  'pin-empleado': (d) => abrirModalEmpleado(d.id),
  'guardar-empleado': guardarEmpleado,
  'turno-empleado': (d) => alternarTurno(d.id),
  'eliminar-empleado': (d) => eliminarEmpleado(d.id),
  'abrir-merma': abrirModalMerma,
  'guardar-merma': guardarMerma,
  'abrir-reporte-z': abrirReporteZ,
  'reiniciar-turno': cerrarTurno,
  'ver-cierre': (d) => verCierre(d.id),
  'generar-semana': generarReporteSemana,
  'copiar-semana': copiarReporteSemana,
  'sms-semana': smsReporteSemana,
  'csv-semana': csvReporteSemana,
  'exportar-respaldo': exportarRespaldo,
  'importar-antiguo': importarDatosAntiguos,
};

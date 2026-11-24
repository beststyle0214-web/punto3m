// Panel de administración (solo dueño): inventario, categorías, personal, mermas,
// historial, panel financiero, Reporte Z / cierre de turno, respaldos y migración.
import { estado } from './estado.js';
import {
  $, esc, normalizar, formatoHora, formatoFechaHora, duracion, descargarArchivo,
} from './utils.js';
import { aMinor, fmtMinor, fmtUSD, precioPrincipal } from './money.js';
import { resumenTurno, cuadreInventario } from './calculos.js';
import { hashPin, nuevaSal, pinValido } from './seguridad.js';
import { planDesdeAntiguo, planDesdeRespaldo } from './migracion.js';
import {
  abrirModal, cerrarModal, toast, confirmar, avisar, pedirTexto, mostrarFallo,
} from './ui.js';
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

const resumen = () => resumenTurno({ ventas: estado.ventas, mermas: estado.mermas, categorias: estado.categorias });

// ------------------------------------------------------------- render

export function renderStockCritico() {
  const criticos = estado.productos.filter((p) => p.stock < estado.umbralStock);
  $('contenedor-stock-critico').innerHTML = criticos.length
    ? criticos
        .map(
          (p) => `<div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 rounded-lg flex justify-between items-center text-xs">
            <div><strong class="text-red-900 dark:text-red-200 block">${esc(p.nombre)}</strong>
              <span class="text-red-600 dark:text-red-400 font-bold">Quedan: ${p.stock} un. (inició con ${p.stockInicial})</span></div>
            <button type="button" data-action="reabastecer" data-id="${esc(p.id)}" class="bg-red-600 text-white px-2.5 py-1 rounded font-bold shadow">➕ Rellenar</button>
          </div>`,
        )
        .join('')
    : '<p class="text-xs text-emerald-600 dark:text-emerald-400 font-medium italic col-span-full">🟢 Todo el inventario tiene niveles óptimos de stock.</p>';
}

export function renderChipsCategorias() {
  $('contenedor-chips-categorias').innerHTML = estado.categorias
    .map(
      (c) => `<div class="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-semibold">
        <span>📁 ${esc(c)}</span>
        <button type="button" data-action="eliminar-categoria" data-cat="${esc(c)}" class="text-red-500 hover:text-red-700 font-bold ml-1" aria-label="Eliminar categoría">✕</button>
      </div>`,
    )
    .join('');
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
              <button type="button" data-action="turno-empleado" data-id="${esc(e.id)}" class="text-xs px-3 py-1.5 rounded font-bold text-white ${e.activo ? 'bg-red-600' : 'bg-emerald-600'}">${e.activo ? 'Finalizar turno' : 'Iniciar turno'}</button>
              <button type="button" data-action="pin-empleado" data-id="${esc(e.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1.5 rounded font-bold" title="Cambiar PIN">🔑</button>
              <button type="button" data-action="eliminar-empleado" data-id="${esc(e.id)}" class="text-xs bg-red-100 text-red-700 px-2 py-1.5 rounded font-bold" title="Eliminar">🗑️</button>
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
    (p) => normalizar(p.nombre).includes(filtro) || normalizar(p.categoria).includes(filtro) || (p.codigo && p.codigo.includes(filtro)),
  );
  $('tabla-inventario').innerHTML = lista.length
    ? lista
        .map(
          (p) => `<tr>
            <td class="p-3 font-medium">${esc(p.nombre)}<div class="text-[10px] text-slate-400">Cód: ${esc(p.codigo || 'S/N')}</div></td>
            <td class="p-3"><span class="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">${esc(p.categoria)}</span></td>
            <td class="p-3">${fmtUSD(p.costoCents)} / <strong class="text-indigo-600 dark:text-indigo-400">${esc(precioPrincipal(p))}</strong></td>
            <td class="p-3"><span class="text-xs text-slate-400">Ini: ${p.stockInicial}</span> ➔
              <strong class="${p.stock <= 0 ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}">${p.stock} un.</strong></td>
            <td class="p-3 text-right space-x-1 whitespace-nowrap">
              <button type="button" data-action="reabastecer" data-id="${esc(p.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">➕ Stock</button>
              <button type="button" data-action="editar-producto" data-id="${esc(p.id)}" class="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded">✏️ Editar</button>
              <button type="button" data-action="eliminar-producto" data-id="${esc(p.id)}" class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-bold">🗑️</button>
            </td></tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">${estado.productos.length ? 'No se encontraron productos.' : 'Aún no hay productos. Usa "+ Producto" o importa los datos anteriores.'}</td></tr>`;
}

export function renderMermas() {
  $('tabla-mermas').innerHTML = estado.mermas.length
    ? estado.mermas
        .map(
          (m) => `<tr><td class="p-3 text-xs">${formatoHora(m.ts)}</td><td class="p-3 font-bold">${esc(m.producto)}</td>
            <td class="p-3 text-red-600">${m.cantidad} un.</td><td class="p-3">${esc(m.motivo)}</td>
            <td class="p-3">-${fmtUSD(m.perdidaCents)}</td></tr>`,
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
            <td class="p-3">${esc(fmtMinor(v.cobrado, v.moneda))}</td>
            <td class="p-3">${fmtUSD(v.totalUSD)}</td>
            <td class="p-3 text-right"><button type="button" data-action="ver-ticket" data-id="${esc(v.id)}" aria-label="Ver ticket">🧾</button></td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No hay ventas registradas para este filtro.</td></tr>';
}

export function renderFinanciero() {
  const r = resumen();
  $('ventas-dia').textContent = `${fmtUSD(r.ventasUSD)} USD`;
  $('gastos-dia').textContent = `${fmtUSD(r.gastosUSD)} USD`;
  $('ganancia-neta-dia').textContent = `${fmtUSD(r.netoUSD)} USD`;
  $('desglose-categorias-grid').innerHTML = r.porCategoria
    .map(
      (c) => `<div class="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border dark:border-slate-700 flex justify-between items-center">
        <span class="text-xs font-bold text-slate-600 dark:text-slate-300">📁 ${esc(c.categoria)}</span>
        <div class="text-right"><span class="text-sm font-extrabold text-indigo-600 dark:text-indigo-400">${c.cup} CUP</span>
        <div class="text-[10px] text-slate-400">(${fmtUSD(c.usd)} USD)</div></div></div>`,
    )
    .join('');
}

export function renderCierres() {
  $('tabla-cierres').innerHTML = estado.cierres.length
    ? estado.cierres
        .map(
          (c) => `<tr><td class="p-3 text-xs">${formatoFechaHora(c.cerradoEn)}</td>
            <td class="p-3">${c.tickets}</td><td class="p-3">${fmtUSD(c.ventasUSD)}</td>
            <td class="p-3 font-bold">${fmtUSD(c.netoUSD)}</td>
            <td class="p-3 text-xs text-slate-500">${esc(c.cerradoPor || '')}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="5" class="p-4 text-center text-slate-400 italic">Aún no hay turnos cerrados.</td></tr>';
}

export function renderAdmin() {
  renderStockCritico();
  renderChipsCategorias();
  renderEmpleados();
  renderInventario();
  renderMermas();
  renderHistorial();
  renderFinanciero();
  renderCierres();
}

// ------------------------------------------------------------- categorías

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
  enviar(datos.guardarConfig({ categorias: estado.categorias.filter((c) => c !== cat) }), 'Categoría');
}

// ------------------------------------------------------------- productos

function llenarSelectCategorias(seleccion) {
  $('nuevo-categoria').innerHTML = estado.categorias
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join('');
  if (seleccion) $('nuevo-categoria').value = seleccion;
}

function abrirModalProducto(id) {
  if (!exigirDueno()) return;
  if (!estado.categorias.length) return toast('Primero crea una categoría', 'error');
  const p = id ? estado.productos.find((x) => x.id === id) : null;
  $('producto-modal-titulo').textContent = p ? '✏️ Editar Producto' : '📦 Nuevo Producto';
  $('nuevo-id').value = p ? p.id : '';
  $('nuevo-nombre').value = p ? p.nombre : '';
  $('nuevo-codigo').value = p ? p.codigo : '';
  llenarSelectCategorias(p ? p.categoria : null);
  $('nuevo-moneda-base').value = p ? p.moneda : 'USD';
  $('input-precio-base').value = p ? (p.moneda === 'CUP' ? p.precio : p.precio / 100) : '';
  $('nuevo-costo').value = p ? p.costoCents / 100 : '';
  $('nuevo-stock').value = '';
  $('grupo-stock-inicial').classList.toggle('hidden', !!p);
  abrirModal('modal-producto');
  setTimeout(() => $('nuevo-nombre').focus(), 30);
}

function codigoLibre() {
  let codigo;
  do codigo = `750${Math.floor(1000 + Math.random() * 9000)}`;
  while (estado.productos.some((p) => p.codigo === codigo));
  return codigo;
}

function guardarProducto() {
  if (!exigirDueno()) return;
  const id = $('nuevo-id').value;
  const nombre = $('nuevo-nombre').value.trim();
  const moneda = $('nuevo-moneda-base').value === 'CUP' ? 'CUP' : 'USD';
  const precio = aMinor($('input-precio-base').value, moneda);
  const txtCosto = $('nuevo-costo').value.trim();
  const costoCents = txtCosto === '' ? 0 : aMinor(txtCosto, 'USD');
  const codigo = $('nuevo-codigo').value.trim() || codigoLibre();
  const categoria = $('nuevo-categoria').value;

  if (!nombre) return toast('Escribe un nombre', 'error');
  if (!Number.isFinite(precio) || precio <= 0) return toast('Escribe un precio válido', 'error');
  if (!Number.isFinite(costoCents) || costoCents < 0) return toast('El costo no es válido', 'error');
  if (estado.productos.some((p) => p.codigo && p.codigo === codigo && p.id !== id)) {
    return toast(`El código ${codigo} ya lo usa otro producto`, 'error');
  }

  if (id) {
    enviar(datos.actualizarProducto(id, { nombre, codigo, categoria, moneda, precio, costoCents }), 'Producto');
  } else {
    const stock = parseInt($('nuevo-stock').value, 10) || 0;
    if (stock < 0) return toast('El stock no puede ser negativo', 'error');
    enviar(
      datos.crearProducto({ nombre, codigo, categoria, moneda, precio, costoCents, stockInicial: stock, stock }),
      'Producto',
    );
  }
  cerrarModal('modal-producto');
}

async function reabastecer(id) {
  if (!exigirDueno()) return;
  const p = estado.productos.find((x) => x.id === id);
  if (!p) return;
  const txt = await pedirTexto(`Unidades a sumar a "${p.nombre}"`, { valor: '10', inputmode: 'numeric', si: 'Sumar' });
  if (txt === null) return;
  const n = parseInt(txt, 10);
  if (!Number.isFinite(n) || n <= 0) return toast('Escribe una cantidad mayor que 0', 'error');
  enviar(datos.reabastecerProducto(id, n), 'Stock');
}

async function eliminarProducto(id) {
  if (!exigirDueno()) return;
  const p = estado.productos.find((x) => x.id === id);
  if (!p) return;
  if (!(await confirmar(`¿Eliminar "${p.nombre}" del inventario?`, { peligro: true, si: 'Eliminar' }))) return;
  enviar(datos.eliminarProducto(id), 'Producto');
}

// ------------------------------------------------------------- tasa

function abrirModalTasa() {
  if (!exigirDueno()) return;
  $('input-tasa-usd').value = estado.tasaUSD;
  $('input-tasa-mlc').value = estado.tasaMLC;
  abrirModal('modal-tasa');
}

function guardarTasa() {
  if (!exigirDueno()) return;
  const usd = parseFloat($('input-tasa-usd').value);
  const mlc = parseFloat($('input-tasa-mlc').value);
  if (!(usd > 0) || !(mlc > 0)) return toast('Las tasas deben ser números mayores que 0', 'error');
  enviar(datos.guardarConfig({ tasaUSD: usd, tasaMLC: mlc }), 'Tasas');
  cerrarModal('modal-tasa');
  toast('Tasas actualizadas');
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
    .map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)} (Stock: ${p.stock})</option>`)
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
  enviar(datos.registrarMerma(p, cantidad, motivo), 'Merma');
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
  $('rz-ventas').textContent = fmtUSD(r.ventasUSD);
  $('rz-gastos').textContent = `-${fmtUSD(r.gastosUSD)}`;
  $('rz-neto').textContent = `${fmtUSD(r.netoUSD)} USD`;

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
  abrirModal('modal-reportez');
}

async function cerrarTurno() {
  if (!exigirDueno()) return;
  if (!estado.turno) return toast('No hay un turno abierto', 'error');
  const ok = await confirmar(
    'Se guardará el reporte Z, la caja volverá a 0 y el stock actual será el stock inicial del nuevo turno.',
    { titulo: '¿Cerrar el turno?', si: 'Cerrar turno', peligro: true },
  );
  if (!ok) return;

  const r = resumen();
  const cierre = {
    turnoId: estado.turno.id,
    inicio: estado.turno.inicio,
    cerradoEn: Date.now(),
    cerradoPor: estado.user.email,
    tickets: r.tickets,
    ventasUSD: r.ventasUSD,
    costoUSD: r.costoUSD,
    gastosUSD: r.gastosUSD,
    netoUSD: r.netoUSD,
    caja: r.caja,
    porCategoria: r.porCategoria,
    tasaUSD: estado.tasaUSD,
    tasaMLC: estado.tasaMLC,
    inventario: cuadreInventario(estado.productos),
  };
  enviar(datos.cerrarTurno(cierre, estado.productos), 'Cierre de turno');
  cerrarModal('modal-reportez');
  toast('✅ Turno cerrado. Nuevo turno abierto.');
}

// ------------------------------------------------------------- respaldos y migración

function exportarRespaldo() {
  if (!exigirDueno()) return;
  const respaldo = {
    version: 2,
    fecha: new Date().toISOString(),
    config: { tasaUSD: estado.tasaUSD, tasaMLC: estado.tasaMLC, categorias: estado.categorias },
    productos: estado.productos,
    // el PIN (hash y sal) no se incluye en el respaldo; hay que asignarlo de nuevo
    empleados: estado.empleados.map(({ id, nombre, activo, inicioTurno }) => ({ id, nombre, activo, inicioTurno })),
    turno: estado.turno,
    ventas: estado.ventas,
    mermas: estado.mermas,
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
  'nuevo-producto': () => abrirModalProducto(null),
  'editar-producto': (d) => abrirModalProducto(d.id),
  'guardar-producto': guardarProducto,
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
  'exportar-respaldo': exportarRespaldo,
  'importar-antiguo': importarDatosAntiguos,
};

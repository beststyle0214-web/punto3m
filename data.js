// Capa de datos: escuchas en tiempo real y escrituras a Firestore.
//
// Modelo (una colección por tipo, en vez de un solo documento gigante):
//   config/general   { tasaUSD, tasaMLC, categorias[] }
//   turno/actual     { id, inicio }
//   productos/{id}   { codigo, nombre, categoria, moneda, precio, costoCents, stockInicial, stock }
//   empleados/{id}   { nombre, activo, inicioTurno(ms), sal, pinHash }
//   ventas/{id}      ticket completo, con turnoId
//   mermas/{id}      con turnoId
//   cierres/{id}     reporte Z guardado al cerrar cada turno
//
// El stock se cambia con FieldValue.increment(): dos cajas vendiendo a la vez
// no se pisan (antes ganaba la última en guardar el inventario completo).

import { db, FieldValue } from './firebase.js';
import { estado } from './estado.js';
import { aMillis } from './utils.js';
import { CATEGORIAS_POR_DEFECTO, TASAS_POR_DEFECTO } from './config.js';

const col = (nombre) => db.collection(nombre);

let bajas = []; // funciones para dejar de escuchar
let bajasTurno = [];

export const nuevoIdTurno = () =>
  `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;

function normalizarProducto(id, d) {
  return {
    id,
    codigo: d.codigo || '',
    nombre: d.nombre || 'Sin nombre',
    categoria: d.categoria || 'Varios',
    moneda: d.moneda === 'CUP' ? 'CUP' : 'USD',
    precio: Number(d.precio) || 0,
    costoCents: Number(d.costoCents) || 0,
    stockInicial: Number(d.stockInicial) || 0,
    stock: Number(d.stock) || 0,
  };
}

// ---------------------------------------------------------------- escuchas

export function detenerEscuchas() {
  bajas.forEach((f) => f());
  bajasTurno.forEach((f) => f());
  bajas = [];
  bajasTurno = [];
}

function escucharTurno(turnoId, cambio, error) {
  bajasTurno.forEach((f) => f());
  bajasTurno = [];
  estado.ventas = [];
  estado.mermas = [];
  if (!turnoId) return;

  bajasTurno.push(
    col('ventas')
      .where('turnoId', '==', turnoId)
      .onSnapshot((s) => {
        estado.ventas = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.ts - a.ts);
        cambio();
      }, error),
  );
  bajasTurno.push(
    col('mermas')
      .where('turnoId', '==', turnoId)
      .onSnapshot((s) => {
        estado.mermas = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.ts - a.ts);
        cambio();
      }, error),
  );
}

export function iniciarEscuchas(cambio, fallo) {
  detenerEscuchas();
  estado.cargado = { config: false, productos: false, empleados: false, turno: false };
  estado.errorCarga = null;
  const error = (e) => {
    console.error('Firestore:', e);
    estado.errorCarga = e;
    fallo(e);
  };

  bajas.push(
    col('config')
      .doc('general')
      .onSnapshot((s) => {
        estado.configExiste = s.exists;
        if (s.exists) {
          const d = s.data();
          if (Number(d.tasaUSD) > 0) estado.tasaUSD = Number(d.tasaUSD);
          if (Number(d.tasaMLC) > 0) estado.tasaMLC = Number(d.tasaMLC);
          estado.categorias = Array.isArray(d.categorias) ? d.categorias : [];
        }
        estado.cargado.config = true;
        cambio();
      }, error),
  );

  bajas.push(
    col('productos').onSnapshot((s) => {
      estado.productos = s.docs
        .map((d) => normalizarProducto(d.id, d.data()))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      estado.cargado.productos = true;
      cambio();
    }, error),
  );

  bajas.push(
    col('empleados').onSnapshot((s) => {
      estado.empleados = s.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            nombre: x.nombre || 'Sin nombre',
            activo: !!x.activo,
            inicioTurno: aMillis(x.inicioTurno),
            sal: x.sal || null,
            pinHash: x.pinHash || null,
          };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      estado.cargado.empleados = true;
      cambio();
    }, error),
  );

  bajas.push(
    col('turno')
      .doc('actual')
      .onSnapshot((s) => {
        if (!s.exists) {
          estado.turno = null;
          escucharTurno(null, cambio, error);
        } else {
          const d = s.data();
          const nuevo = { id: d.id, inicio: aMillis(d.inicio) };
          const cambioDeTurno = !estado.turno || estado.turno.id !== nuevo.id;
          estado.turno = nuevo;
          if (cambioDeTurno) escucharTurno(nuevo.id, cambio, error);
        }
        estado.cargado.turno = true;
        cambio();
      }, error),
  );

  if (estado.esDueno) {
    bajas.push(
      col('cierres')
        .orderBy('cerradoEn', 'desc')
        .limit(30)
        .onSnapshot((s) => {
          estado.cierres = s.docs.map((d) => ({ id: d.id, ...d.data() }));
          cambio();
        }, (e) => console.warn('No se pudieron leer los cierres:', e.code)),
    );
  }
}

// -------------------------------------------------------------- escrituras

/** Aplica operaciones en lotes de 400 (el límite de Firestore es 500). Devuelve una promesa. */
function enLotes(operaciones) {
  const lotes = [];
  for (let i = 0; i < operaciones.length; i += 400) {
    const batch = db.batch();
    operaciones.slice(i, i + 400).forEach((op) => op(batch));
    lotes.push(batch);
  }
  // Se envían todos en orden; Firestore respeta el orden de las escrituras.
  return Promise.all(lotes.map((b) => b.commit()));
}

export function sembrarDatosIniciales() {
  const batch = db.batch();
  if (!estado.configExiste) {
    batch.set(col('config').doc('general'), {
      tasaUSD: TASAS_POR_DEFECTO.usd,
      tasaMLC: TASAS_POR_DEFECTO.mlc,
      categorias: CATEGORIAS_POR_DEFECTO,
    });
  }
  if (!estado.turno) {
    batch.set(col('turno').doc('actual'), { id: nuevoIdTurno(), inicio: Date.now() });
  }
  return batch.commit();
}

export const guardarConfig = (parcial) => col('config').doc('general').set(parcial, { merge: true });

// productos
export const crearProducto = (datos) => col('productos').add({ ...datos, creado: Date.now() });
export const actualizarProducto = (id, datos) => col('productos').doc(id).update(datos);
export const eliminarProducto = (id) => col('productos').doc(id).delete();
export const reabastecerProducto = (id, n) =>
  col('productos')
    .doc(id)
    .update({ stock: FieldValue.increment(n), stockInicial: FieldValue.increment(n) });

// empleados
export const crearEmpleado = (datos) => col('empleados').add(datos);
export const actualizarEmpleado = (id, datos) => col('empleados').doc(id).update(datos);
export const eliminarEmpleado = (id) => col('empleados').doc(id).delete();

/**
 * Registra la venta y descuenta el stock en una sola operación atómica.
 * Devuelve { id, promesa } SIN esperar al servidor: con internet caído la venta
 * se guarda en el dispositivo y se envía sola al reconectar.
 */
export function registrarVenta(venta) {
  const batch = db.batch();
  const ref = col('ventas').doc();
  batch.set(ref, venta);
  venta.items.forEach((i) => {
    batch.update(col('productos').doc(i.id), { stock: FieldValue.increment(-i.cantidad) });
  });
  return { id: ref.id, promesa: batch.commit() };
}

export function registrarMerma(producto, cantidad, motivo) {
  const batch = db.batch();
  batch.update(col('productos').doc(producto.id), { stock: FieldValue.increment(-cantidad) });
  batch.set(col('mermas').doc(), {
    turnoId: estado.turno.id,
    ts: Date.now(),
    productoId: producto.id,
    producto: producto.nombre,
    cantidad,
    motivo,
    perdidaCents: (producto.costoCents || 0) * cantidad,
  });
  return batch.commit();
}

/**
 * Cierra el turno: guarda el reporte Z (cierres/{turnoId}), deja el stock actual como
 * stock inicial del nuevo turno y abre el turno nuevo (la caja arranca en 0).
 * El cambio de turno va en el ÚLTIMO lote: si algo falla antes, se puede reintentar.
 */
export function cerrarTurno(cierre, productos) {
  const operaciones = [
    (b) => b.set(col('cierres').doc(cierre.turnoId), cierre),
    ...productos.map((p) => (b) => b.update(col('productos').doc(p.id), { stockInicial: p.stock })),
    (b) => b.set(col('turno').doc('actual'), { id: nuevoIdTurno(), inicio: Date.now() }),
  ];
  return enLotes(operaciones);
}

// ----------------------------------------------------- importar / migrar

export async function leerDatosAntiguosNube() {
  const doc = await col('negocio').doc('datosConfig').get();
  return doc.exists ? doc.data() : null;
}

/**
 * Aplica un plan de migracion.js.
 * omitirExistentes = true: no pisa productos/empleados que ya existen (migración repetible).
 */
export function aplicarPlan(plan, { omitirExistentes }) {
  const ops = [];
  const idsProd = new Set(estado.productos.map((p) => p.id));
  const idsEmp = new Set(estado.empleados.map((e) => e.id));

  const config = {};
  if (!omitirExistentes) {
    if (plan.config.tasaUSD) config.tasaUSD = plan.config.tasaUSD;
    if (plan.config.tasaMLC) config.tasaMLC = plan.config.tasaMLC;
  }
  const categorias = [...new Set([...estado.categorias, ...plan.config.categorias])];
  if (categorias.length) config.categorias = categorias;
  if (Object.keys(config).length) {
    ops.push((b) => b.set(col('config').doc('general'), config, { merge: true }));
  }

  let productos = 0;
  let empleados = 0;
  plan.productos.forEach((p) => {
    if (omitirExistentes && idsProd.has(p.id)) return;
    productos++;
    ops.push((b) => b.set(col('productos').doc(p.id), p.datos, { merge: true }));
  });
  plan.empleados.forEach((e) => {
    if (omitirExistentes && idsEmp.has(e.id)) return;
    empleados++;
    ops.push((b) => b.set(col('empleados').doc(e.id), e.datos, { merge: true }));
  });

  return { productos, empleados, promesa: enLotes(ops) };
}

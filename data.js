// Capa de datos: escuchas en tiempo real y escrituras a Firestore.
//
// Modelo (una colección por tipo, en vez de un solo documento gigante):
//   config/general   { tasaUSD, tasaMLC, categorias[], subcategorias[{cat,nombre}], telefonoReporte }
//   turno/actual     { id, inicio }
//   productos/{id}   { codigo, nombre, variante, categoria, subcategoria, foto, moneda, precio,
//                      costo, costoMoneda, costoCents, stockInicial, stock }
//   empleados/{id}   { nombre, activo, inicioTurno(ms), corteTs(ms), sal, pinHash }
//   ventas/{id}      ticket completo, con turnoId
//   mermas/{id}      con turnoId
//   cortes/{id}      arqueo cerrado por un cajero (turnoId, cajero, esperado, contado, diferencia)
//   cierres/{id}     reporte Z guardado al cerrar cada turno
//
// El stock se cambia con FieldValue.increment(): dos cajas vendiendo a la vez
// no se pisan (antes ganaba la última en guardar el inventario completo).

import { db, FieldValue } from './firebase.js';
import { estado } from './estado.js';
import { aMillis, fotoValida, conTiempo } from './utils.js';
import { CATEGORIAS_POR_DEFECTO, TASAS_POR_DEFECTO, DIAS_CIERRES } from './config.js';
import { costoUnitUSD, costoUnitCUP } from './money.js';

const col = (nombre) => db.collection(nombre);

let bajas = []; // funciones para dejar de escuchar
let bajasTurno = [];

// ---------------------------------------------------------------- eventos (para los avisos)
// Se avisa de: ventas nuevas, producto nuevo y cambios de stock, pero solo de lo que ocurre
// DESPUÉS de la primera carga (para no llenar el teléfono de avisos al abrir la app).

const oyentes = [];
export const alEvento = (fn) => oyentes.push(fn);
const emitir = (ev) =>
  oyentes.forEach((fn) => {
    try {
      fn(ev);
    } catch (e) {
      console.error('Aviso:', e);
    }
  });

export const nuevoIdTurno = () =>
  `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`;

export function normalizarProducto(id, d) {
  const costoMoneda = d.costoMoneda === 'CUP' ? 'CUP' : 'USD';
  const costo = d.costo !== undefined && d.costo !== null ? Number(d.costo) || 0 : Number(d.costoCents) || 0;
  return {
    id,
    codigo: d.codigo || '',
    nombre: d.nombre || 'Sin nombre',
    variante: d.variante || '',
    categoria: d.categoria || 'Varios',
    subcategoria: d.subcategoria || '',
    foto: fotoValida(d.foto) ? d.foto : '',
    moneda: d.moneda === 'CUP' ? 'CUP' : 'USD',
    precio: Number(d.precio) || 0,
    costo,
    costoMoneda,
    costoCents: costoMoneda === 'USD' ? costo : 0,
    stockInicial: Number(d.stockInicial) || 0,
    stock: Number(d.stock) || 0,
  };
}

function normalizarSubcategorias(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s.cat === 'string' && typeof s.nombre === 'string' && s.nombre.trim())
    .map((s) => ({ cat: s.cat, nombre: s.nombre.trim() }));
}

/** Crea una función que recibe cada "snapshot" y avisa solo de los documentos añadidos después de la carga inicial. */
function observadorDeNuevos(procesar) {
  let base = false;
  return (snap) => {
    if (!base) {
      if (!snap.metadata.fromCache) base = true; // la primera copia real del servidor es la base
      return;
    }
    const nuevos = snap
      .docChanges()
      .filter((c) => c.type === 'added')
      .map((c) => ({ id: c.doc.id, ...c.doc.data() }));
    if (nuevos.length) procesar(nuevos);
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
  estado.cortes = [];
  estado.pendientes = 0;
  if (!turnoId) return;

  const avisarVentas = observadorDeNuevos((ventas) => emitir({ tipo: 'ventas', ventas }));
  bajasTurno.push(
    col('ventas')
      .where('turnoId', '==', turnoId)
      .onSnapshot((s) => {
        estado.ventas = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.ts - a.ts);
        estado.pendientes = s.docs.filter((d) => d.metadata.hasPendingWrites).length;
        cambio();
        avisarVentas(s);
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
  if (estado.esDueno) {
    bajasTurno.push(
      col('cortes')
        .where('turnoId', '==', turnoId)
        .onSnapshot((s) => {
          estado.cortes = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.hasta - a.hasta);
          cambio();
        }, (e) => console.warn('No se pudieron leer los arqueos:', e.code)),
    );
  }
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
          estado.subcategorias = normalizarSubcategorias(d.subcategorias);
          if (typeof d.telefonoReporte === 'string' && d.telefonoReporte.trim()) {
            estado.telefonoReporte = d.telefonoReporte.trim();
          }
        }
        estado.cargado.config = true;
        cambio();
      }, error),
  );

  let baseProductos = false;
  bajas.push(
    col('productos').onSnapshot((s) => {
      const antes = new Map(estado.productos.map((p) => [p.id, p.stock]));
      estado.productos = s.docs
        .map((d) => normalizarProducto(d.id, d.data()))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      estado.cargado.productos = true;
      cambio();

      if (!baseProductos) {
        if (!s.metadata.fromCache) baseProductos = true;
        return;
      }
      s.docChanges().forEach((c) => {
        const producto = normalizarProducto(c.doc.id, c.doc.data());
        if (c.type === 'added') emitir({ tipo: 'producto-nuevo', producto });
        else if (c.type === 'modified') {
          const previo = antes.get(producto.id);
          if (previo !== undefined && previo !== producto.stock) {
            emitir({ tipo: 'stock', producto, antes: previo, ahora: producto.stock });
          }
        }
      });
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
            corteTs: aMillis(x.corteTs),
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
    // Turnos cerrados de los últimos DIAS_CIERRES días (antes se pedían "los últimos 30" sin fecha).
    const desde = Date.now() - DIAS_CIERRES * 24 * 3600 * 1000;
    bajas.push(
      col('cierres')
        .where('cerradoEn', '>=', desde)
        .orderBy('cerradoEn', 'desc')
        .onSnapshot(
          (s) => {
            estado.errorCierres = null;
            estado.cierres = s.docs.map((d) => ({ id: d.id, ...d.data() }));
            cambio();
          },
          (e) => {
            console.warn('No se pudieron leer los cierres:', e.code);
            estado.errorCierres = e.code || 'error';
            cambio();
          },
        ),
    );
  }
}

// ---------------------------------------------------------------- lecturas históricas

async function leerConRespaldo(consulta) {
  try {
    return await conTiempo(consulta.get(), 15000);
  } catch (e) {
    if (e && e.code === 'permission-denied') throw e;
    return consulta.get({ source: 'cache' }); // sin internet: lo que haya guardado en el aparato
  }
}

/** Ventas desde una fecha (para el reporte semanal). { lista, deCache } */
export async function ventasDesde(ms) {
  const s = await leerConRespaldo(col('ventas').where('ts', '>=', ms));
  return { lista: s.docs.map((d) => ({ id: d.id, ...d.data() })), deCache: s.metadata.fromCache };
}

export async function mermasDesde(ms) {
  const s = await leerConRespaldo(col('mermas').where('ts', '>=', ms));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------- escrituras

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
      subcategorias: [],
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
/** Un cajero cambia su propio PIN (las reglas solo le dejan tocar estos dos campos). */
export const cambiarPinEmpleado = (id, sal, pinHash) => col('empleados').doc(id).update({ sal, pinHash });

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
    perdidaCents: costoUnitUSD(producto, estado.tasaUSD) * cantidad,
    perdidaCUP: costoUnitCUP(producto, estado.tasaUSD) * cantidad,
  });
  return batch.commit();
}

/**
 * Cierra el arqueo de un cajero: guarda el corte y marca desde dónde empieza su próximo arqueo.
 * (Así sus ventas anteriores ya no se vuelven a contar.)
 */
export function registrarCorte(corte, empleadoId) {
  const batch = db.batch();
  batch.set(col('cortes').doc(), corte);
  batch.update(col('empleados').doc(empleadoId), { corteTs: corte.hasta });
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

const unirSubcategorias = (a, b) => {
  const visto = new Set();
  return [...a, ...b].filter((s) => {
    const k = `${s.cat}|${s.nombre}`;
    if (visto.has(k)) return false;
    visto.add(k);
    return true;
  });
};

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
  const subs = unirSubcategorias(estado.subcategorias, plan.config.subcategorias || []);
  if (subs.length) config.subcategorias = subs;
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

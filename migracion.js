// Conversión de datos de la versión anterior (un solo documento "negocio/datosConfig"
// o un archivo de respaldo .json) al modelo nuevo (una colección por tipo, dinero en enteros).
// Devuelve un "plan" { config, productos, empleados } que data.js aplica a Firestore.

import { aMillis } from './utils.js';

const entero = (v, def = 0) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : def);

export function productoDesdeAntiguo(p) {
  const stock = entero(p.stock);
  return {
    id: String(p.id),
    datos: {
      codigo: String(p.codigo || ''),
      nombre: String(p.nombre || 'Sin nombre'),
      categoria: String(p.categoria || 'Varios'),
      moneda: 'USD',
      precio: Math.round((Number(p.precioUSD) || 0) * 100),
      costoCents: Math.round((Number(p.costo) || 0) * 100),
      stockInicial: p.stockInicial === undefined ? stock : entero(p.stockInicial),
      stock,
    },
  };
}

export function empleadoDesdeAntiguo(e) {
  const activo = !!e.activo;
  return {
    id: String(e.id),
    datos: {
      nombre: String(e.nombre || 'Sin nombre'),
      activo,
      inicioTurno: activo ? aMillis(e.horaInicioTurno) || Date.now() : null,
    },
  };
}

function productoNuevo(p) {
  return {
    id: String(p.id),
    datos: {
      codigo: String(p.codigo || ''),
      nombre: String(p.nombre || 'Sin nombre'),
      categoria: String(p.categoria || 'Varios'),
      moneda: p.moneda === 'CUP' ? 'CUP' : 'USD',
      precio: entero(p.precio),
      costoCents: entero(p.costoCents),
      stockInicial: entero(p.stockInicial, entero(p.stock)),
      stock: entero(p.stock),
    },
  };
}

/** Plan a partir del documento de la versión anterior o de su respaldo .json. */
export function planDesdeAntiguo(d) {
  return {
    config: {
      tasaUSD: Number(d.tasaUSD) > 0 ? Number(d.tasaUSD) : null,
      tasaMLC: Number(d.tasaMLC) > 0 ? Number(d.tasaMLC) : null,
      categorias: Array.isArray(d.categorias) ? d.categorias.map(String) : [],
    },
    productos: (Array.isArray(d.inventario) ? d.inventario : []).map(productoDesdeAntiguo),
    empleados: (Array.isArray(d.listaEmpleados) ? d.listaEmpleados : []).map(empleadoDesdeAntiguo),
  };
}

/** Plan a partir de un respaldo del formato nuevo (versión 2). */
export function planDesdeRespaldoNuevo(d) {
  const c = d.config || {};
  return {
    config: {
      tasaUSD: Number(c.tasaUSD) > 0 ? Number(c.tasaUSD) : null,
      tasaMLC: Number(c.tasaMLC) > 0 ? Number(c.tasaMLC) : null,
      categorias: Array.isArray(c.categorias) ? c.categorias.map(String) : [],
    },
    productos: (Array.isArray(d.productos) ? d.productos : []).map(productoNuevo),
    empleados: (Array.isArray(d.empleados) ? d.empleados : []).map((e) => ({
      id: String(e.id),
      datos: {
        nombre: String(e.nombre || 'Sin nombre'),
        activo: !!e.activo,
        inicioTurno: e.activo ? aMillis(e.inicioTurno) || Date.now() : null,
      },
    })),
  };
}

/** Detecta el formato del .json y devuelve el plan, o null si no se reconoce. */
export function planDesdeRespaldo(d) {
  if (!d || typeof d !== 'object') return null;
  if (Array.isArray(d.inventario)) return planDesdeAntiguo(d);
  if (Array.isArray(d.productos)) return planDesdeRespaldoNuevo(d);
  return null;
}

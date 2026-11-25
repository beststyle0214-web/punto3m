// Cálculos de turnos, arqueos y reportes a partir de ventas y mermas (sin DOM, fáciles de probar).
// La caja no se guarda como número suelto: se calcula desde las ventas,
// así nunca puede quedar desfasada de lo realmente vendido.

import { fmtUSD } from './money.js';

const TASA_DEFECTO = 320;

// ---- valores de una venta / merma en CUP (las ventas viejas no traían todos los campos)

const cupVenta = (v, tasa) => (Number.isFinite(v.totalCUP) ? v.totalCUP : Math.round(((v.totalUSD || 0) * (v.tasaUSD || tasa)) / 100));
const costoCupVenta = (v, tasa) =>
  Number.isFinite(v.costoCUP) ? v.costoCUP : Math.round(((v.costoCents || 0) * (v.tasaUSD || tasa)) / 100);
const perdidaCup = (m, tasa) =>
  Number.isFinite(m.perdidaCUP) ? m.perdidaCUP : Math.round(((m.perdidaCents || 0) * tasa) / 100);

const cajaVacia = () => ({ USD: 0, MLC: 0, CUP: 0 });

/**
 * @param ventas     tickets del turno
 * @param mermas     mermas del turno
 * @param categorias nombres de categorías (para mostrarlas aunque no tengan ventas)
 * @param tasaUSD    CUP por 1 USD (para convertir lo que no trae su valor en CUP)
 */
export function resumenTurno({ ventas, mermas, categorias, tasaUSD = TASA_DEFECTO }) {
  const caja = cajaVacia();
  const porCat = new Map(categorias.map((c) => [c, { usd: 0, cup: 0 }]));
  const porCajero = new Map();
  let ventasUSD = 0;
  let ventasCUP = 0;
  let costoUSD = 0;
  let costoCUP = 0;
  let gastosUSD = 0;
  let gastosCUP = 0;

  for (const v of ventas) {
    caja[v.moneda] = (caja[v.moneda] || 0) + v.cobrado; // el vuelto ya sale del cobrado
    const cup = cupVenta(v, tasaUSD);
    ventasUSD += v.totalUSD;
    ventasCUP += cup;
    costoUSD += v.costoCents || 0;
    costoCUP += costoCupVenta(v, tasaUSD);

    const clave = v.cajeroId || v.cajero || '—';
    if (!porCajero.has(clave)) {
      porCajero.set(clave, { cajero: v.cajero || '—', tickets: 0, ventasUSD: 0, ventasCUP: 0, caja: cajaVacia() });
    }
    const pc = porCajero.get(clave);
    pc.tickets++;
    pc.ventasUSD += v.totalUSD;
    pc.ventasCUP += cup;
    pc.caja[v.moneda] = (pc.caja[v.moneda] || 0) + v.cobrado;

    for (const i of v.items) {
      if (!porCat.has(i.categoria)) porCat.set(i.categoria, { usd: 0, cup: 0 });
      const c = porCat.get(i.categoria);
      c.usd += i.usdUnit * i.cantidad;
      c.cup += i.cupUnit * i.cantidad;
    }
  }
  for (const m of mermas) {
    gastosUSD += m.perdidaCents || 0;
    gastosCUP += perdidaCup(m, tasaUSD);
  }

  return {
    caja,
    tickets: ventas.length,
    ventasUSD,
    ventasCUP,
    costoUSD,
    costoCUP,
    gastosUSD,
    gastosCUP,
    gananciaBrutaUSD: ventasUSD - costoUSD,
    gananciaBrutaCUP: ventasCUP - costoCUP,
    netoUSD: ventasUSD - costoUSD - gastosUSD,
    netoCUP: ventasCUP - costoCUP - gastosCUP,
    porCategoria: [...porCat].map(([categoria, v]) => ({ categoria, usd: v.usd, cup: v.cup })),
    porCajero: [...porCajero.values()],
  };
}

/** Cuadre de inventario: inicial -> final y cuántas unidades salieron. */
export function cuadreInventario(productos) {
  return productos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    inicial: p.stockInicial,
    final: p.stock,
    salidas: p.stockInicial - p.stock,
  }));
}

// ------------------------------------------------------------------ arqueo por cajero

/**
 * Ventas que le tocan a UN cajero desde su último arqueo (corte).
 * Así el arqueo de un cajero nunca arrastra las ventas de otro ni las de arqueos ya cerrados.
 */
export function ventasDeCajero(ventas, cajeroId, desdeTs) {
  const desde = Number.isFinite(desdeTs) ? desdeTs : 0;
  return ventas.filter((v) => v.cajeroId === cajeroId && v.ts > desde);
}

/** Lo que debería haber en la gaveta según esas ventas (por moneda). */
export function esperadoArqueo(ventasCajero) {
  const caja = cajaVacia();
  for (const v of ventasCajero) caja[v.moneda] = (caja[v.moneda] || 0) + v.cobrado;
  return { caja, tickets: ventasCajero.length };
}

/** Diferencia de arqueo: contado - esperado (positivo = sobra, negativo = falta). */
export const diferenciaArqueo = (contado, esperado) => contado - esperado;

// ------------------------------------------------------------------ reporte de la semana

const dos = (n) => String(n).padStart(2, '0');

export function claveDia(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export function inicioDeDia(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Rangos de fechas del reporte.
 *  'ultimos7' = hoy y los 6 días anteriores; 'semana' = lunes de esta semana hasta hoy;
 *  'pasada'   = lunes a domingo de la semana anterior.
 */
export function rangoReporte(modo, ahora = Date.now()) {
  const hoy = inicioDeDia(ahora);
  const dia = 24 * 3600 * 1000;
  const enDias = (ms, n) => {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };
  const lunes = enDias(hoy, -((new Date(hoy).getDay() + 6) % 7));
  if (modo === 'semana') return { desde: lunes, hasta: ahora };
  if (modo === 'pasada') return { desde: enDias(lunes, -7), hasta: lunes - 1 };
  return { desde: enDias(hoy, -6), hasta: ahora, _dia: dia };
}

/** Resumen por día, por cajero y por producto de un periodo. */
export function reportePeriodo({ ventas, mermas = [], desde, hasta, tasaUSD = TASA_DEFECTO }) {
  const dias = new Map();
  const cursor = new Date(inicioDeDia(desde));
  const fin = inicioDeDia(hasta);
  while (cursor.getTime() <= fin) {
    dias.set(claveDia(cursor.getTime()), {
      fecha: claveDia(cursor.getTime()),
      ms: cursor.getTime(),
      tickets: 0,
      ventasUSD: 0,
      ventasCUP: 0,
      costoUSD: 0,
      costoCUP: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  const enRango = (ts) => ts >= desde && ts <= hasta;
  const prods = new Map();

  const lista = ventas.filter((v) => enRango(v.ts));
  for (const v of lista) {
    const d = dias.get(claveDia(v.ts));
    if (d) {
      d.tickets++;
      d.ventasUSD += v.totalUSD;
      d.ventasCUP += cupVenta(v, tasaUSD);
      d.costoUSD += v.costoCents || 0;
      d.costoCUP += costoCupVenta(v, tasaUSD);
    }
    for (const i of v.items) {
      const clave = i.id || i.nombre;
      if (!prods.has(clave)) prods.set(clave, { nombre: i.nombre, cantidad: 0, usd: 0, cup: 0 });
      const p = prods.get(clave);
      p.cantidad += i.cantidad;
      p.usd += i.usdUnit * i.cantidad;
      p.cup += i.cupUnit * i.cantidad;
    }
  }

  const base = resumenTurno({ ventas: lista, mermas: mermas.filter((m) => enRango(m.ts)), categorias: [], tasaUSD });
  return {
    desde,
    hasta,
    ...base,
    dias: [...dias.values()],
    productos: [...prods.values()].sort((a, b) => b.cantidad - a.cantidad),
  };
}

// ------------------------------------------------------------------ textos (SMS / copiar)

const pad = (n) => String(n).padStart(2, '0');
const fechaCorta = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Reporte corto del turno, pensado para un SMS (sin tildes raras ni símbolos largos). */
export function textoReporteSMS({ resumen, ts = Date.now(), pendientes = 0, stockBajo = [] }) {
  const r = resumen;
  const lineas = [
    `PUNTO 3 M ${fechaCorta(ts)}`,
    `Ventas: ${r.tickets} | ${fmtUSD(r.ventasUSD)} USD / ${r.ventasCUP} CUP`,
    `Caja: CUP ${r.caja.CUP} | USD ${fmtUSD(r.caja.USD)} | MLC ${fmtUSD(r.caja.MLC)}`,
    `Neto: ${fmtUSD(r.netoUSD)} USD / ${r.netoCUP} CUP`,
  ];
  r.porCajero.slice(0, 5).forEach((c) => lineas.push(`${c.cajero}: ${c.tickets} v. ${c.ventasCUP} CUP`));
  if (stockBajo.length) lineas.push(`Stock bajo: ${stockBajo.slice(0, 6).join(', ')}`);
  if (pendientes > 0) lineas.push(`Sin sincronizar: ${pendientes}`);
  return lineas.join('\n');
}

/** Enlace sms: que abre la app de mensajes con el texto ya escrito. */
export function enlaceSMS(telefono, texto) {
  const numero = String(telefono || '').replace(/[^\d+]/g, '');
  return `sms:${numero}?body=${encodeURIComponent(texto)}`;
}

// Dinero SIEMPRE en enteros ("unidades menores"):
//   USD y MLC -> centavos      (3.50 USD = 350)
//   CUP       -> pesos enteros (320 CUP = 320)
// Así se evitan los errores de decimales flotantes (0.1 + 0.2 !== 0.3).

/** Pasa lo que escribió la persona (3.5, "3,50") a unidades menores. NaN si no es válido. */
export function aMinor(valor, moneda) {
  const n = typeof valor === 'string' ? parseFloat(valor.trim().replace(',', '.')) : Number(valor);
  if (!Number.isFinite(n)) return NaN;
  return moneda === 'CUP' ? Math.round(n) : Math.round((n + Number.EPSILON) * 100);
}

/** Formatea unidades menores: 350 USD -> "$3.50 USD", 960 CUP -> "960 CUP". */
export function fmtMinor(minor, moneda) {
  if (moneda === 'CUP') return `${Math.round(minor)} CUP`;
  return `$${(minor / 100).toFixed(2)} ${moneda}`;
}

/** Centavos USD -> "$3.50". */
export const fmtUSD = (centavos) => `$${(centavos / 100).toFixed(2)}`;

// Un producto guarda su precio en su propia moneda base:
//   { moneda: 'USD', precio: 350 }  o  { moneda: 'CUP', precio: 1120 }

export function precioUnitCUP(p, tasaUSD) {
  return p.moneda === 'CUP' ? p.precio : Math.round((p.precio * tasaUSD) / 100);
}

export function precioUnitUSD(p, tasaUSD) {
  return p.moneda === 'CUP' ? Math.round((p.precio / tasaUSD) * 100) : p.precio;
}

/** Precio tal como se definió: "$3.50 USD" o "1120 CUP". */
export const precioPrincipal = (p) => fmtMinor(p.precio, p.moneda === 'CUP' ? 'CUP' : 'USD');

/** Precio en la otra moneda, como referencia: "≈ 1120 CUP" o "≈ $3.50 USD". */
export function precioSecundario(p, tasaUSD) {
  return p.moneda === 'CUP'
    ? `≈ ${fmtMinor(precioUnitUSD(p, tasaUSD), 'USD')}`
    : `≈ ${fmtMinor(precioUnitCUP(p, tasaUSD), 'CUP')}`;
}

/**
 * Totales de un carrito.
 * @param lineas [{ producto, cantidad }]
 * @param tasas  { usd, mlc }  (cuántos CUP vale 1 USD / 1 MLC)
 * @returns { cup, usd, mlc, costo }  (cup en pesos; usd, mlc y costo en centavos)
 */
export function totalesCarrito(lineas, tasas) {
  let cup = 0;
  let usd = 0;
  let costo = 0;
  for (const { producto: p, cantidad: n } of lineas) {
    cup += precioUnitCUP(p, tasas.usd) * n;
    usd += precioUnitUSD(p, tasas.usd) * n;
    costo += (p.costoCents || 0) * n;
  }
  return { cup, usd, mlc: Math.round((cup / tasas.mlc) * 100), costo };
}

/** Monto a cobrar (en unidades menores) según la moneda elegida. */
export function montoACobrar(totales, moneda) {
  if (moneda === 'CUP') return totales.cup;
  if (moneda === 'MLC') return totales.mlc;
  return totales.usd;
}

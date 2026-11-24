// Cálculos del turno a partir de ventas y mermas (sin DOM, fáciles de probar).
// La caja ya no se guarda como número suelto: se calcula desde las ventas,
// así nunca puede quedar desfasada de lo realmente vendido.

/**
 * @param ventas     tickets del turno
 * @param mermas     mermas del turno
 * @param categorias nombres de categorías (para mostrarlas aunque no tengan ventas)
 */
export function resumenTurno({ ventas, mermas, categorias }) {
  const caja = { USD: 0, MLC: 0, CUP: 0 };
  const porCat = new Map(categorias.map((c) => [c, { usd: 0, cup: 0 }]));
  let ventasUSD = 0;
  let costoUSD = 0;
  let gastosUSD = 0;

  for (const v of ventas) {
    caja[v.moneda] = (caja[v.moneda] || 0) + v.cobrado; // el vuelto ya sale del cobrado
    ventasUSD += v.totalUSD;
    costoUSD += v.costoCents || 0;
    for (const i of v.items) {
      if (!porCat.has(i.categoria)) porCat.set(i.categoria, { usd: 0, cup: 0 });
      const c = porCat.get(i.categoria);
      c.usd += i.usdUnit * i.cantidad;
      c.cup += i.cupUnit * i.cantidad;
    }
  }
  for (const m of mermas) gastosUSD += m.perdidaCents || 0;

  return {
    caja,
    tickets: ventas.length,
    ventasUSD,
    costoUSD,
    gastosUSD,
    gananciaBrutaUSD: ventasUSD - costoUSD,
    netoUSD: ventasUSD - costoUSD - gastosUSD,
    porCategoria: [...porCat].map(([categoria, v]) => ({ categoria, usd: v.usd, cup: v.cup })),
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

/** Diferencia de arqueo: contado - esperado (positivo = sobra, negativo = falta). */
export const diferenciaArqueo = (contado, esperado) => contado - esperado;

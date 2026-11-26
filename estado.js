// Estado global de la app (una sola fuente de verdad).
// Los datos llegan en tiempo real desde Firestore (data.js); la vista se dibuja desde aquí.
import { TELEFONO_REPORTE, UMBRAL_STOCK_BAJO } from './config.js';

export const estado = {
  // sesión
  user: null,
  esDueno: false, // la cuenta figura en /duenos/{uid}
  modoDueno: false, // el panel de administración está abierto
  tabDueno: 'resumen', // pestaña abierta del panel (resumen, productos, personal, caja, ajustes)

  // configuración (documento config/general)
  configExiste: false,
  tasaUSD: 320,
  tasaMLC: 280,
  categorias: [],
  subcategorias: [], // [{ cat, nombre }]
  telefonoReporte: TELEFONO_REPORTE,
  umbralStock: UMBRAL_STOCK_BAJO,

  // datos
  productos: [],
  empleados: [],
  turno: null, // { id, inicio }
  ventas: [], // solo las del turno actual
  mermas: [], // solo las del turno actual
  cierres: [], // cierres de los últimos 30 días (solo dueño)
  errorCierres: null,
  cortes: [], // arqueos cerrados en este turno (solo dueño)
  pendientes: 0, // ventas guardadas en este aparato que aún no llegaron a la nube

  // sesión de caja en este dispositivo
  carrito: [], // [{ id, cantidad }]  (no toca el stock hasta cobrar)
  cajeroId: null,
  categoriaFiltro: '*',
  subFiltro: '*',

  cargado: { config: false, productos: false, empleados: false, turno: false },
  errorCarga: null,
};

export function reiniciarEstado() {
  Object.assign(estado, {
    user: null,
    esDueno: false,
    modoDueno: false,
    configExiste: false,
    categorias: [],
    productos: [],
    empleados: [],
    turno: null,
    ventas: [],
    mermas: [],
    cierres: [],
    errorCierres: null,
    cortes: [],
    pendientes: 0,
    subcategorias: [],
    carrito: [],
    cajeroId: null,
    categoriaFiltro: '*',
    subFiltro: '*',
    cargado: { config: false, productos: false, empleados: false, turno: false },
    errorCarga: null,
  });
}

export const subcategoriasDe = (cat) => estado.subcategorias.filter((s) => s.cat === cat).map((s) => s.nombre);

export const cajeroActual = () => estado.empleados.find((e) => e.id === estado.cajeroId) || null;

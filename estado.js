// Estado global de la app (una sola fuente de verdad).
// Los datos llegan en tiempo real desde Firestore (data.js); la vista se dibuja desde aquí.

export const estado = {
  // sesión
  user: null,
  esDueno: false, // la cuenta figura en /duenos/{uid}
  modoDueno: false, // el panel de administración está abierto

  // configuración (documento config/general)
  configExiste: false,
  tasaUSD: 320,
  tasaMLC: 280,
  categorias: [],
  umbralStock: 5,

  // datos
  productos: [],
  empleados: [],
  turno: null, // { id, inicio }
  ventas: [], // solo las del turno actual
  mermas: [], // solo las del turno actual
  cierres: [], // últimos cierres (solo dueño)

  // sesión de caja en este dispositivo
  carrito: [], // [{ id, cantidad }]  (no toca el stock hasta cobrar)
  cajeroId: null,
  categoriaFiltro: '*',

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
    carrito: [],
    cajeroId: null,
    categoriaFiltro: '*',
    cargado: { config: false, productos: false, empleados: false, turno: false },
    errorCarga: null,
  });
}

export const cajeroActual = () => estado.empleados.find((e) => e.id === estado.cajeroId) || null;

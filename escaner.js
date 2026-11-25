// Escáner de códigos de barras con la cámara del teléfono.
//  1) Primero usa el lector nativo del navegador (BarcodeDetector), rápido y sin descargar nada.
//  2) Si el teléfono no lo trae, carga la librería ZXing (una sola vez; queda guardada para usarla sin internet).
import { $ } from './utils.js';
import { abrirModal, cerrarModal } from './ui.js';

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
const URL_ZXING = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';

let flujo = null;
let lectorZXing = null;
let activo = false;
let temporizador = null;
let alCodigo = null;
let continuo = false;
let ultimo = { codigo: '', t: 0 };

const mensaje = (texto) => {
  $('escaner-mensaje').textContent = texto;
};

function cargarZXing() {
  return new Promise((ok, mal) => {
    if (window.ZXing) return ok();
    const s = document.createElement('script');
    s.src = URL_ZXING;
    s.onload = ok;
    s.onerror = () => mal(new Error('No se pudo cargar el lector alternativo'));
    document.head.appendChild(s);
  });
}

function leido(codigo) {
  const ahora = Date.now();
  if (codigo === ultimo.codigo && ahora - ultimo.t < 2500) return; // el mismo código seguido: se ignora
  ultimo = { codigo, t: ahora };
  if (navigator.vibrate) navigator.vibrate(80);
  const aceptado = alCodigo ? alCodigo(codigo) : true;
  if (continuo && aceptado !== false) mensaje(`✅ ${codigo} leído. Apunta al siguiente o toca Cerrar.`);
  else if (!continuo) cerrarEscaner();
}

function bucleNativo(detector, video) {
  if (!activo) return;
  temporizador = setTimeout(async () => {
    try {
      const r = await detector.detect(video);
      if (r.length && activo) leido(r[0].rawValue);
    } catch (e) {
      /* un cuadro sin código: normal */
    }
    bucleNativo(detector, video);
  }, 160);
}

/**
 * Abre la cámara y avisa por cada código leído.
 * @param codigoLeido  función(codigo) -> false si no se aceptó
 * @param opciones.continuo  true = sigue leyendo (ventas); false = se cierra al primer código
 */
export async function abrirEscaner(codigoLeido, opciones = {}) {
  alCodigo = codigoLeido;
  continuo = !!opciones.continuo;
  ultimo = { codigo: '', t: 0 };
  abrirModal('modal-escaner');
  mensaje('Iniciando la cámara…');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return mensaje('Este navegador no permite usar la cámara. Escribe el código a mano.');
  }

  const video = $('escaner-video');
  activo = true;
  try {
    let detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const soportados = await window.BarcodeDetector.getSupportedFormats();
        const formatos = FORMATOS.filter((f) => soportados.includes(f));
        if (formatos.length) detector = new window.BarcodeDetector({ formats: formatos });
      } catch (e) {
        detector = null;
      }
    }

    if (detector) {
      flujo = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = flujo;
      await video.play();
      mensaje('Apunta la cámara al código de barras.');
      bucleNativo(detector, video);
    } else {
      mensaje('Preparando el lector… (la primera vez necesita internet)');
      await cargarZXing();
      if (!activo) return;
      lectorZXing = new window.ZXing.BrowserMultiFormatReader();
      await lectorZXing.decodeFromVideoDevice(null, video, (resultado) => {
        if (resultado && activo) leido(resultado.getText());
      });
      mensaje('Apunta la cámara al código de barras.');
    }
  } catch (e) {
    activo = false;
    detenerFlujo();
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      mensaje('Falta el permiso de la cámara. En Chrome: toca el candado junto a la dirección → Permisos → Cámara → Permitir.');
    } else if (e && e.name === 'NotFoundError') {
      mensaje('No se encontró ninguna cámara en este aparato.');
    } else {
      mensaje('No se pudo iniciar el escáner. Escribe el código a mano.');
    }
  }
}

function detenerFlujo() {
  clearTimeout(temporizador);
  temporizador = null;
  if (lectorZXing) {
    try {
      lectorZXing.reset();
    } catch (e) {
      /* ya estaba detenido */
    }
    lectorZXing = null;
  }
  if (flujo) {
    flujo.getTracks().forEach((t) => t.stop());
    flujo = null;
  }
  const video = $('escaner-video');
  if (video) video.srcObject = null;
}

export function cerrarEscaner() {
  activo = false;
  detenerFlujo();
  alCodigo = null;
  cerrarModal('modal-escaner');
}

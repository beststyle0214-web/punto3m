// Utilidades generales (sin dependencias de Firebase).

export const $ = (id) => document.getElementById(id);

const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para insertarlo de forma segura en innerHTML o en atributos. */
export const esc = (valor) => String(valor ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c]);

/** Minúsculas y sin tildes, para búsquedas ("cafe" encuentra "Café"). */
export const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Convierte número, Date, Timestamp de Firestore o texto ISO a milisegundos. */
export function aMillis(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export const formatoHora = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const formatoFechaHora = (ms) => new Date(ms).toLocaleString();

/** Duración HH:MM:SS entre dos instantes. */
export function duracion(desdeMs, hastaMs = Date.now()) {
  const seg = Math.max(0, Math.floor((hastaMs - desdeMs) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(seg / 3600))}:${p(Math.floor((seg % 3600) / 60))}:${p(seg % 60)}`;
}

export function descargarArchivo(nombre, texto, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Nombre visible de un producto: "Refresco · Naranja" (nombre + sabor / tipo). */
export const nombreProducto = (p) => (p.variante ? `${p.nombre} · ${p.variante}` : p.nombre);

/** Solo se muestran fotos que sean imágenes en base64 (nada de enlaces externos). */
export const fotoValida = (s) =>
  typeof s === 'string' && s.length < 250000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);

/**
 * Reduce una foto a un cuadrado pequeño (centrado) en JPEG, para guardarla dentro del
 * producto sin gastar internet ni espacio. Devuelve un texto "data:image/jpeg;base64,...".
 */
export async function comprimirImagen(archivo, lado = 256, calidad = 0.72) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo leer la imagen'));
      i.src = url;
    });
    const corto = Math.min(img.naturalWidth, img.naturalHeight);
    if (!corto) throw new Error('Imagen vacía');
    const tam = Math.min(lado, corto);
    const canvas = document.createElement('canvas');
    canvas.width = tam;
    canvas.height = tam;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // los PNG con fondo transparente quedan sobre blanco
    ctx.fillRect(0, 0, tam, tam);
    ctx.drawImage(img, (img.naturalWidth - corto) / 2, (img.naturalHeight - corto) / 2, corto, corto, 0, 0, tam, tam);
    return canvas.toDataURL('image/jpeg', calidad);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Espera a una promesa como máximo `ms` milisegundos; si tarda más, rechaza con 'timeout'. */
export function conTiempo(promesa, ms) {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
    promesa.then(
      (v) => { clearTimeout(t); ok(v); },
      (e) => { clearTimeout(t); mal(e); },
    );
  });
}

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

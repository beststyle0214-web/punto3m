// Configuración general de la app.
// La apiKey de Firebase es pública por diseño: la seguridad real la ponen
// Firebase Authentication + las reglas de Firestore (firestore.rules).

export const firebaseConfig = {
  apiKey: 'AIzaSyBicNDG0HMN-0nUSelhrpoQkGklnhbHyxY',
  authDomain: 'punto3m.firebaseapp.com',
  projectId: 'punto3m',
  storageBucket: 'punto3m.firebasestorage.app',
  messagingSenderId: '494946253119',
  appId: '1:494946253119:web:fe79688c126da465f43b8a',
};

export const DENOMINACIONES_CUP = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export const TASAS_POR_DEFECTO = { usd: 320, mlc: 280 };
export const CATEGORIAS_POR_DEFECTO = ['Comida', 'Bebidas', 'Varios'];
export const UMBRAL_STOCK_BAJO = 5;

// Número al que se prepara el reporte por SMS (se puede cambiar en ⚙️ Tasas y ajustes).
export const TELEFONO_REPORTE = '+5353463594';
export const DIAS_CIERRES = 30; // cuántos días atrás se listan los turnos cerrados
export const LADO_FOTO = 256; // las fotos de productos se reducen a 256×256 px

// Intermediario (Cloudflare Worker) para usar la app SIN VPN desde Cuba: Google bloquea sus servidores
// de datos y de inicio de sesión (error 403) desde allí, y el intermediario los llama desde fuera.
// Déjalo vacío ('') para conectar directo a Google. Ejemplo: 'https://p3m-proxy.tunombre.workers.dev'
export const PROXY_URL = 'https://p3m-proxy.beststyle0214.workers.dev';

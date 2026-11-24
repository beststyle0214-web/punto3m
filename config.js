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

export const DENOMINACIONES_CUP = [10, 20, 50, 100, 200, 500, 1000];
export const TASAS_POR_DEFECTO = { usd: 320, mlc: 280 };
export const CATEGORIAS_POR_DEFECTO = ['Comida', 'Bebidas', 'Varios'];
export const UMBRAL_STOCK_BAJO = 5;

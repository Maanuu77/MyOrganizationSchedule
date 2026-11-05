// Inicialización de Firebase a partir de las variables VITE_FIREBASE_* del archivo .env.
// Si faltan, la app muestra una pantalla de configuración en lugar de fallar en blanco.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, initializeAppCheck } from 'firebase/app-check';
import { GoogleAuthProvider, connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const env = import.meta.env;

const configuracion = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const NOMBRES_VARIABLES: Record<keyof typeof configuracion, string> = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

/** Lista de variables obligatorias que no están definidas. */
export const variablesQueFaltan: string[] = (
  Object.keys(configuracion) as Array<keyof typeof configuracion>
)
  .filter((clave) => !configuracion[clave])
  .map((clave) => NOMBRES_VARIABLES[clave]);

export const firebaseConfigurado = variablesQueFaltan.length === 0;

/** Clave pública VAPID para las notificaciones push (opcional). */
export const claveVapid: string | undefined = env.VITE_FIREBASE_VAPID_KEY || undefined;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseConfigurado) {
  app = initializeApp(configuracion);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    // Evita errores si algún campo opcional llega como undefined
    ignoreUndefinedProperties: true,
    // Copia de los datos en el dispositivo (IndexedDB), compartida entre pestañas: la app abre
    // al instante, funciona sin conexión y lo guardado sin red se envía solo al volver.
    // Si el navegador no tiene IndexedDB, Firebase sigue con la caché en memoria.
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  // App Check: Firestore solo acepta peticiones que vienen de esta web (no de un script con la
  // API key, que es pública). Se activa al poner la clave de reCAPTCHA Enterprise en el .env;
  // con los emuladores no hace falta.
  if (env.VITE_APPCHECK_SITE_KEY && env.VITE_USAR_EMULADORES !== 'true') {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
  if (env.VITE_USAR_EMULADORES === 'true') {
    // Puertos por defecto de los emuladores; se pueden cambiar si ya están ocupados
    const puertoAuth = env.VITE_EMULADOR_PUERTO_AUTH || '9099';
    const puertoFirestore = Number(env.VITE_EMULADOR_PUERTO_FIRESTORE || 8080);
    connectAuthEmulator(auth, `http://127.0.0.1:${puertoAuth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', puertoFirestore);
  }
}

/** Instancias de Firebase. Solo se usan cuando `firebaseConfigurado` es true. */
export function obtenerApp(): FirebaseApp {
  if (!app) throw new Error('Firebase no está configurado');
  return app;
}
export function obtenerAuth(): Auth {
  if (!auth) throw new Error('Firebase no está configurado');
  return auth;
}
export function obtenerDb(): Firestore {
  if (!db) throw new Error('Firebase no está configurado');
  return db;
}

/** Proveedor de Google para el inicio de sesión. */
export function proveedorGoogle(): GoogleAuthProvider {
  const proveedor = new GoogleAuthProvider();
  proveedor.setCustomParameters({ prompt: 'select_account' });
  return proveedor;
}

// Hooks de sesión y sincronización en tiempo real.
// useSesion escucha el inicio/cierre de sesión de Firebase Auth.
// useSincronizacion abre un "oyente" (onSnapshot) por colección: cualquier cambio hecho
// en otro dispositivo llega aquí en tiempo real y actualiza el almacén.

import { useEffect } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { clearIndexedDbPersistence, doc, onSnapshot, terminate, where } from 'firebase/firestore';
import { firebaseConfigurado, obtenerAuth, obtenerDb, proveedorGoogle } from './firebase';
import { useDatos } from './almacenDatos';
import { COLECCIONES, escuchar, refAjustes, refDoc, registrarPerfil } from './datos';
import { completarAjustes } from './ajustesPorDefecto';
import { claveDia, zonaDelDispositivo } from './fechas';
import { normalizarRutina } from './rutinas';
import { inicioVentana, ponerVentana, reiniciarHistorico } from './historico';
import { darDeBajaEsteDispositivo } from './useNotificaciones';
import { avisar } from './almacenUI';
import { t } from './textos';
import type {
  Ajustes,
  EjecucionRutina,
  EstadoContador,
  IntegracionGoogle,
  PlantillaCiclo,
  RegistroSesion,
  Tarea,
} from './tipos';

export function useSesion(): void {
  useEffect(() => {
    if (!firebaseConfigurado) {
      useDatos.getState().poner({ cargandoSesion: false });
      return;
    }
    // Si venimos de un inicio de sesión por redirección, recogemos el resultado (o el error)
    getRedirectResult(obtenerAuth()).catch((e) =>
      console.warn('Inicio de sesión por redirección fallido', e),
    );
    return onAuthStateChanged(obtenerAuth(), (u) => {
      const { poner, reiniciar } = useDatos.getState();
      if (!u) {
        reiniciar();
        poner({ usuario: null, cargandoSesion: false });
        return;
      }
      poner({
        usuario: { uid: u.uid, email: u.email, nombre: u.displayName, foto: u.photoURL },
        cargandoSesion: false,
      });
      registrarPerfil(u.uid, u.email, u.displayName).catch((e) =>
        console.warn('No se pudo guardar el perfil', e),
      );
    });
  }, []);
}

/** ¿La app está instalada como PWA? Ahí las ventanas emergentes funcionan peor. */
function enModoApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * Inicia sesión con Google. Normalmente con ventana emergente; si la app está instalada
 * o el navegador bloquea la ventana, usamos redirección (se vuelve a la app al terminar).
 */
export async function entrarConGoogle(): Promise<void> {
  const auth = obtenerAuth();
  if (enModoApp()) {
    await signInWithRedirect(auth, proveedorGoogle());
    return;
  }
  try {
    await signInWithPopup(auth, proveedorGoogle());
  } catch (e) {
    const codigo = (e as { code?: string }).code;
    if (
      codigo === 'auth/popup-blocked' ||
      codigo === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, proveedorGoogle());
      return;
    }
    throw e;
  }
}

export async function cerrarSesion(): Promise<void> {
  // Primero, que este navegador deje de recibir los avisos de la cuenta
  await darDeBajaEsteDispositivo();
  await signOut(obtenerAuth());
  // Y que no quede la copia local de los datos (importante en un ordenador compartido).
  // Para borrarla hay que cerrar Firestore, así que después se recarga la app.
  try {
    await terminate(obtenerDb());
    await clearIndexedDbPersistence(obtenerDb());
  } catch (e) {
    console.warn('No se pudo borrar la copia local de los datos', e);
  }
  window.location.reload();
}

/** Ordena por fecha de creación (las listas de Firestore llegan ordenadas por id). */
function ordenarPorCreacion<T extends { id: string }>(lista: T[]): T[] {
  const fecha = (x: T) => (x as { creadoEnMs?: number }).creadoEnMs ?? 0;
  return [...lista].sort((a, b) => fecha(a) - fecha(b));
}

export function useSincronizacion(): void {
  const uid = useDatos((s) => s.usuario?.uid);

  useEffect(() => {
    if (!uid) return;
    const { poner } = useDatos.getState();
    // Registros, tareas completadas y ejecuciones: solo los últimos 90 días (historico.ts)
    reiniciarHistorico();
    const ventana = inicioVentana();
    const pendientes = new Set<string>([
      'ajustes',
      'etiquetas',
      'eventos',
      'tareasPendientes',
      'tareasHechas',
    ]);
    const marcarListo = (nombre: string) => {
      if (!pendientes.delete(nombre)) return;
      if (pendientes.size === 0) poner({ datosListos: true });
    };
    const alFallar = (error: Error) => {
      console.error('Error de sincronización', error);
      // No marcamos los datos como listos: con los ajustes por defecto se vería la bienvenida
      // y se podrían sobrescribir los ajustes reales. Mientras faltan los datos principales,
      // App enseña una pantalla de error con «Reintentar»; si ya estaban, basta con avisar.
      poner({ errorSincronizacion: error.message });
      if (pendientes.size === 0) avisar(t.app.errorSincronizacion, 'error');
    };
    // Las rutinas antiguas de estudio se convierten con su ciclo: por eso se recalculan
    // cuando llegan las rutinas y también cuando llegan los ciclos.
    // Las tareas llegan por dos oyentes: las pendientes (todas) y las completadas en la ventana
    let tareasPendientes: Tarea[] = [];
    let tareasHechas: Tarea[] = [];
    const ponerTareas = () => {
      const pendientesIds = new Set(tareasPendientes.map((x) => x.id));
      ponerVentana('tareas', [
        ...tareasPendientes,
        ...tareasHechas.filter((x) => !pendientesIds.has(x.id)),
      ]);
    };
    let ciclosLeidos: PlantillaCiclo[] = [];
    let rutinasLeidas: { id: string }[] = [];
    const ponerRutinas = () =>
      poner({
        rutinas: rutinasLeidas.map((r) => normalizarRutina(r, ciclosLeidos)),
      });

    const bajas = [
      onSnapshot(
        refAjustes(uid),
        (snap) => {
          poner({
            ajustes: completarAjustes(
              snap.data() as Partial<Ajustes> | undefined,
              zonaDelDispositivo(),
            ),
            ajustesCargados: true,
            ajustesExisten: snap.exists(),
          });
          marcarListo('ajustes');
        },
        alFallar,
      ),
      escuchar(
        uid,
        COLECCIONES.etiquetas,
        (etiquetas) => {
          poner({ etiquetas: etiquetas as never });
          marcarListo('etiquetas');
        },
        alFallar,
      ),
      escuchar(
        uid,
        COLECCIONES.eventos,
        (eventos) => {
          poner({ eventos: eventos as never });
          marcarListo('eventos');
        },
        alFallar,
      ),
      escuchar<Tarea>(
        uid,
        COLECCIONES.tareas,
        (tareas) => {
          tareasPendientes = tareas;
          ponerTareas();
          marcarListo('tareasPendientes');
        },
        alFallar,
        where('completada', '==', false),
      ),
      escuchar<Tarea>(
        uid,
        COLECCIONES.tareas,
        (tareas) => {
          tareasHechas = tareas;
          ponerTareas();
          marcarListo('tareasHechas');
        },
        alFallar,
        where('completadaEnMs', '>=', ventana),
      ),
      escuchar(
        uid,
        COLECCIONES.excepciones,
        (excepciones) => poner({ excepciones: excepciones as never }),
        alFallar,
      ),
      escuchar(
        uid,
        COLECCIONES.ciclos,
        (ciclos) => {
          ciclosLeidos = ordenarPorCreacion(ciclos) as unknown as PlantillaCiclo[];
          poner({ ciclos: ciclosLeidos as never });
          ponerRutinas();
        },
        alFallar,
      ),
      escuchar(
        uid,
        COLECCIONES.rutinas,
        (rutinas) => {
          rutinasLeidas = ordenarPorCreacion(rutinas);
          ponerRutinas();
        },
        alFallar,
      ),
      escuchar<EjecucionRutina>(
        uid,
        COLECCIONES.ejecuciones,
        (ejecuciones) => ponerVentana('ejecuciones', ejecuciones),
        alFallar,
        where('fecha', '>=', claveDia(ventana)),
      ),
      escuchar(
        uid,
        COLECCIONES.plantillas,
        (plantillas) => poner({ plantillas: ordenarPorCreacion(plantillas) as never }),
        alFallar,
      ),
      escuchar(
        uid,
        COLECCIONES.dispositivos,
        (dispositivos) => poner({ dispositivos: dispositivos as never }),
        alFallar,
      ),
      escuchar<RegistroSesion>(
        uid,
        COLECCIONES.registros,
        (registros) => ponerVentana('registros', registros),
        alFallar,
        where('inicioMs', '>=', ventana),
      ),
      onSnapshot(
        doc(obtenerDb(), 'users', uid, COLECCIONES.integraciones, 'googleCalendar'),
        (snap) =>
          poner({ integracionGoogle: (snap.data() as IntegracionGoogle | undefined) ?? null }),
        alFallar,
      ),
      // El contador: usamos estimaciones locales de serverTimestamp para que el cambio
      // se vea al instante en este dispositivo antes de que confirme el servidor.
      onSnapshot(
        refDoc(COLECCIONES.contador, 'actual', uid),
        (snap) =>
          poner({
            contador:
              (snap.data({ serverTimestamps: 'estimate' }) as EstadoContador | undefined) ?? null,
            contadorCargado: true,
          }),
        alFallar,
      ),
    ];
    return () => bajas.forEach((baja) => baja());
  }, [uid]);
}

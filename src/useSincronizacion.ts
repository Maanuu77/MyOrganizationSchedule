// Hooks de sesión y sincronización en tiempo real.
// useSesion escucha el inicio/cierre de sesión de Firebase Auth.
// useSincronizacion abre un "oyente" (onSnapshot) por colección: cualquier cambio hecho
// en otro dispositivo llega aquí en tiempo real y actualiza el almacén.

import { useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, onSnapshot, where } from 'firebase/firestore';
import { firebaseConfigurado, obtenerAuth, obtenerDb, proveedorGoogle } from './firebase';
import { useDatos } from './almacenDatos';
import { COLECCIONES, escuchar, refAjustes, refDoc, registrarPerfil } from './datos';
import { completarAjustes } from './ajustesPorDefecto';
import { zonaDelDispositivo } from './fechas';
import type { Ajustes, EstadoContador, IntegracionGoogle } from './tipos';

export function useSesion(): void {
  useEffect(() => {
    if (!firebaseConfigurado) {
      useDatos.getState().poner({ cargandoSesion: false });
      return;
    }
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
      registrarPerfil(u.uid, u.email, u.displayName).catch((e) => console.warn('No se pudo guardar el perfil', e));
    });
  }, []);
}

export async function entrarConGoogle(): Promise<void> {
  await signInWithPopup(obtenerAuth(), proveedorGoogle());
}

export async function cerrarSesion(): Promise<void> {
  await signOut(obtenerAuth());
}

/** Registros de sesión que se cargan: los de los dos últimos años (para comparar año con año). */
const DIAS_REGISTROS = 800;

export function useSincronizacion(): void {
  const uid = useDatos((s) => s.usuario?.uid);

  useEffect(() => {
    if (!uid) return;
    const { poner } = useDatos.getState();
    const pendientes = new Set<string>(['ajustes', 'etiquetas', 'eventos', 'tareas']);
    const marcarListo = (nombre: string) => {
      if (!pendientes.delete(nombre)) return;
      if (pendientes.size === 0) poner({ datosListos: true });
    };
    const alFallar = (error: Error) => {
      console.error('Error de sincronización', error);
      poner({ errorSincronizacion: error.message, datosListos: true });
    };

    const bajas = [
      onSnapshot(
        refAjustes(uid),
        (snap) => {
          poner({
            ajustes: completarAjustes(snap.data() as Partial<Ajustes> | undefined, zonaDelDispositivo()),
            ajustesCargados: true,
          });
          marcarListo('ajustes');
        },
        alFallar,
      ),
      escuchar(uid, COLECCIONES.etiquetas, (etiquetas) => {
        poner({ etiquetas: etiquetas as never });
        marcarListo('etiquetas');
      }, alFallar),
      escuchar(uid, COLECCIONES.eventos, (eventos) => {
        poner({ eventos: eventos as never });
        marcarListo('eventos');
      }, alFallar),
      escuchar(uid, COLECCIONES.tareas, (tareas) => {
        poner({ tareas: tareas as never });
        marcarListo('tareas');
      }, alFallar),
      escuchar(uid, COLECCIONES.excepciones, (excepciones) => poner({ excepciones: excepciones as never }), alFallar),
      escuchar(uid, COLECCIONES.ciclos, (ciclos) => poner({ ciclos: ciclos as never }), alFallar),
      escuchar(uid, COLECCIONES.rutinas, (rutinas) => poner({ rutinas: rutinas as never }), alFallar),
      escuchar(uid, COLECCIONES.ejecuciones, (ejecuciones) => poner({ ejecuciones: ejecuciones as never }), alFallar),
      escuchar(uid, COLECCIONES.plantillas, (plantillas) => poner({ plantillas: plantillas as never }), alFallar),
      escuchar(uid, COLECCIONES.dispositivos, (dispositivos) => poner({ dispositivos: dispositivos as never }), alFallar),
      escuchar(
        uid,
        COLECCIONES.registros,
        (registros) => poner({ registros: registros as never }),
        alFallar,
        where('inicioMs', '>=', Date.now() - DIAS_REGISTROS * 86_400_000),
      ),
      onSnapshot(
        doc(obtenerDb(), 'users', uid, COLECCIONES.integraciones, 'googleCalendar'),
        (snap) => poner({ integracionGoogle: (snap.data() as IntegracionGoogle | undefined) ?? null }),
        alFallar,
      ),
      // El contador: usamos estimaciones locales de serverTimestamp para que el cambio
      // se vea al instante en este dispositivo antes de que confirme el servidor.
      onSnapshot(
        refDoc(COLECCIONES.contador, 'actual', uid),
        (snap) =>
          poner({ contador: (snap.data({ serverTimestamps: 'estimate' }) as EstadoContador | undefined) ?? null }),
        alFallar,
      ),
    ];
    return () => bajas.forEach((baja) => baja());
  }, [uid]);
}

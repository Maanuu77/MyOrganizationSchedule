// Datos que crecen sin parar (registros de sesión, tareas completadas y ejecuciones de rutina):
// al abrir la app solo se escuchan los de los últimos 90 días. Lo anterior se carga bajo
// demanda, una sola vez por sesión, cuando una pantalla lo necesita (estadísticas de periodos
// antiguos o una racha de más de 90 días). Así cada apertura de la app lee unos pocos cientos
// de documentos en vez de todo el historial, que con un año de uso son miles.
//
// El almacén guarda la unión de las dos partes: los consumidores siguen leyendo
// `useDatos(s => s.registros)` como siempre.

import { useEffect, useMemo } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { getDocs, query, where } from 'firebase/firestore';
import { useDatos } from './almacenDatos';
import { COLECCIONES, refColeccion } from './datos';
import { rachas } from './estadisticas';
import { claveDia } from './fechas';
import type { EjecucionRutina, RegistroSesion, Tarea } from './tipos';

/** Días hacia atrás que se escuchan en tiempo real. */
export const DIAS_VENTANA_DATOS = 90;

/** Inicio de la ventana que se escucha en tiempo real. */
export function inicioVentana(): number {
  return startOfDay(addDays(new Date(), -DIAS_VENTANA_DATOS)).getTime();
}

type Clave = 'registros' | 'tareas' | 'ejecuciones';
interface Listas {
  registros: RegistroSesion[];
  tareas: Tarea[];
  ejecuciones: EjecucionRutina[];
}

/** Lo que llega de los oyentes en tiempo real (la ventana). */
let vivos: Listas = { registros: [], tareas: [], ejecuciones: [] };
/** Lo cargado bajo demanda, anterior a la ventana. */
let antiguos: Listas = { registros: [], tareas: [], ejecuciones: [] };
/** Carga en curso, para no repetir la misma consulta si dos pantallas la piden a la vez. */
let cargando: Promise<void> | null = null;

/** Publica en el almacén la unión de las dos partes (si un documento está en las dos, gana el vivo). */
function publicar<K extends Clave>(clave: K): void {
  const ids = new Set(vivos[clave].map((x) => x.id));
  const lista = [...vivos[clave], ...antiguos[clave].filter((x) => !ids.has(x.id))];
  useDatos.getState().poner({ [clave]: lista } as Partial<Listas>);
}

/** Lo que llega de un oyente en tiempo real. */
export function ponerVentana<K extends Clave>(clave: K, lista: Listas[K]): void {
  vivos = { ...vivos, [clave]: lista };
  publicar(clave);
}

/** Al cambiar de usuario o cerrar sesión se olvida todo lo cargado. */
export function reiniciarHistorico(): void {
  vivos = { registros: [], tareas: [], ejecuciones: [] };
  antiguos = { registros: [], tareas: [], ejecuciones: [] };
  cargando = null;
  useDatos.getState().poner({ historicoDesdeMs: inicioVentana() });
}

/**
 * Asegura que están cargados los datos desde `desdeMs`. Si ya lo estaban no lee nada; si no,
 * lee solo el tramo que falta (entre `desdeMs` y lo más antiguo que ya hay).
 */
export async function asegurarHistorico(desdeMs: number): Promise<void> {
  while (cargando) await cargando;
  const hastaMs = useDatos.getState().historicoDesdeMs;
  if (desdeMs >= hastaMs) return;
  cargando = (async () => {
    const [registros, tareas, ejecuciones] = await Promise.all([
      getDocs(
        query(
          refColeccion(COLECCIONES.registros),
          where('inicioMs', '>=', desdeMs),
          where('inicioMs', '<', hastaMs),
        ),
      ),
      // Las pendientes no tienen completadaEnMs: solo salen las completadas en el tramo
      getDocs(
        query(
          refColeccion(COLECCIONES.tareas),
          where('completadaEnMs', '>=', desdeMs),
          where('completadaEnMs', '<', hastaMs),
        ),
      ),
      getDocs(
        query(
          refColeccion(COLECCIONES.ejecuciones),
          where('fecha', '>=', claveDia(desdeMs)),
          where('fecha', '<', claveDia(hastaMs)),
        ),
      ),
    ]);
    const leer = <T>(snap: Awaited<ReturnType<typeof getDocs>>) =>
      snap.docs.map((d) => ({ ...(d.data() as object), id: d.id }) as T);
    antiguos = {
      registros: [...antiguos.registros, ...leer<RegistroSesion>(registros)],
      tareas: [...antiguos.tareas, ...leer<Tarea>(tareas)],
      ejecuciones: [...antiguos.ejecuciones, ...leer<EjecucionRutina>(ejecuciones)],
    };
    useDatos.getState().poner({ historicoDesdeMs: desdeMs });
    publicar('registros');
    publicar('tareas');
    publicar('ejecuciones');
  })();
  try {
    await cargando;
  } finally {
    cargando = null;
  }
}

/** Carga el historial desde `desdeMs` cuando se monta la pantalla que lo necesita. */
export function useHistorico(desdeMs: number): void {
  useEffect(() => {
    asegurarHistorico(desdeMs).catch((e) => console.warn('No se pudo cargar el historial', e));
  }, [desdeMs]);
}

/**
 * Racha actual de días con foco. Si llega hasta lo más antiguo cargado, puede ser más larga:
 * se cargan 90 días más y se vuelve a contar.
 */
export function useRachaActual(hoy: Date): number {
  const registros = useDatos((s) => s.registros);
  const cargadoDesde = useDatos((s) => s.historicoDesdeMs);
  const dia = startOfDay(hoy).getTime();
  const actual = useMemo(() => rachas(registros, new Date(dia)).actual, [registros, dia]);
  useEffect(() => {
    if (actual === 0) return;
    const inicioRacha = addDays(dia, -actual).getTime();
    if (inicioRacha > cargadoDesde) return;
    asegurarHistorico(addDays(cargadoDesde, -DIAS_VENTANA_DATOS).getTime()).catch((e) =>
      console.warn('No se pudo cargar el historial', e),
    );
  }, [actual, dia, cargadoDesde]);
  return actual;
}

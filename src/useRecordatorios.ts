// Mantiene la colección `reminders` al día: cada vez que cambian bloques, tareas, rutinas o
// ajustes, recalcula los recordatorios de los próximos 14 días y aplica solo las diferencias.
// La Cloud Function `enviarRecordatorios` los envía como push cuando llega su hora.

import { useEffect } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { useDatos } from './almacenDatos';
import { COLECCIONES, enLotes, recordatoriosPendientes, refDoc, uidActual } from './datos';
import {
  diferenciaRecordatorios,
  generarRecordatorios,
  DIAS_VENTANA,
  type RecordatorioNuevo,
} from './recordatorios';
import { expandirOcurrencias } from './recurrencia';
import { ahoraServidor } from './relojServidor';
import { useVisible } from './useMedia';
import type { AvisoCarga, Recordatorio } from './tipos';

/** Últimos recordatorios calculados: los usa también el aviso en primer plano. */
let ultimosDeseados: RecordatorioNuevo[] = [];
export const recordatoriosCalculados = () => ultimosDeseados;

type Pendiente = Pick<Recordatorio, 'id' | 'fireAt' | 'titulo' | 'cuerpo' | 'tipo'>;

/**
 * Copia en memoria de los recordatorios pendientes que hay en Firestore. Así cada cambio
 * calcula la diferencia sin volver a leerlos todos (antes eran 50–400 lecturas por edición y
 * por dispositivo). Se vuelve a leer del servidor cada 30 minutos, por si otro dispositivo los
 * ha cambiado, y si falla una escritura.
 */
let conocidos: { uid: string; leidoMs: number; porId: Map<string, Pendiente> } | null = null;
const RENOVAR_MS = 30 * 60_000;

async function pendientesActuales(uid: string): Promise<Map<string, Pendiente>> {
  if (!conocidos || conocidos.uid !== uid || Date.now() - conocidos.leidoMs > RENOVAR_MS) {
    const lista = (await recordatoriosPendientes()).filter((r) => r.tipo !== 'faseTemporizador');
    conocidos = {
      uid,
      leidoMs: Date.now(),
      porId: new Map(lista.map((r) => [r.id, r as Pendiente])),
    };
  }
  return conocidos.porId;
}

export function useRecordatorios(avisos: AvisoCarga[]): void {
  const uid = useDatos((s) => s.usuario?.uid);
  const eventos = useDatos((s) => s.eventos);
  const excepciones = useDatos((s) => s.excepciones);
  const tareas = useDatos((s) => s.tareas);
  const rutinas = useDatos((s) => s.rutinas);
  const notificaciones = useDatos((s) => s.ajustes.notificaciones);
  const formato24h = useDatos((s) => s.ajustes.formato24h);
  // Solo escribe la pestaña que se está viendo: con la app abierta en varios dispositivos o
  // pestañas, antes todos recalculaban y escribían lo mismo a la vez
  const visible = useVisible();

  useEffect(() => {
    if (!uid) return;
    // Esperamos un poco para agrupar varios cambios seguidos en una sola escritura
    const temporizador = setTimeout(async () => {
      try {
        // Hora del servidor: con el reloj del dispositivo desfasado podríamos tocar avisos
        // que la Cloud Function ya está enviando
        const ahora = ahoraServidor();
        const desde = startOfDay(ahora).getTime();
        const ocurrencias = expandirOcurrencias(
          eventos,
          excepciones,
          desde,
          addDays(desde, DIAS_VENTANA + 1).getTime(),
        );
        const deseados = generarRecordatorios({
          uid: uidActual(),
          ajustes: { notificaciones, formato24h },
          ocurrencias,
          tareas,
          rutinas,
          avisos,
          ahoraMs: ahora,
        });
        // Los avisos con la app abierta se calculan siempre, también en segundo plano
        ultimosDeseados = deseados;
        if (!visible) return;

        const existentes = await pendientesActuales(uid);
        const { crear, borrar } = diferenciaRecordatorios(
          [...existentes.values()],
          deseados,
          ahora,
        );
        if (!crear.length && !borrar.length) return;
        try {
          await enLotes(
            [
              ...borrar.map((id) => ({ id, borrar: true as const })),
              ...crear.map((r) => ({ id: r.id, datos: r })),
            ],
            (lote, op) => {
              if ('borrar' in op) lote.delete(refDoc(COLECCIONES.recordatorios, op.id));
              else {
                const { id: _id, ...datos } = op.datos;
                lote.set(refDoc(COLECCIONES.recordatorios, op.id), {
                  ...datos,
                  creadoEnMs: Date.now(),
                });
              }
            },
          );
        } catch (e) {
          // No sabemos qué ha llegado a guardarse: la próxima vez se vuelve a leer
          conocidos = null;
          throw e;
        }
        for (const id of borrar) existentes.delete(id);
        for (const r of crear) existentes.set(r.id, r);
      } catch (e) {
        console.warn('No se pudieron actualizar los recordatorios', e);
      }
    }, 3000);
    return () => clearTimeout(temporizador);
  }, [uid, eventos, excepciones, tareas, rutinas, notificaciones, formato24h, avisos, visible]);
}

// Operaciones del contador sobre el documento único users/{uid}/timerState/actual.
//
// El estado se guarda con marcas de tiempo (inicio de fase con serverTimestamp, duración y
// pausa acumulada). Cualquier dispositivo calcula el tiempo restante con esas marcas y su
// reloj corregido; por eso no hace falta un setInterval funcionando en segundo plano.
// Los cambios usan transacciones para que dos dispositivos no avancen la fase a la vez.

import {
  Timestamp,
  deleteDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { obtenerDb } from './firebase';
import {
  COLECCIONES,
  enLotes,
  limpiar,
  refColeccion,
  refDoc,
  uidActual,
  type DatosNuevos,
} from './datos';
import { useDatos } from './almacenDatos';
import { avisar } from './almacenUI';
import { t } from './textos';
import { claveDia } from './fechas';
import { ahoraServidor, idDispositivo } from './relojServidor';
import {
  calcularAvance,
  mensajeFase,
  resumirTramos,
  transcurridoMs,
  type EstadoPlano,
} from './ciclos';
import { idRecordatorio } from './recordatorios';
import { repartirPorPasos } from './rutinas';
import type {
  EstadoContador,
  FaseExpandida,
  Recordatorio,
  RegistroSesion,
  TramoSesion,
} from './tipos';

const ID = 'actual';
const refContador = () => refDoc(COLECCIONES.contador, ID);

/** Convierte el documento de Firestore (con Timestamps) a números para los cálculos. */
export function aPlano(e: EstadoContador | null): EstadoPlano | null {
  if (!e) return null;
  return {
    estado: e.estado,
    modo: e.modo,
    fases: e.fases ?? [],
    indiceFase: e.indiceFase,
    inicioFaseMs: e.inicioFase ? e.inicioFase.toMillis() : null,
    duracionFaseMs: e.duracionFaseMs,
    pausaAcumuladaMs: e.pausaAcumuladaMs,
    pausadoEnMs: e.pausadoEn ? e.pausadoEn.toMillis() : null,
  };
}

interface OpcionesInicio {
  modo: 'ciclo' | 'cronometro';
  fases: FaseExpandida[];
  etiquetaId: string | null;
  tareaId: string | null;
  eventoId: string | null;
  cicloId: string | null;
  rutinaId?: string | null;
}

/** Ya hay una sesión en marcha (en este o en otro dispositivo): no se empieza otra encima. */
export class SesionEnCurso extends Error {
  constructor() {
    super('Ya hay una sesión de foco en marcha');
    this.name = 'SesionEnCurso';
  }
}

/**
 * Empieza una sesión. Lanza `SesionEnCurso` si ya hay una: antes se sustituía sin avisar y
 * se perdía el tiempo de la sesión anterior. Se comprueba en una transacción porque la otra
 * sesión puede haberla empezado otro dispositivo hace un instante.
 */
export async function iniciarSesion(o: OpcionesInicio): Promise<void> {
  const estado = {
    estado: 'enCurso',
    modo: o.modo,
    fases:
      o.modo === 'ciclo'
        ? o.fases
        : [{ tipo: 'foco', nombre: 'Foco libre', color: '#6D5CF0', duracionMs: 0 }],
    indiceFase: 0,
    inicioFase: serverTimestamp(),
    duracionFaseMs: o.modo === 'ciclo' ? (o.fases[0]?.duracionMs ?? 0) : 0,
    pausaAcumuladaMs: 0,
    pausadoEn: null,
    etiquetaId: o.etiquetaId,
    tareaId: o.tareaId,
    eventoId: o.eventoId,
    cicloId: o.cicloId,
    rutinaId: o.rutinaId ?? null,
    sesionInicioMs: ahoraServidor(),
    interrupciones: 0,
    tramos: [],
    actualizadoPor: idDispositivo(),
    version: Date.now(),
  };
  await runTransaction(obtenerDb(), async (tx) => {
    const actual = await tx.get(refContador());
    if (actual.exists() && (actual.data() as EstadoContador).estado !== 'inactivo') {
      throw new SesionEnCurso();
    }
    tx.set(refContador(), limpiar(estado));
  });
}

/**
 * Empieza una sesión y avisa si no se puede: ya hay otra en marcha (con un botón para ir
 * al contador) o ha fallado la escritura. Devuelve true si ha empezado.
 */
export async function empezarSesionConAviso(
  o: OpcionesInicio,
  irAlContador?: () => void,
): Promise<boolean> {
  try {
    await iniciarSesion(o);
    return true;
  } catch (e) {
    if (e instanceof SesionEnCurso) {
      avisar(
        t.foco.sesionEnCurso,
        'error',
        irAlContador ? { texto: t.foco.irAlContador, ejecutar: irAlContador } : undefined,
      );
    } else {
      console.error(e);
      avisar(t.comun.error, 'error');
    }
    return false;
  }
}

/** Ejecuta un cambio dentro de una transacción leyendo el estado más reciente. */
async function cambiar(
  fn: (e: EstadoContador) => Partial<Record<keyof EstadoContador, unknown>> | null,
): Promise<void> {
  await runTransaction(obtenerDb(), async (tx) => {
    const snap = await tx.get(refContador());
    if (!snap.exists()) return;
    const actual = snap.data() as EstadoContador;
    const cambios = fn(actual);
    if (!cambios) return;
    tx.update(refContador(), {
      ...cambios,
      actualizadoPor: idDispositivo(),
      version: (actual.version ?? 0) + 1,
    });
  });
}

export function pausar(): Promise<void> {
  return cambiar((e) =>
    e.estado === 'enCurso'
      ? { estado: 'pausado', pausadoEn: serverTimestamp(), interrupciones: e.interrupciones + 1 }
      : null,
  );
}

export function reanudar(): Promise<void> {
  return cambiar((e) => {
    if (e.estado !== 'pausado' || !e.pausadoEn) return null;
    const pausa = Math.max(0, ahoraServidor() - e.pausadoEn.toMillis());
    return { estado: 'enCurso', pausadoEn: null, pausaAcumuladaMs: e.pausaAcumuladaMs + pausa };
  });
}

/**
 * Cierra la fase actual con lo que se haya hecho y pasa a la siguiente.
 * `indiceVisto` es la fase que veía el usuario al pulsar: si ya ha cambiado (doble clic,
 * otro dispositivo o el avance automático se adelantaron), no se salta nada. Si no, se
 * saltarían dos fases.
 */
export function saltarFase(indiceVisto: number): Promise<void> {
  return cambiar((e) => {
    const plano = aPlano(e)!;
    if (e.modo !== 'ciclo' || e.indiceFase >= e.fases.length) return null;
    if (e.indiceFase !== indiceVisto) return null;
    const ahora = ahoraServidor();
    // En espera la fase aún no ha empezado: no hay tramo que apuntar
    const tramo: TramoSesion | null =
      e.estado === 'esperando'
        ? null
        : {
            tipo: e.fases[e.indiceFase].tipo,
            indiceFase: e.indiceFase,
            inicioMs: plano.inicioFaseMs ?? ahora,
            finMs: ahora,
            duracionMs: transcurridoMs(plano, ahora),
          };
    const siguiente = e.indiceFase + 1;
    const terminado = siguiente >= e.fases.length;
    return {
      tramos: tramo ? [...e.tramos, tramo] : e.tramos,
      indiceFase: siguiente,
      estado: terminado
        ? 'esperando'
        : e.estado === 'pausado'
          ? 'enCurso'
          : e.estado === 'esperando'
            ? 'enCurso'
            : e.estado,
      inicioFase: serverTimestamp(),
      duracionFaseMs: terminado ? 0 : e.fases[siguiente].duracionMs,
      pausaAcumuladaMs: 0,
      pausadoEn: null,
    };
  });
}

/** Desde "esperando": empieza la fase que toca. */
export function seguir(): Promise<void> {
  return cambiar((e) => {
    if (e.estado !== 'esperando' || e.indiceFase >= e.fases.length) return null;
    return {
      estado: 'enCurso',
      inicioFase: serverTimestamp(),
      duracionFaseMs: e.fases[e.indiceFase].duracionMs,
      pausaAcumuladaMs: 0,
      pausadoEn: null,
    };
  });
}

export function añadirMinutos(minutos = 5): Promise<void> {
  return cambiar((e) =>
    e.modo === 'ciclo' && e.estado !== 'inactivo' && e.estado !== 'esperando'
      ? { duracionFaseMs: e.duracionFaseMs + minutos * 60_000 }
      : null,
  );
}

/** Acorta la fase actual para que termine en `hastaMs` (si invade un bloque protegido o un evento). */
export function cortarFaseEn(hastaMs: number): Promise<void> {
  return cambiar((e) => {
    const plano = aPlano(e)!;
    if (plano.inicioFaseMs === null) return null;
    const nuevaDuracion = Math.max(60_000, hastaMs - plano.inicioFaseMs - plano.pausaAcumuladaMs);
    return { duracionFaseMs: nuevaDuracion };
  });
}

/** Avance automático cuando la fase termina (lo hace el primer dispositivo que lo detecta). */
export function avanzarSiToca(autoAvanzar: boolean): Promise<void> {
  return cambiar((e) => {
    const r = calcularAvance(aPlano(e)!, ahoraServidor(), autoAvanzar);
    if (!r) return null;
    return {
      tramos: [...e.tramos, ...r.tramosNuevos],
      indiceFase: r.indiceFase,
      inicioFase: Timestamp.fromMillis(r.inicioFaseMs),
      duracionFaseMs: r.duracionFaseMs,
      pausaAcumuladaMs: 0,
      pausadoEn: null,
      estado: r.esperando ? 'esperando' : 'enCurso',
    };
  });
}

export interface ResumenSesion {
  inicioMs: number;
  finMs: number;
  focoRealMs: number;
  descansosMs: number;
  interrupciones: number;
  fasesCompletadas: number;
  etiquetaId: string | null;
  tareaId: string | null;
  eventoId: string | null;
  modo: 'ciclo' | 'cronometro';
}

/** Tramos de la sesión hasta ahora, incluyendo la parte hecha de la fase actual. */
function tramosHastaAhora(e: EstadoContador, ahora: number): TramoSesion[] {
  const plano = aPlano(e)!;
  const tramos = [...(e.tramos ?? [])];
  if (e.estado !== 'esperando' && e.indiceFase < e.fases.length && plano.inicioFaseMs !== null) {
    tramos.push({
      tipo: e.fases[e.indiceFase].tipo,
      indiceFase: e.indiceFase,
      inicioMs: plano.inicioFaseMs,
      finMs: ahora,
      duracionMs: transcurridoMs(plano, ahora),
    });
  }
  return tramos;
}

/** Resumen de la sesión en curso, incluyendo la parte hecha de la fase actual. */
export function resumenDe(e: EstadoContador): ResumenSesion {
  const ahora = ahoraServidor();
  const tramos = tramosHastaAhora(e, ahora);
  const { focoMs, descansoMs, fasesFoco } = resumirTramos(tramos);
  return {
    inicioMs: e.sesionInicioMs ?? tramos[0]?.inicioMs ?? ahora,
    finMs: ahora,
    focoRealMs: focoMs,
    descansosMs: descansoMs,
    interrupciones: e.interrupciones,
    fasesCompletadas: fasesFoco,
    etiquetaId: e.etiquetaId,
    tareaId: e.tareaId,
    eventoId: e.eventoId,
    modo: e.modo,
  };
}

/**
 * Guarda la sesión y deja el contador libre. Si la lanzó una rutina, se guarda un registro
 * por cada paso (con su etiqueta y su tarea) y se apunta qué pasos se han hecho.
 *
 * Todo va en un solo lote: o se guarda todo o nada. Y los ids salen del inicio de la sesión,
 * así que guardar dos veces (reintento tras un error, o desde dos dispositivos a la vez)
 * sobrescribe los mismos registros en lugar de duplicarlos.
 */
export async function terminarYGuardar(
  resumen: ResumenSesion,
  nota: string,
  valoracion: number | null,
  contador: EstadoContador | null = null,
): Promise<void> {
  const ahora = Date.now();
  const lote = writeBatch(obtenerDb());
  const idSesion = `sesion_${Math.round(resumen.inicioMs)}`;
  const guardarRegistro = (id: string, datos: DatosNuevos<RegistroSesion>) =>
    lote.set(
      refDoc(COLECCIONES.registros, id),
      limpiar({ ...datos, creadoEnMs: ahora, actualizadoEnMs: ahora }),
    );

  if (contador?.rutinaId) {
    const { pasos, hechos } = repartirPorPasos(
      contador.fases,
      tramosHastaAhora(contador, resumen.finMs),
    );
    pasos.forEach((p, i) =>
      guardarRegistro(`${idSesion}_${i}`, {
        ...resumen,
        etiquetaId: p.etiquetaId,
        tareaId: p.tareaId,
        inicioMs: p.inicioMs,
        finMs: p.finMs,
        focoRealMs: p.focoRealMs,
        descansosMs: p.descansosMs,
        // Las interrupciones son de toda la sesión: las apuntamos solo una vez
        interrupciones: i === 0 ? resumen.interrupciones : 0,
        fasesCompletadas: hechos.includes(p.pasoId) ? 1 : 0,
        nota,
        valoracion,
      }),
    );
    const totales = contador.fases.filter((f) => f.pasoId).length;
    apuntarEjecucion(lote, contador.rutinaId, hechos, totales, resumen.inicioMs, ahora);
  } else {
    guardarRegistro(idSesion, { ...resumen, nota, valoracion });
  }
  lote.delete(refContador());
  await lote.commit();
  await sincronizarRecordatoriosContador(null, true, true);
}

/** Marca en el seguimiento de la rutina los pasos hechos (sin perder los de antes). */
function apuntarEjecucion(
  lote: WriteBatch,
  rutinaId: string,
  hechos: string[],
  totales: number,
  inicioMs: number,
  ahora: number,
): void {
  // El día en que se empezó: una rutina de las 23:30 guardada a las 00:20 cuenta para ayer
  const fecha = claveDia(inicioMs);
  const previa = useDatos
    .getState()
    .ejecuciones.find((e) => e.rutinaId === rutinaId && e.fecha === fecha);
  const pasosHechos = [...new Set([...(previa?.pasosHechos ?? []), ...hechos])];
  const datos = {
    finMs: ahora,
    pasosHechos,
    pasosTotales: totales,
    completada: totales > 0 && pasosHechos.length >= totales,
    indicePaso: pasosHechos.length,
    actualizadoEnMs: ahora,
  };
  if (previa) lote.update(refDoc(COLECCIONES.ejecuciones, previa.id), datos);
  else
    lote.set(
      refDoc(COLECCIONES.ejecuciones, `${rutinaId}_${fecha}`),
      limpiar({ ...datos, rutinaId, fecha, inicioMs, inicioPasoMs: null, creadoEnMs: ahora }),
    );
}

/** Deja el contador libre sin guardar nada. */
export async function detener(): Promise<void> {
  await deleteDoc(refContador());
  await sincronizarRecordatoriosContador(null, true, true);
}

// ---------------------------------------------------------------------------
// Recordatorios de fin de fase (para recibirlos con la app cerrada)
// ---------------------------------------------------------------------------

/**
 * Prepara un recordatorio por cada cambio de fase que queda (suponiendo que no se pausa).
 * Solo lo hace el dispositivo que hizo el último cambio, para no pisarse entre ellos.
 */
export async function sincronizarRecordatoriosContador(
  e: EstadoContador | null,
  autoAvanzar: boolean,
  forzar = false,
): Promise<void> {
  if (!forzar && e && e.actualizadoPor !== idDispositivo()) return;
  const uid = uidActual();
  // Solo los pendientes: los ya enviados no se tocan y se acumularían hasta la limpieza diaria
  const existentes = await getDocs(
    query(
      refColeccion(COLECCIONES.recordatorios),
      where('tipo', '==', 'faseTemporizador'),
      where('enviado', '==', false),
    ),
  );
  const nuevos: Recordatorio[] = [];
  const plano = aPlano(e);
  if (e && plano && e.estado === 'enCurso' && e.modo === 'ciclo' && plano.inicioFaseMs !== null) {
    let fin = plano.inicioFaseMs + plano.pausaAcumuladaMs + plano.duracionFaseMs;
    const limite = e.fases.length;
    for (let i = e.indiceFase; i < limite; i++) {
      const siguiente = e.fases[i + 1];
      const titulo = siguiente ? mensajeFase(siguiente.tipo, siguiente.nombre) : 'Ciclo completado';
      const cuerpo = siguiente
        ? `${siguiente.nombre} · ${Math.round(siguiente.duracionMs / 60000)} min`
        : 'Guarda la sesión para que cuente en tus estadísticas.';
      const id = idRecordatorio('faseTemporizador', `fase${i}`, Math.round(fin));
      nuevos.push({
        id,
        uid,
        tipo: 'faseTemporizador',
        refId: `fase${i}`,
        fireAt: Math.round(fin),
        titulo,
        cuerpo,
        url: '/foco',
        enviado: false,
        creadoEnMs: Date.now(),
      });
      // Sin avance automático solo avisamos del primer cambio (luego espera al usuario)
      if (!siguiente || !autoAvanzar) break;
      fin += siguiente.duracionMs;
    }
  }
  // Lo que ya ha vencido no se toca: la Cloud Function lo envía en su siguiente pasada.
  // Borrarlo dejaría sin push a los demás dispositivos justo en el cambio de fase, y
  // reescribirlo lo volvería a marcar como no enviado.
  const ahora = ahoraServidor();
  const futuros = nuevos.filter((n) => n.fireAt > ahora);
  const idsNuevos = new Set(futuros.map((n) => n.id));
  // Solo se escribe lo que cambia: el id lleva la hora de aviso, así que si ya existe con el
  // mismo texto no hay nada que hacer. Antes se reescribían todas las fases que quedaban en
  // cada pausa o salto (unas 800 escrituras en una rutina de 20 pasos).
  const actuales = new Map(existentes.docs.map((d) => [d.id, d.data() as Recordatorio]));
  const cambiados = futuros.filter((n) => {
    const a = actuales.get(n.id);
    return !a || a.titulo !== n.titulo || a.cuerpo !== n.cuerpo;
  });
  const sobran = existentes.docs.filter(
    (d) => !idsNuevos.has(d.id) && (d.data().fireAt as number) > ahora,
  );
  if (!cambiados.length && !sobran.length) return;
  await enLotes(
    [...sobran.map((d) => ({ borrar: d.id })), ...cambiados.map((n) => ({ crear: n }))],
    (lote, op) => {
      if ('borrar' in op) lote.delete(refDoc(COLECCIONES.recordatorios, op.borrar));
      else {
        const { id, ...datos } = op.crear;
        lote.set(refDoc(COLECCIONES.recordatorios, id), datos);
      }
    },
  );
}

// Cloud Functions de MyOrganizationSchedule (2ª generación, programadas).
//
// enviarRecordatorios: cada minuto busca en todas las colecciones `reminders` los avisos cuyo
//   `fireAt` ya ha llegado y que aún no se han enviado, y manda una notificación push (FCM)
//   a los dispositivos del usuario. Requiere el plan Blaze de Firebase.
// limpiarRecordatorios: una vez al día borra los recordatorios ya enviados o caducados.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 1 });

const db = getFirestore();

/** Si un aviso llega con más de 15 minutos de retraso ya no tiene sentido enviarlo. */
const RETRASO_MAXIMO_MS = 15 * 60_000;

interface Recordatorio {
  uid: string;
  tipo: string;
  refId: string;
  fireAt: number;
  titulo: string;
  cuerpo: string;
  url: string;
  enviado: boolean;
}

interface Dispositivo {
  token?: string | null;
  tiposDesactivados?: string[];
}

/**
 * Errores de FCM que indican que el token ya no sirve (app desinstalada, permiso retirado…).
 * `messaging/invalid-argument` NO está: lo provoca también un mensaje mal formado, y
 * borraríamos tokens que funcionan.
 */
const ERRORES_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Avisos de un mismo usuario que se envían como mucho en cada pasada. Una persona real no
 * tiene más a la vez; si alguien crea miles, el resto se descarta y no retrasa a los demás.
 */
const MAX_POR_USUARIO = 20;

export const enviarRecordatorios = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Europe/Madrid',
    retryCount: 0,
    memory: '256MiB',
    timeoutSeconds: 50,
  },
  async () => {
    const ahora = Date.now();
    // Solo los que vencen ahora y no llevan más de 15 min de retraso: los más viejos ya no se
    // enviarían y no deben ocupar la cola (los borra limpiarRecordatorios)
    const pendientes = await db
      .collectionGroup('reminders')
      .where('enviado', '==', false)
      .where('fireAt', '>=', ahora - RETRASO_MAXIMO_MS)
      .where('fireAt', '<=', ahora)
      .orderBy('fireAt')
      .limit(500)
      .get();
    if (pendientes.empty) return;

    // Agrupamos por usuario para leer sus dispositivos una sola vez
    const porUsuario = new Map<string, QueryDocumentSnapshot[]>();
    for (const doc of pendientes.docs) {
      const uid = doc.ref.parent.parent?.id;
      if (!uid) continue;
      if (!porUsuario.has(uid)) porUsuario.set(uid, []);
      porUsuario.get(uid)!.push(doc);
    }

    let enviados = 0;
    let descartados = 0;
    let fallidos = 0;
    for (const [uid, todos] of porUsuario) {
      const docs = todos.slice(0, MAX_POR_USUARIO);
      const sobrantes = todos.slice(MAX_POR_USUARIO);
      if (sobrantes.length) {
        // Más avisos a la vez de los que tiene una persona: los marcamos como enviados sin
        // mandarlos para que dejen sitio en la cola a los demás usuarios
        const lote = db.batch();
        sobrantes.forEach((d) => lote.update(d.ref, { enviado: true }));
        await lote.commit();
        descartados += sobrantes.length;
        logger.warn(`Usuario ${uid}: ${sobrantes.length} avisos descartados por exceso`);
      }

      const dispositivos = await db.collection(`users/${uid}/devices`).get();
      const conToken = dispositivos.docs
        .map((d) => ({ ref: d.ref, ...(d.data() as Dispositivo) }))
        .filter((d) => typeof d.token === 'string' && d.token.length > 0);

      for (const doc of docs) {
        const r = doc.data() as Recordatorio;
        // "Reservamos" el recordatorio: si otra ejecución ya lo cambió, esta actualización falla
        let reserva;
        try {
          reserva = await doc.ref.update({ enviado: true }, { lastUpdateTime: doc.updateTime });
        } catch {
          continue;
        }
        const destinos = conToken.filter((d) => !(d.tiposDesactivados ?? []).includes(r.tipo));
        if (!destinos.length) continue;

        try {
          const respuesta = await getMessaging().sendEachForMulticast({
            tokens: destinos.map((d) => d.token as string),
            // Mensaje "solo datos": el service worker de la app decide cómo mostrarlo y adónde
            // lleva al tocarlo (con `url`). Sin fcmOptions.link: FCM exige ahí una URL absoluta.
            data: {
              id: doc.id,
              tipo: r.tipo,
              titulo: r.titulo,
              cuerpo: r.cuerpo,
              url: r.url || '/',
              // Los avisos del contador comparten etiqueta para que el nuevo sustituya al anterior
              etiqueta: r.tipo === 'faseTemporizador' ? 'mos-contador' : doc.id,
            },
            webpush: { headers: { Urgency: 'high', TTL: '900' } },
          });
          enviados += respuesta.successCount;

          // Limpiamos los tokens que ya no son válidos
          await Promise.all(
            respuesta.responses.map((res, i) =>
              !res.success && res.error && ERRORES_TOKEN.has(res.error.code)
                ? destinos[i].ref.update({ token: null })
                : null,
            ),
          );
        } catch (e) {
          // No se pudo enviar (FCM caído, sin red…): lo devolvemos a la cola para la siguiente
          // pasada, salvo que alguien lo haya cambiado mientras tanto
          fallidos++;
          logger.error(`No se pudo enviar el aviso ${doc.ref.path}`, e);
          await doc.ref
            .update({ enviado: false }, { lastUpdateTime: reserva.writeTime })
            .catch(() => undefined);
        }
      }
    }
    logger.info(
      `Recordatorios procesados: ${pendientes.size}, notificaciones enviadas: ${enviados}, descartados: ${descartados}, fallidos: ${fallidos}`,
    );
  },
);

export const limpiarRecordatorios = onSchedule(
  { schedule: 'every day 04:00', timeZone: 'Europe/Madrid', retryCount: 0, memory: '256MiB' },
  async () => {
    const limite = Date.now() - 2 * 86_400_000;
    let borrados = 0;
    for (const enviado of [true, false]) {
      // Enviados hace más de 2 días, o no enviados que caducaron hace más de 2 días
      while (true) {
        const viejos = await db
          .collectionGroup('reminders')
          .where('enviado', '==', enviado)
          .where('fireAt', '<', limite)
          .limit(400)
          .get();
        if (viejos.empty) break;
        const lote = db.batch();
        viejos.docs.forEach((d) => lote.delete(d.ref));
        await lote.commit();
        borrados += viejos.size;
      }
    }
    logger.info(`Recordatorios antiguos borrados: ${borrados}`);
  },
);

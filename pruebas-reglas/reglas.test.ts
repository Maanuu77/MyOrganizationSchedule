// Pruebas de las reglas de Firestore con el emulador.
// Ejecutar con: npm run test:reglas  (arranca el emulador, lanza las pruebas y lo apaga)

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

let entorno: RulesTestEnvironment;

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-mos',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await entorno?.cleanup();
});

beforeEach(async () => {
  await entorno.clearFirestore();
});

const ahora = Date.now();
const marcas = { creadoEnMs: ahora, actualizadoEnMs: ahora };

const etiqueta = {
  nombre: 'Matemáticas',
  color: '#6D5CF0',
  icono: 'libro',
  duracionMin: 50,
  objetivoSemanalHoras: 5,
  archivada: false,
  orden: 0,
  ...marcas,
};

const evento = {
  tipo: 'sesion',
  titulo: 'Repaso',
  inicioMs: ahora,
  finMs: ahora + 3_600_000,
  todoElDia: false,
  zonaHoraria: 'Europe/Madrid',
  etiquetaId: null,
  color: null,
  notas: '',
  recurrencia: { frecuencia: 'semanal', intervalo: 1, diasSemana: [1], fin: { tipo: 'nunca' } },
  cicloId: null,
  tareaId: null,
  completarTareaAlCompletar: false,
  rutinaId: null,
  completado: false,
  plantillaId: null,
  origenGoogle: null,
  ...marcas,
};

const tarea = {
  titulo: 'Entregar práctica',
  etiquetaId: null,
  prioridad: 'alta',
  fechaLimiteMs: ahora + 86_400_000,
  planificacion: { tipo: 'sinFecha' },
  estimacionMin: 90,
  subtareas: [],
  notas: '',
  repeticion: null,
  completada: false,
  completadaEnMs: null,
  orden: 1,
  ...marcas,
};

const db = (uid: string | null) =>
  uid
    ? entorno.authenticatedContext(uid).firestore()
    : entorno.unauthenticatedContext().firestore();

describe('propiedad de los datos', () => {
  it('el propietario puede crear y leer sus etiquetas', async () => {
    const ana = db('ana');
    await assertSucceeds(setDoc(doc(ana, 'users/ana/tags/t1'), etiqueta));
    await assertSucceeds(getDoc(doc(ana, 'users/ana/tags/t1')));
  });

  it('otro usuario no puede leer ni escribir datos ajenos', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/ana/tags/t1'), etiqueta);
    });
    const beto = db('beto');
    await assertFails(getDoc(doc(beto, 'users/ana/tags/t1')));
    await assertFails(setDoc(doc(beto, 'users/ana/tags/t2'), etiqueta));
    await assertFails(deleteDoc(doc(beto, 'users/ana/tags/t1')));
  });

  it('sin sesión no se puede hacer nada', async () => {
    await assertFails(getDoc(doc(db(null), 'users/ana/tags/t1')));
    await assertFails(setDoc(doc(db(null), 'users/ana/tags/t1'), etiqueta));
  });

  it('las colecciones fuera de users están cerradas', async () => {
    await assertFails(setDoc(doc(db('ana'), 'publico/x'), { a: 1 }));
  });
});

describe('validación de campos', () => {
  it('rechaza campos desconocidos', async () => {
    await assertFails(setDoc(doc(db('ana'), 'users/ana/tags/t1'), { ...etiqueta, admin: true }));
  });

  it('rechaza tipos incorrectos y tamaños excesivos', async () => {
    const ana = db('ana');
    await assertFails(setDoc(doc(ana, 'users/ana/tags/t1'), { ...etiqueta, duracionMin: 'mucho' }));
    await assertFails(
      setDoc(doc(ana, 'users/ana/tags/t1'), { ...etiqueta, nombre: 'x'.repeat(61) }),
    );
    await assertFails(setDoc(doc(ana, 'users/ana/tags/t1'), { ...etiqueta, nombre: '' }));
  });

  it('valida eventos: tipo, fechas coherentes y recurrencia', async () => {
    const ana = db('ana');
    await assertSucceeds(setDoc(doc(ana, 'users/ana/events/e1'), evento));
    await assertFails(setDoc(doc(ana, 'users/ana/events/e2'), { ...evento, tipo: 'fiesta' }));
    await assertFails(
      setDoc(doc(ana, 'users/ana/events/e3'), { ...evento, finMs: evento.inicioMs - 1 }),
    );
    await assertFails(
      setDoc(doc(ana, 'users/ana/events/e4'), {
        ...evento,
        recurrencia: { frecuencia: 'anual', intervalo: 1 },
      }),
    );
  });

  it('las actualizaciones parciales se validan sobre el documento completo', async () => {
    const ana = db('ana');
    await assertSucceeds(setDoc(doc(ana, 'users/ana/tasks/t1'), tarea));
    await assertSucceeds(
      updateDoc(doc(ana, 'users/ana/tasks/t1'), { completada: true, completadaEnMs: ahora }),
    );
    await assertFails(updateDoc(doc(ana, 'users/ana/tasks/t1'), { prioridad: 'máxima' }));
  });

  it('el contador solo admite el documento "actual" y marcas del servidor', async () => {
    const ana = db('ana');
    const contador = {
      estado: 'enCurso',
      modo: 'ciclo',
      fases: [{ tipo: 'foco', nombre: 'Foco', color: '#000', duracionMs: 1500000 }],
      indiceFase: 0,
      inicioFase: serverTimestamp(),
      duracionFaseMs: 1500000,
      pausaAcumuladaMs: 0,
      pausadoEn: null,
      etiquetaId: null,
      tareaId: null,
      eventoId: null,
      cicloId: null,
      rutinaId: null,
      sesionInicioMs: ahora,
      interrupciones: 0,
      tramos: [],
      actualizadoPor: 'disp1',
      version: 1,
    };
    await assertSucceeds(setDoc(doc(ana, 'users/ana/timerState/actual'), contador));
    await assertFails(setDoc(doc(ana, 'users/ana/timerState/otro'), contador));
    await assertFails(
      setDoc(doc(ana, 'users/ana/timerState/actual'), { ...contador, estado: 'volando' }),
    );
  });

  it('los recordatorios deben pertenecer al mismo usuario', async () => {
    const ana = db('ana');
    const r = {
      uid: 'ana',
      tipo: 'inicioBloque',
      refId: 'x',
      fireAt: ahora,
      titulo: 'Clase',
      cuerpo: '',
      url: '/',
      enviado: false,
      creadoEnMs: ahora,
    };
    await assertSucceeds(setDoc(doc(ana, 'users/ana/reminders/r1'), r));
    await assertFails(setDoc(doc(ana, 'users/ana/reminders/r2'), { ...r, uid: 'beto' }));
  });

  it('los dispositivos admiten escrituras parciales con merge', async () => {
    const ana = db('ana');
    await assertSucceeds(
      setDoc(
        doc(ana, 'users/ana/devices/d1'),
        { nombre: 'Chrome', ultimoUsoMs: ahora, ping: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(ana, 'users/ana/devices/d1'),
        { token: 'abc', creadoEnMs: ahora },
        { merge: true },
      ),
    );
    await assertFails(setDoc(doc(ana, 'users/ana/devices/d1'), { token: 123 }, { merge: true }));
  });

  it('los ajustes solo van en settings/general', async () => {
    const ana = db('ana');
    const ajustes = {
      tema: 'oscuro',
      colorAcento: '#5B4BDB',
      densidad: 'normal',
      pantallaInicio: 'hoy',
      inicioSemana: 1,
      formato24h: true,
      zonaHoraria: 'Europe/Madrid',
      duracionPorDefectoMin: 60,
      sueno: { activo: false, inicio: '23:30', fin: '07:30' },
      umbrales: {
        focoDiarioMaxHoras: 8,
        sesionesSeguidasMax: 3,
        descansoMinimoMin: 10,
        diasAvisoFechaLimite: 3,
      },
      temporizador: {
        sonido: true,
        vibracion: true,
        volumen: 0.7,
        focoContinuoMaxMin: 120,
        autoAvanzar: true,
      },
      notificaciones: {
        activas: false,
        antelacionMin: 10,
        tipos: {},
        silencio: { activo: true, inicio: '23:00', fin: '07:00' },
        resumenDiarioHora: '08:00',
      },
      onboardingCompletado: true,
      actualizadoEnMs: ahora,
    };
    await assertSucceeds(setDoc(doc(ana, 'users/ana/settings/general'), ajustes));
    await assertFails(setDoc(doc(ana, 'users/ana/settings/otros'), ajustes));
    await assertFails(
      setDoc(doc(ana, 'users/ana/settings/general'), {
        ...ajustes,
        sueno: { activo: true, inicio: '25h', fin: '07:00' },
      }),
    );
  });
});

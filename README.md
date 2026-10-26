# MyOrganizationSchedule

Aplicación web (PWA instalable) para organizar el tiempo: **calendario visual**, **sesiones de estudio con contador**, **rutinas**, **tareas** y **estadísticas**, sincronizada en tiempo real entre dispositivos.

La idea central: arrastras una **etiqueta** (una asignatura, un proyecto…) al calendario, se crea una **sesión de estudio**, y al empezarla el **contador** te dice cuándo parar y cuándo seguir. Todo lo que haces se convierte en estadísticas de lo planificado frente a lo real.

- La app arranca **vacía**: no trae datos de ejemplo. Un onboarding de 3 pasos te ayuda a empezar.
- **Sin IA** dentro de la app. Tú creas tu horario; la app solo avisa de problemas.
- Interfaz en **español**, con todos los textos centralizados en [`src/textos.ts`](src/textos.ts).
- Arquitectura **multiusuario**: cada usuario solo puede leer y escribir sus propios datos.

## Funcionalidades

| Área            | Qué incluye                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso          | Inicio de sesión con Google, onboarding (etiquetas, tema, notificaciones)                                                                                                                                                                                                                                     |
| Etiquetas       | Nombre, color, icono, duración por defecto y objetivo semanal; archivar y borrar                                                                                                                                                                                                                              |
| Calendario      | Vistas Día, Semana, Mes y Agenda; crear arrastrando; mover, redimensionar y duplicar; recurrencia (diaria, semanal, mensual, personalizada) con "solo este / este y siguientes / todos"; bloques protegidos; plantilla semanal; panel de etiquetas y tareas arrastrables                                      |
| Foco            | Editor de ciclos (fases de foco, descansos y personalizadas), plantillas de arranque opcionales (25/5, 50/10, 90/20), contador sincronizado entre dispositivos, +5 min, saltar fase, cronómetro libre, aviso de foco continuo, aviso si invades un bloque protegido, registro de sesión con nota y valoración |
| Rutinas         | Sucesión de pasos (qué hacer, minutos, etiqueta y tarea) con descansos automáticos editables; se empiezan en el contador, que avisa en cada cambio y muestra «Ahora / Después»; el tiempo se guarda por paso y etiqueta; días opcionales, racha y cumplimiento                                                |
| Tareas          | Vista Hoy (pestaña, panel fijo en escritorio y hoja en móvil), prioridades, fecha límite, estimación, subtareas, repetición, backlog flexible ("Esta semana" y "Sin fecha"), arrastrar al calendario                                                                                                          |
| Avisos          | Solapes, exceso de foco, sesiones seguidas sin descanso, fechas límite sin tiempo, bloques en horario de sueño                                                                                                                                                                                                |
| Estadísticas    | Día, semana, mes, año y rango con comparación; planificado vs. real por etiqueta; objetivos; mapa de calor anual; distribución por día y hora; rachas; exportación CSV y JSON                                                                                                                                 |
| Notificaciones  | Push con Firebase Cloud Messaging (Cloud Function cada minuto), silencio nocturno, ajuste por tipo y por dispositivo; avisos en primer plano sin servidor                                                                                                                                                     |
| Google Calendar | Importar y exportar con "Sincronizar ahora", sin duplicados, gana el último cambio                                                                                                                                                                                                                            |
| Ajustes         | Tema claro/oscuro/sistema, color de acento, densidad, pantalla de inicio, formato horario, zona horaria, umbrales, sonidos, exportar/importar JSON, borrar cuenta                                                                                                                                             |

## Cómo ejecutarla

Requisitos: **Node 22 o superior** (y Java 11+ solo para los emuladores de Firebase).

```bash
npm install
```

1. Copia `.env.example` como `.env` y rellena las variables de tu proyecto de Firebase (paso a paso en [SETUP.md](SETUP.md)).
2. Arranca el servidor de desarrollo:

```bash
npm run dev
```

Si faltan las variables de Firebase, la app muestra una pantalla explicando qué falta (no se queda en blanco).

### Probar sin un proyecto real (emuladores)

Crea un `.env.local` con valores de prueba y `VITE_USAR_EMULADORES=true` (ver [SETUP.md](SETUP.md#probar-en-local-con-emuladores)) y arranca los emuladores en otra terminal:

```bash
npx firebase emulators:start --only auth,firestore --project demo-mos
```

## Scripts

| Script                | Qué hace                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`         | Servidor de desarrollo de Vite                                                                                         |
| `npm run build`       | Comprueba los tipos y compila la app para producción en `dist/`                                                        |
| `npm run preview`     | Sirve la versión compilada                                                                                             |
| `npm run lint`        | ESLint                                                                                                                 |
| `npm run format`      | Prettier                                                                                                               |
| `npm run typecheck`   | Solo comprobación de tipos                                                                                             |
| `npm test`            | Tests unitarios (Vitest) de los motores: ciclos y contador, recurrencia, avisos, estadísticas, rutinas y recordatorios |
| `npm run test:reglas` | Pruebas de `firestore.rules` con el emulador de Firestore                                                              |
| `npm run deploy`      | Compila y despliega todo con Firebase CLI                                                                              |

## Estructura del proyecto

La carpeta `src/` es **plana**: un archivo por pantalla, componente, hook o módulo de lógica, sin subcarpetas. Los nombres indican qué es cada cosa:

| Prefijo / tipo                | Ejemplos                                                                                                                | Qué contiene                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Pantalla*.tsx`               | `PantallaCalendario.tsx`, `PantallaFoco.tsx`                                                                            | Una pantalla (ruta) de la app. Se cargan bajo demanda                              |
| `Vista*.tsx`                  | `VistaTiempo.tsx`, `VistaMes.tsx`                                                                                       | Vistas del calendario                                                              |
| `Editor*.tsx`, `Dialogo*.tsx` | `EditorBloque.tsx`, `DialogoFechaHora.tsx`                                                                              | Formularios en hoja modal                                                          |
| Componentes (PascalCase)      | `TarjetaTarea.tsx`, `AnilloProgreso.tsx`, `Modal.tsx`                                                                   | Piezas de interfaz reutilizables                                                   |
| `use*.ts`                     | `useTemporizador.ts`, `useSincronizacion.ts`                                                                            | Hooks de React                                                                     |
| `almacen*.ts`                 | `almacenDatos.ts`, `almacenUI.ts`                                                                                       | Estado global con Zustand (datos de Firestore y estado de interfaz)                |
| Lógica pura (minúsculas)      | `recurrencia.ts`, `ciclos.ts`, `avisosCarga.ts`, `estadisticas.ts`, `rutinas.ts`, `recordatorios.ts`, `distribucion.ts` | Motores sin React ni Firebase, probados con Vitest                                 |
| Acceso a datos                | `datos.ts`, `operaciones.ts`, `temporizador.ts`, `googleCalendar.ts`                                                    | Lecturas/escrituras en Firestore y APIs externas                                   |
| Base                          | `tipos.ts`, `textos.ts`, `tema.css`, `fechas.ts`, `firebase.ts`, `sw.ts`                                                | Tipos compartidos, textos, tokens de diseño, utilidades, Firebase y service worker |
| `*.test.ts`                   | `recurrencia.test.ts`                                                                                                   | Tests unitarios junto al módulo que prueban                                        |

Fuera de `src/`:

- `functions/` — Cloud Functions (envío de recordatorios push cada minuto y limpieza diaria).
- `public/` — logotipo e iconos de la PWA.
- `pruebas-reglas/` — pruebas de las reglas de Firestore.
- `scripts/` — utilidades (generar los iconos PNG a partir del diseño del logotipo).
- `firestore.rules`, `firestore.indexes.json`, `firebase.json` — configuración de Firebase.
- `.github/workflows/desplegar.yml` — CI/CD: comprueba y despliega en cada push a `main`.

### Cómo fluyen los datos

1. `useSincronizacion` abre un oyente en tiempo real (`onSnapshot`) por colección y vuelca los datos en `almacenDatos` (Zustand). Firestore es la única fuente de verdad; `localStorage` solo guarda preferencias de interfaz (vista del calendario, panel abierto, tema para evitar parpadeos).
2. Las pantallas leen del almacén y derivan información con funciones puras (por ejemplo, `expandirOcurrencias` convierte eventos con recurrencia en las ocurrencias visibles).
3. Las acciones del usuario llaman a `operaciones.ts` / `datos.ts`, que escriben en Firestore. El cambio vuelve por el oyente y la interfaz se actualiza sola, en este y en los demás dispositivos.

### El contador sincronizado

El documento `users/{uid}/timerState/actual` guarda **marcas de tiempo**, no "segundos restantes": inicio de la fase (`serverTimestamp`), duración, pausa acumulada y estado. Cada dispositivo calcula el tiempo restante con su reloj corregido con el del servidor (`relojServidor.ts`), así que todos marcan lo mismo y no hace falta un `setInterval` en segundo plano. Los cambios se hacen con transacciones para que dos dispositivos no avancen la fase a la vez. Ver [`temporizador.ts`](src/temporizador.ts) y [`ciclos.ts`](src/ciclos.ts).

## Documentación

- [SETUP.md](SETUP.md) — lo que tienes que configurar tú (Firebase, Blaze, Google Calendar, GitHub).
- [DECISIONES.md](DECISIONES.md) — decisiones de diseño y técnicas tomadas durante el desarrollo.

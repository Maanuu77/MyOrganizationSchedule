# SETUP · Lo que tienes que configurar tú

La app está lista para funcionar en cuanto rellenes el archivo `.env` con los datos de tu proyecto de Firebase. Estos son los pasos que solo puedes hacer tú (necesitan tu cuenta de Google).

> Tiempo aproximado: 20–30 minutos la primera vez.

## 1. Crear el proyecto de Firebase

1. Entra en <https://console.firebase.google.com> y pulsa **Crear un proyecto** (por ejemplo `my-organization-schedule`). Google Analytics no es necesario.
2. En **Configuración del proyecto** (icono ⚙️) → **General** → **Tus apps**, pulsa el icono **Web** (`</>`), ponle un nombre y marca **También configurar Firebase Hosting**.
3. Copia los valores que aparecen en `firebaseConfig`. Los usarás en el paso 6.

## 2. Activar Authentication con Google

1. **Compilación → Authentication → Comenzar**.
2. Pestaña **Método de inicio de sesión** → **Google** → **Habilitar**, elige el correo de asistencia y guarda.
3. Pestaña **Configuración → Dominios autorizados**: `localhost` ya está. Cuando despliegues, añade también tu dominio de Hosting (`TU-PROYECTO.web.app` suele añadirse solo).

## 3. Crear la base de datos Firestore

1. **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación recomendada: `eur3 (europe-west)` o `europe-southwest1` (Madrid). **No se puede cambiar después.**
3. Empieza en **modo de producción** (las reglas de verdad se suben en el paso 8).

## 4. Cloud Messaging (notificaciones push)

1. **Configuración del proyecto → Cloud Messaging**.
2. En **Configuración web → Certificados push web**, pulsa **Generar par de claves**.
3. Copia la clave pública: es `VITE_FIREBASE_VAPID_KEY`.

Sin esta clave la app funciona igual, pero solo te avisará con la app abierta.

## 5. Activar el plan Blaze (para las Cloud Functions)

Las notificaciones con la app cerrada las envía una **Cloud Function programada cada minuto**, y las funciones programadas requieren el plan **Blaze** (pago por uso).

1. En la consola, abajo a la izquierda: **Actualizar → Blaze**, y vincula una cuenta de facturación.
2. Recomendado: en Google Cloud → **Facturación → Presupuestos y alertas**, crea un presupuesto de 1 € con alerta. Para uso personal el coste esperado es 0 € (la función tarda milisegundos y Cloud Scheduler incluye 3 tareas gratis al mes).

**Si no activas Blaze:** todo funciona salvo los avisos con la app cerrada. Con la app abierta (o en una pestaña en segundo plano) sigues recibiendo los avisos de bloques, rutinas y del contador, con sonido y notificación del sistema.

## 6. Rellenar el archivo `.env`

En la carpeta del proyecto:

```bash
cp .env.example .env
```

Abre `.env` y pega los valores del paso 1 y la clave VAPID del paso 4:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
VITE_FIREBASE_VAPID_KEY=BExxxx...
VITE_USAR_EMULADORES=false
```

> Estos valores de Firebase web no son secretos (van dentro de la app que descarga el navegador); la seguridad la ponen las reglas de Firestore. Aun así, `.env` está en `.gitignore` y no se sube al repositorio.

Arranca la app con `npm run dev` y entra con tu cuenta de Google.

## 7. Instalar Firebase CLI y vincular el proyecto

```bash
npx firebase login
```

```bash
npx firebase use --add
```

Elige tu proyecto y ponle el alias `default`. Se crea el archivo `.firebaserc`.

## 8. Subir reglas, índices y Cloud Functions

```bash
npx firebase deploy --only firestore:rules,firestore:indexes
```

Con el plan Blaze activo:

```bash
npx firebase deploy --only functions
```

La primera vez Firebase activa automáticamente las APIs necesarias (Cloud Functions, Cloud Build, Cloud Scheduler, Artifact Registry). Si pregunta por la política de limpieza de imágenes, acepta el valor por defecto.

Para desplegar la web a mano:

```bash
npm run deploy
```

## 9. Google Calendar (opcional)

1. Abre <https://console.cloud.google.com> y selecciona **el mismo proyecto** que Firebase.
2. **APIs y servicios → Biblioteca** → busca **Google Calendar API** → **Habilitar**.
3. **APIs y servicios → Pantalla de consentimiento de OAuth** (Google Auth Platform):
   - Tipo de usuario **Externo**, nombre de la app, correo de asistencia y de contacto.
   - En **Acceso a datos / Permisos (scopes)** añade:
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - En **Público / Usuarios de prueba**, añade tu correo de Google. Mientras la app esté "en pruebas" solo esos usuarios pueden conectar el calendario (no hace falta verificación de Google para uso personal).
4. En la app: **Ajustes → Google Calendar → Conectar**, elige el calendario de importación y el de exportación y pulsa **Sincronizar ahora**.

## 10. Secretos de GitHub para el despliegue automático

El flujo `.github/workflows/desplegar.yml` comprueba la app en cada push y, si hay secretos, la despliega en Firebase Hosting.

1. Crea una cuenta de servicio para GitHub:

```bash
npx firebase init hosting:github
```

   Responde con tu repositorio `Maanuu77/MyOrganizationSchedule`. El asistente crea el secreto `FIREBASE_SERVICE_ACCOUNT_...` en GitHub. **Renómbralo** (o crea otro con el mismo valor) como `FIREBASE_SERVICE_ACCOUNT`. Si el asistente crea archivos nuevos en `.github/workflows/`, bórralos: el flujo del proyecto ya está preparado.

   Alternativa manual: Google Cloud → **IAM → Cuentas de servicio → Crear**, con los roles *Firebase Hosting Admin*, *Cloud Functions Admin*, *Firebase Rules Admin*, *Cloud Datastore Index Admin* y *Service Account User*; crea una clave JSON y pega su contenido completo como secreto `FIREBASE_SERVICE_ACCOUNT`.

2. En GitHub → **Settings → Secrets and variables → Actions → New repository secret**, crea también:

| Secreto | Valor |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | igual que en `.env` |
| `VITE_FIREBASE_AUTH_DOMAIN` | igual que en `.env` |
| `VITE_FIREBASE_PROJECT_ID` | igual que en `.env` |
| `VITE_FIREBASE_STORAGE_BUCKET` | igual que en `.env` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | igual que en `.env` |
| `VITE_FIREBASE_APP_ID` | igual que en `.env` |
| `VITE_FIREBASE_VAPID_KEY` | igual que en `.env` |
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio |

3. Opcional: para que el flujo despliegue también reglas, índices y Cloud Functions, crea en **Variables** la variable `DESPLEGAR_BACKEND` con valor `true` (requiere Blaze).

## Probar en local con emuladores

Sin proyecto real puedes probar todo con los emuladores de Firebase (necesitas Java 11+). Crea `.env.local`:

```
VITE_FIREBASE_API_KEY=demo-clave
VITE_FIREBASE_AUTH_DOMAIN=demo-mos.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-mos
VITE_FIREBASE_STORAGE_BUCKET=demo-mos.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000
VITE_USAR_EMULADORES=true
```

En una terminal:

```bash
npx firebase emulators:start --only auth,firestore --project demo-mos
```

En otra:

```bash
npm run dev
```

Al pulsar "Entrar con Google" aparece la ventana del emulador, donde puedes crear un usuario de prueba. Las notificaciones push no funcionan con emuladores.

## Problemas frecuentes

- **"Falta configurar Firebase"**: alguna variable `VITE_FIREBASE_*` está vacía. Revisa `.env` y reinicia `npm run dev`.
- **La ventana de Google no aparece**: el navegador está bloqueando ventanas emergentes para `localhost`.
- **`Missing or insufficient permissions`**: no se han subido las reglas (paso 8).
- **`The query requires an index`** en los logs de la función: sube los índices (paso 8) y espera unos minutos.
- **No llegan notificaciones con la app cerrada**: comprueba el plan Blaze, que la función `enviarRecordatorios` esté desplegada (`npx firebase functions:log`), que el dispositivo aparezca con "Push" en Ajustes y que el silencio nocturno no esté activo.

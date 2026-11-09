// Enlaces y datos de contacto públicos de la app (los usan la política de privacidad, la
// pantalla de acceso y Ajustes). El responsable y el correo salen del .env para que cada
// despliegue ponga los suyos; si faltan, se usa el repositorio de GitHub.

import { t } from './textos';

export const URL_REPOSITORIO = 'https://github.com/Maanuu77/MyOrganizationSchedule';
export const URL_PROBLEMAS = `${URL_REPOSITORIO}/issues/new`;
export const RUTA_PRIVACIDAD = '/privacidad';

const env = import.meta.env;

/** Quién es el responsable de los datos (RGPD). */
export const responsable: string = env.VITE_RESPONSABLE_NOMBRE || t.legal.responsablePorDefecto;

/** Correo de contacto, o las issues de GitHub si no hay correo configurado. */
export const contacto: string = env.VITE_CONTACTO_EMAIL || URL_PROBLEMAS;

// Pantalla que se ve si no se pueden cargar los datos principales (sin permisos, cuota
// agotada, sin conexión la primera vez…). Antes se mostraba la bienvenida con los ajustes
// por defecto, y al completarla se sobrescribían los ajustes reales.
import { TriangleAlert } from 'lucide-react';
import { Boton } from './Boton';
import { cerrarSesion } from './useSincronizacion';
import { t } from './textos';

export function PantallaErrorCarga() {
  return (
    <div className="grid min-h-dvh place-items-center p-6" role="alert">
      <div className="tarjeta max-w-sm p-6 text-center">
        <TriangleAlert size={36} className="mx-auto mb-3 text-aviso" aria-hidden />
        <h1 className="mb-2 text-xl font-extrabold">{t.app.errorCargaTitulo}</h1>
        <p className="mb-5 text-sm text-texto-suave">{t.app.errorCargaTexto}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Boton variante="primario" onClick={() => window.location.reload()}>
            {t.app.reintentar}
          </Boton>
          <Boton variante="fantasma" onClick={() => void cerrarSesion()}>
            {t.ajustes.cerrarSesion}
          </Boton>
        </div>
      </div>
    </div>
  );
}

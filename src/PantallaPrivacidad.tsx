// Política de privacidad. Es pública (se ve sin iniciar sesión): la exigen el RGPD y Google
// para verificar el permiso de Google Calendar.
import { ArrowLeft } from 'lucide-react';
import { Logo } from './Logo';
import { contacto, responsable } from './enlaces';
import { t } from './textos';

export function PantallaPrivacidad() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <a
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-texto-suave hover:text-texto"
      >
        <ArrowLeft size={16} aria-hidden /> {t.legal.volver}
      </a>
      <div className="mb-6 flex items-center gap-3">
        <Logo tamano={40} />
        <p className="font-titulos text-lg font-extrabold">{t.app.nombre}</p>
      </div>
      <h1 className="text-3xl font-extrabold">{t.legal.privacidad}</h1>
      <p className="mt-1 text-sm text-texto-tenue">{t.legal.actualizada}</p>
      <div className="mt-8 space-y-7">
        {t.legal.secciones(responsable, contacto).map((s) => (
          <section key={s.titulo}>
            <h2 className="mb-2 text-lg font-bold">{s.titulo}</h2>
            <div className="space-y-2 text-sm leading-relaxed text-texto-suave">
              {s.parrafos.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

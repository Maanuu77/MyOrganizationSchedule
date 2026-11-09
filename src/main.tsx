// Punto de entrada: monta React y registra el service worker de la PWA.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MotionConfig } from 'motion/react';
import './tema.css';
import { App } from './App';
import { registrarServiceWorker } from './serviceWorker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user": si el sistema pide menos movimiento, las animaciones se suavizan */}
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MotionConfig>
  </StrictMode>,
);

registrarServiceWorker();

// Tras publicar una versión nueva, una pestaña que se abrió antes sigue con el código viejo y,
// al entrar en una pantalla que aún no había cargado, pide un archivo que ya no existe. En vez
// de enseñar el error, recargamos una vez para coger la versión nueva (solo una vez por
// minuto, para no entrar en bucle si el problema es otro).
window.addEventListener('vite:preloadError', (evento) => {
  const clave = 'mos-recarga-version';
  try {
    const ultima = Number(sessionStorage.getItem(clave) ?? 0);
    if (Date.now() - ultima < 60_000) return;
    sessionStorage.setItem(clave, String(Date.now()));
  } catch {
    // Sin sessionStorage (modo privado estricto): recargamos igualmente
  }
  evento.preventDefault();
  window.location.reload();
});

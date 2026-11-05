/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

/** Navegadores mínimos para los que se compila la app. */
const NAVEGADORES = ['es2020', 'safari15', 'ios15', 'chrome100', 'edge100', 'firefox100'];

const version = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
    version: string;
  }
).version;

// Configuración de Vite: React, Tailwind y la PWA con un único service worker propio (src/sw.ts)
// que gestiona la caché de la app y las notificaciones de Firebase Cloud Messaging.
export default defineConfig({
  define: {
    __VERSION_APP__: JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Solo precargamos las fuentes latinas (el resto se descargan si hicieran falta)
        globIgnores: ['**/*-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese}-*.woff2'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: true, type: 'module' },
      includeAssets: ['logo.svg', 'favicon.svg'],
      manifest: {
        name: 'MyOrganizationSchedule',
        short_name: 'MOS',
        description:
          'Planifica tu día, tu semana y tu mes con calendario, rutinas, tareas y sesiones de foco.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f0e1a',
        theme_color: '#5b4bdb',
        categories: ['productivity', 'education'],
        icons: [
          { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/iconos/icono-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  build: {
    // Por defecto Vite compila solo para navegadores muy recientes (Safari 16.4+).
    // Bajamos el objetivo para que funcione también en Safari 15 (Mac sin actualizar).
    target: NAVEGADORES,
    cssTarget: NAVEGADORES,
    rollupOptions: {
      output: {
        // Separamos librerías grandes para que la primera carga sea más rápida.
        // Cada grupo se lleva también las dependencias de sus módulos, así que el orden importa:
        // el de más prioridad elige primero. React va en su grupo antes que los gráficos: si
        // no, acababa dentro del trozo de Recharts (~115 KB comprimidos) y ese trozo se
        // descargaba al abrir cualquier pantalla.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
            // Firebase sin la parte del push, que solo se descarga al activar los avisos
            // (useNotificaciones la importa bajo demanda). Va antes para quedarse con lo que
            // comparten (app, util…) y que el trozo del push no se cargue al principio.
            {
              name: 'firebase',
              test: /node_modules[\\/]@?firebase[\\/](?!messaging)/,
              priority: 30,
            },
            {
              name: 'firebase-mensajeria',
              test: /node_modules[\\/]@?firebase[\\/]messaging/,
              priority: 20,
            },
            {
              name: 'graficos',
              test: /node_modules[\\/](recharts|d3-|victory-vendor)/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Los tests de fechas se ejecutan siempre en la misma zona horaria
    env: { TZ: 'Europe/Madrid' },
  },
});

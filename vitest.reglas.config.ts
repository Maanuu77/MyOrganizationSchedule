import { defineConfig } from 'vitest/config';

// Configuración aparte para las pruebas de las reglas de Firestore.
// Se ejecutan con el emulador: npm run test:reglas
export default defineConfig({
  test: {
    environment: 'node',
    include: ['pruebas-reglas/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});

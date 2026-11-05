import { describe, expect, it } from 'vitest';
import { siguienteFecha } from './operaciones';
import { tareaPrueba } from './ayudaPruebas';
import { desdeClaveDia } from './fechas';

describe('siguienteFecha (tareas que se repiten)', () => {
  it('la mensual del día 31 vuelve al 31 después de un mes corto', () => {
    const tarea = tareaPrueba({
      repeticion: { frecuencia: 'mensual', intervalo: 1, diaMes: 31 },
    });
    expect(siguienteFecha(tarea, desdeClaveDia('2026-01-31'))).toBe('2026-02-28');
    expect(siguienteFecha(tarea, desdeClaveDia('2026-02-28'))).toBe('2026-03-31');
  });

  it('sin día ancla usa el día de la tarea', () => {
    const tarea = tareaPrueba({ repeticion: { frecuencia: 'mensual', intervalo: 1 } });
    expect(siguienteFecha(tarea, desdeClaveDia('2026-01-15'))).toBe('2026-02-15');
  });

  it('cada 2 semanas respeta que la semana empiece en domingo', () => {
    // Sábado 7-nov y domingo; con semanas de domingo a sábado, el domingo 8 ya es otra semana
    const tarea = tareaPrueba({
      repeticion: { frecuencia: 'semanal', intervalo: 2, diasSemana: [0, 6] },
    });
    expect(siguienteFecha(tarea, desdeClaveDia('2026-11-07'), 0)).toBe('2026-11-15');
    // Con semanas de lunes a domingo, el domingo 8 es de la misma semana
    expect(siguienteFecha(tarea, desdeClaveDia('2026-11-07'), 1)).toBe('2026-11-08');
  });
});

// Cálculos de fechas en los días de cambio de hora (los tests corren con TZ=Europe/Madrid):
// el 29-mar-2026 dura 23 horas y el 25-oct-2026, 25.
import { describe, expect, it } from 'vitest';
import {
  diferenciaDeReloj,
  finDeDia,
  instanteEnDia,
  minutoEnDia,
  minutosDelDia,
  moverComoReloj,
} from './fechas';
import { colocarBloques } from './distribucion';
import { ocurrenciaPrueba } from './ayudaPruebas';

const HORA = 3_600_000;
const marzo29 = new Date(2026, 2, 29);
const octubre25 = new Date(2026, 9, 25);

describe('días de cambio de hora', () => {
  it('el día dura 23 o 25 horas', () => {
    expect(finDeDia(marzo29) - marzo29.getTime()).toBe(23 * HORA);
    expect(finDeDia(octubre25) - octubre25.getTime()).toBe(25 * HORA);
  });

  it('el minuto de la rejilla es la hora del reloj', () => {
    const diezDeMarzo = new Date(2026, 2, 29, 10).getTime();
    expect(minutoEnDia(diezDeMarzo, marzo29.getTime())).toBe(600);
    expect(instanteEnDia(marzo29, 600)).toBe(diezDeMarzo);
    // Las 23:30 del 25-oct: a más de 24 h del inicio del día, pero sigue siendo ese día
    const nocheOctubre = new Date(2026, 9, 25, 23, 30).getTime();
    expect(minutoEnDia(nocheOctubre, octubre25.getTime())).toBe(23 * 60 + 30);
    expect(instanteEnDia(octubre25, 1440)).toBe(new Date(2026, 9, 26).getTime());
  });

  it('mover «como el reloj» conserva la hora aunque cambie el horario', () => {
    const viernes = new Date(2026, 2, 27, 9).getTime();
    const lunes = moverComoReloj(viernes, 3, 30);
    expect(new Date(lunes).getDate()).toBe(30);
    expect(minutosDelDia(lunes)).toBe(9 * 60 + 30);
    expect(diferenciaDeReloj(viernes, lunes)).toEqual({ dias: 3, minutos: 30 });
  });

  it('un bloque de las 23:30 del día de 25 horas se ve en su día', () => {
    const oc = ocurrenciaPrueba('noche', new Date(2026, 9, 25, 23, 30), 30);
    const [colocado] = colocarBloques([oc], octubre25.getTime());
    expect(colocado.inicioMin).toBe(23 * 60 + 30);
    expect(colocado.finMin).toBe(1440);
  });

  it('un bloque de las 10:00 del día de 23 horas sale en la fila de las 10:00', () => {
    const oc = ocurrenciaPrueba('clase', new Date(2026, 2, 29, 10), 60);
    const [colocado] = colocarBloques([oc], marzo29.getTime());
    expect(colocado.inicioMin).toBe(600);
    expect(colocado.finMin).toBe(660);
  });
});

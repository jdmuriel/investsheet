import { describe, expect, it } from 'vitest';
import { goalProgress, yearFraction } from './goals.ts';
import type { YearMetrics } from './types.ts';

// Todos los datos de estas pruebas son inventados.
const metrics: YearMetrics = { year: 2031, capital: 50000, gross: 30000, tax: 5000, fees: 1000, purchases: 0, realizedGain: 0 };

describe('objetivos anuales', () => {
	it('calcula la consecución solo de las métricas con objetivo, en el orden de la cabecera', () => {
		const rows = goalProgress(metrics, { netYield: 48000, capital: 100000, fees: 2000 });
		expect(rows.map((r) => r.key)).toEqual(['capital', 'fees', 'netYield']);
		expect(rows[0]).toMatchObject({ goal: 100000, actual: 50000, achieved: 0.5 });
		expect(rows[1]).toMatchObject({ actual: 1000, achieved: 0.5, ceiling: true });
		expect(rows[2]).toMatchObject({ actual: 24000, achieved: 0.5 });
	});

	it('sin movimientos en el año lo conseguido es cero, y un objetivo de cero no da porcentaje', () => {
		expect(goalProgress(undefined, { gross: 10000 })).toEqual([{ key: 'gross', label: 'Ingresos brutos', goal: 10000, actual: 0, achieved: 0, ceiling: false }]);
		expect(goalProgress(metrics, { purchases: 0 })[0].achieved).toBeNull();
	});

	it('mide la fracción de año transcurrida al cierre del día', () => {
		expect(yearFraction(2031, '2031-01-01')).toBeCloseTo(1 / 365);
		expect(yearFraction(2031, '2031-07-02')).toBeCloseTo(183 / 365);
		expect(yearFraction(2031, '2031-12-31')).toBe(1);
		expect(yearFraction(2032, '2032-12-30')).toBeCloseTo(365 / 366);
		expect(yearFraction(2031, '2030-12-31')).toBe(0);
		expect(yearFraction(2031, '2032-03-01')).toBe(1);
	});
});

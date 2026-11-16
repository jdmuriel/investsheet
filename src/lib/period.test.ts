import { describe, expect, it } from 'vitest';
import { inPeriod, resolvePeriod } from './period.ts';

describe('periodos del listado', () => {
	it('por defecto, el mes anterior completo y el mes en curso', () => {
		expect(resolvePeriod(null, '2025-05-20')).toEqual({ key: 'ultimos', from: '2025-04-01', to: null, year: 2025 });
		expect(resolvePeriod('cualquiera', '2025-01-03').from).toBe('2024-12-01');
	});

	it('mes, trimestre y año en curso', () => {
		expect(resolvePeriod('mes', '2025-05-20').from).toBe('2025-05-01');
		expect(resolvePeriod('trimestre', '2025-05-20').from).toBe('2025-04-01');
		expect(resolvePeriod('trimestre', '2025-12-31').from).toBe('2025-10-01');
		expect(resolvePeriod('trimestre', '2025-03-01').from).toBe('2025-01-01');
		expect(resolvePeriod('actual', '2025-05-20')).toMatchObject({ key: 'actual', from: '2025-01-01', to: null });
		// El año en curso pedido por su número es la misma opción.
		expect(resolvePeriod('2025', '2025-05-20').key).toBe('actual');
	});

	it('años anteriores y todo', () => {
		expect(resolvePeriod('2023', '2025-05-20')).toEqual({ key: '2023', from: '2023-01-01', to: '2023-12-31', year: 2023 });
		expect(resolvePeriod('todos', '2025-05-20')).toEqual({ key: 'todos', from: null, to: null, year: null });
	});

	it('pertenencia al periodo', () => {
		const period = resolvePeriod('2023', '2025-05-20');
		expect(inPeriod('2023-12-31', period)).toBe(true);
		expect(inPeriod('2024-01-01', period)).toBe(false);
		// Los periodos en curso incluyen también lo anotado con fecha futura.
		expect(inPeriod('2025-06-01', resolvePeriod('mes', '2025-05-20'))).toBe(true);
	});
});

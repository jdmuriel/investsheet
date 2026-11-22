import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, lastMonths, purchasesIn, limitStatus, listOf, maxInvestment, priceSeries, selectionRow, variationText, variationTone } from './selection.ts';

// Todos los datos de estas pruebas son inventados.
const base = { ticker: 'ACME', zone: 'España', tier: 'T1', price: 11.7, lastPrice: 11.47, target: 9.5, rpd: 0.0359, invested: 433_301, pmc: 9.35 };

describe('selección', () => {
	it('reparte en las cuatro listas por zona y tier', () => {
		expect(listOf('España', 'T1')).toBe('ES');
		expect(listOf('EE. UU.', 'T2')).toBe('US');
		expect(listOf('Resto del mundo', 'T3')).toBe('MUNDO');
		expect(listOf(null, 'T3')).toBe('MUNDO');
		expect(listOf('España', null)).toBe('SINTIER');
	});

	it('inversión máxima por tier, con España aparte, y aviso al acercarse o superarla', () => {
		expect(maxInvestment(DEFAULT_PARAMS, 'España', 'T1')).toBe(600_000);
		expect(maxInvestment(DEFAULT_PARAMS, 'EE. UU.', 'T3')).toBe(100_000);
		expect(maxInvestment(DEFAULT_PARAMS, 'España', null)).toBeNull();
		expect(limitStatus(500_000, 600_000)).toBeNull();
		expect(limitStatus(540_000, 600_000)).toBe('cerca');
		expect(limitStatus(600_001, 600_000)).toBe('superado');
		expect(limitStatus(1, null)).toBeNull();
	});

	it('describe la variación con los umbrales', () => {
		expect(variationText(11.7, 11.47, DEFAULT_PARAMS)).toBe('11.7');
		expect(variationText(59.64, 55.42, DEFAULT_PARAMS)).toBe('sube de 55.42 a 59.64');
		expect(variationText(23.7, 21.23, DEFAULT_PARAMS)).toBe('sube fuerte de 21.23 a 23.7');
		expect(variationText(44.77, 46.86, DEFAULT_PARAMS)).toBe('baja de 46.86 a 44.77');
		expect(variationText(10, null, DEFAULT_PARAMS)).toBe('10');
	});

	it('línea resumen con el formato de la hoja', () => {
		expect(selectionRow(base, DEFAULT_PARAMS).summary).toBe('ACME +2% (11.70/9.50 +23%, RPD 3.59%, invertido 4.3K, T1, PMC 9.35)');
		const up = selectionRow({ ...base, price: 59.64, lastPrice: 55.42, target: 25, tier: 'T2' }, DEFAULT_PARAMS);
		expect(up.summary).toBe('ACME +8% (sube de 55.42 a 59.64/25.00 +139%, RPD 3.59%, invertido 4.3K, T2, PMC 9.35)');
		expect(up).toMatchObject({ list: 'ES', max: 400_000, status: 'superado' });
		const fresh = selectionRow({ ...base, tier: null, invested: 0, pmc: null, lastPrice: null, rpd: null }, DEFAULT_PARAMS);
		expect(fresh.summary).toBe('ACME (11.70/9.50 +23%, RPD -, nueva, sin tier)');
		expect(fresh).toMatchObject({ list: 'SINTIER', max: null, status: null, variation: null });
	});

	it('da el tono de la variación con los umbrales', () => {
		expect(variationTone(null, DEFAULT_PARAMS)).toBeNull();
		expect(variationTone(0.039, DEFAULT_PARAMS)).toBeNull();
		expect(variationTone(-0.039, DEFAULT_PARAMS)).toBeNull();
		expect(variationTone(0.04, DEFAULT_PARAMS)).toBe('sube');
		expect(variationTone(-0.05, DEFAULT_PARAMS)).toBe('baja');
		expect(variationTone(0.1, DEFAULT_PARAMS)).toBe('sube fuerte');
		expect(variationTone(-0.25, DEFAULT_PARAMS)).toBe('baja fuerte');
	});

	it('monta la serie de precios con las revisiones y el precio de hoy', () => {
		const reviews = [
			{ date: '2026-10-01', price: 12, currency: 'EUR' },
			{ date: '2026-09-01', price: 10, currency: 'EUR' },
			{ date: '2026-08-01', price: 900, currency: 'GBX' }
		];
		expect(priceSeries(reviews, 'EUR', { date: '2026-11-20', price: 13 })).toEqual([
			{ date: '2026-09-01', price: 10 },
			{ date: '2026-10-01', price: 12 },
			{ date: '2026-11-20', price: 13, today: true }
		]);
		// El precio de hoy no se repite si es de la fecha de la última revisión.
		expect(priceSeries(reviews, 'EUR', { date: '2026-10-01', price: 12 })).toHaveLength(2);
		expect(priceSeries([], 'EUR', null)).toEqual([]);
	});

	it('recorta la serie a los últimos meses', () => {
		const points = ['2023-12-31', '2024-01-15', '2024-11-20', '2025-06-01', '2026-11-20'].map((date, i) => ({ date, price: i + 1 }));
		expect(lastMonths(points, 24).map((p) => p.date)).toEqual(['2024-11-20', '2025-06-01', '2026-11-20']);
		expect(lastMonths(points, 35).map((p) => p.date)).toEqual(['2023-12-31', '2024-01-15', '2024-11-20', '2025-06-01', '2026-11-20']);
		expect(lastMonths([], 24)).toEqual([]);
	});

	it('se queda con las compras del periodo dibujado', () => {
		const points = [{ date: '2025-01-10', price: 1 }, { date: '2026-11-20', price: 2, today: true }];
		const buys = ['2024-12-01', '2025-01-10', '2026-03-05', '2026-11-21'].map((date) => ({ date, shares: 1_000_000, cost: 100 }));
		expect(purchasesIn(buys, points).map((b) => b.date)).toEqual(['2025-01-10', '2026-03-05']);
		expect(purchasesIn(buys, points.slice(0, 1))).toEqual([]);
	});
});

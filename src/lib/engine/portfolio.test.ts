import { describe, expect, it } from 'vitest';
import { run } from './engine.ts';
import { distribution, portfolioView, type SecurityInfo } from './portfolio.ts';
import { MICRO, type Operation } from './types.ts';

// Todos los datos de estas pruebas son inventados.
const ACME = 1;
const USCO = 2;
const GONE = 3;
const info = (id: number, ticker: string, extra: Partial<SecurityInfo> = {}): SecurityInfo => ({ id, ticker, name: null, country: null, sector: null, supersector: null, zone: null, tier: null, whtSourcePct: 0, whtDestPct: 0.2, reinvest: true, ...extra });
let id = 0;
const op = (date: string, extra: Partial<Operation>): Operation => ({ id: ++id, date, seq: id, type: 'X', securityId: null, grossEur: 0, taxEur: 0, feesEur: 0, capitalInEur: 0, capitalOutEur: 0, purchaseEur: 0, cash: [], positions: [], ...extra });
const buy = (securityId: number, shares: number, cost: number) => ({ securityId, kind: 'buy' as const, shares: shares * MICRO, cost, reducedCost: cost });

const operations: Operation[] = [
	op('2030-01-02', { capitalInEur: 500000, cash: [{ accountId: 1, amount: 500000 }] }),
	op('2030-01-03', { positions: [buy(ACME, 100, 100000)], cash: [{ accountId: 1, amount: -100000 }] }),
	op('2030-01-04', { positions: [buy(USCO, 10, 200000)], cash: [{ accountId: 1, amount: -200000 }] }),
	op('2030-01-05', { positions: [buy(GONE, 5, 50000)], cash: [{ accountId: 1, amount: -50000 }] }),
	op('2030-02-01', { positions: [{ securityId: GONE, kind: 'sell', shares: 5 * MICRO, cost: 0, reducedCost: 0, proceeds: 50000 }], cash: [{ accountId: 1, amount: 50000 }] }),
	op('2030-03-01', { type: 'DIVIDENDOS', securityId: ACME, grossEur: 5000, cash: [{ accountId: 1, amount: 5000 }] }),
	op('2030-03-02', { cash: [{ accountId: 2, amount: 22000 }] })
];
const { state } = run(operations);
const securities = [info(ACME, 'ACME', { sector: 'Industria', country: 'ES' }), info(USCO, 'USCO', { sector: 'Consumo', country: 'US', whtSourcePct: 0.15, whtDestPct: 0.04 }), info(GONE, 'GONE')];
const months = (pairs: Record<number, number>) => Array.from({ length: 12 }, (_, i) => pairs[i + 1] ?? 0);
const inputs = () => ({
	state,
	securities,
	quotes: new Map([
		[ACME, { price: 12, currency: 'EUR', date: '2030-06-01' }],
		[USCO, { price: 330, currency: 'USD', date: '2030-06-01' }]
	]),
	schedules: new Map([
		[ACME, { currency: 'EUR', months: months({ 1: 0.2, 7: 0.3 }) }],
		[USCO, { currency: 'USD', months: months({ 3: 2.2, 6: 2.2, 9: 2.2, 12: 2.2 }) }]
	]),
	fx: new Map([['USD', 1.1]]),
	cash: [
		{ currency: 'EUR', amount: 205000 },
		{ currency: 'USD', amount: 22000 }
	],
	month: 6
});

describe('cuadro de cartera', () => {
	const view = portfolioView(inputs());
	const [acme, usco] = view.rows;

	it('solo incluye los valores con posición y calcula valor, resultado y pesos', () => {
		expect(view.rows.map((r) => r.ticker)).toEqual(['ACME', 'USCO']);
		expect(acme).toMatchObject({ shares: 100, cost: 100000, averagePrice: 10, priceEur: 12, value: 120000, gain: 20000, gainPct: 0.2 });
		expect(usco).toMatchObject({ shares: 10, value: 300000, gain: 100000, gainPct: 0.5 });
		expect(acme.weight).toBeCloseTo(120000 / 420000);
		expect(usco.weight).toBeCloseTo(300000 / 420000);
	});

	it('calcula dividendos previstos, netos de las dos retenciones, y sus rentabilidades', () => {
		expect(acme).toMatchObject({ dpa: 0.5, dpaEur: 0.5, dividendGross: 5000, dividendNet: 4000, yocNet: 0.04 });
		expect(acme.yieldGross).toBeCloseTo(5000 / 120000);
		expect(usco.dpa).toBeCloseTo(8.8);
		expect(usco.dpaEur).toBeCloseTo(8);
		expect(usco).toMatchObject({ dividendGross: 8000, dividendNet: 6528 });
		expect(usco.dividendWeight).toBeCloseTo(8000 / 13000);
		expect(acme).toMatchObject({ received: 5000, recovered: 0.05, sinceLastBuy: 5000 });
	});

	it('da los totales de la cartera, con la liquidez pasada a euros', () => {
		expect(view.totals).toMatchObject({ count: 2, cost: 300000, value: 420000, gain: 120000, gainPct: 0.4, liquidity: 225000, capital: 500000, totalGain: 145000, padiGross: 13000, padiNet: 10528, monthlyGross: 1083, unpriced: [], unscheduled: [], equalWeight: 0.5 });
		expect(view.totals.liquidityPct).toBeCloseTo(225000 / 645000);
		expect(view.totals.taxRate).toBeCloseTo(1 - 10528 / 13000);
	});

	it('prevé los próximos doce meses empezando por el mes en curso', () => {
		expect(view.forecast.map((f) => f.month)).toEqual([6, 7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5]);
		expect(view.forecast.slice(0, 2)).toEqual([
			{ month: 6, gross: 2000, net: 1632 },
			{ month: 7, gross: 3000, net: 2400 }
		]);
		expect(view.forecast.reduce((a, f) => a + f.gross, 0)).toBe(13000);
	});

	it('sin precio, sin cambio o sin calendario deja los datos en blanco y lo avisa, sin romper los totales', () => {
		const partial = inputs();
		partial.quotes.delete(ACME);
		partial.schedules.delete(ACME);
		partial.fx.clear();
		const v = portfolioView(partial);
		expect(v.rows[0]).toMatchObject({ value: null, gain: null, weight: null, dividendGross: null, yocNet: null });
		expect(v.rows[1]).toMatchObject({ priceEur: null, value: null, dividendGross: null });
		expect(v.totals).toMatchObject({ value: 0, gain: 0, gainPct: null, padiGross: 0, taxRate: null, unpriced: ['ACME', 'USCO'], unscheduled: ['ACME', 'USCO'], liquidity: 205000 });
	});

	it('reparte por grupos de mayor a menor', () => {
		expect(distribution(view.rows, (r) => r.sector, (r) => r.value)).toEqual([
			{ label: 'Consumo', amount: 300000, share: 300000 / 420000 },
			{ label: 'Industria', amount: 120000, share: 120000 / 420000 }
		]);
		expect(distribution(view.rows, (r) => r.zone, (r) => r.dividendGross)).toEqual([{ label: 'Sin clasificar', amount: 13000, share: 1 }]);
	});
});

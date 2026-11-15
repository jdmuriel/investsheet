import { describe, expect, it } from 'vitest';
import { allocate, run, totalCost, totalReducedCost, totalShares } from './engine.ts';
import { MICRO, type Operation, type PositionLeg } from './types.ts';

// Todos los datos de estas pruebas son inventados.
const EUR = 1;
const USD = 2;
const ACME = 10;
const NEWCO = 11;

let nextId = 1;
function op(date: string, type: string, extra: Partial<Operation> = {}): Operation {
	return {
		id: nextId++,
		date,
		seq: nextId,
		type,
		securityId: null,
		grossEur: 0,
		taxEur: 0,
		feesEur: 0,
		capitalInEur: 0,
		capitalOutEur: 0,
		purchaseEur: 0,
		cash: [],
		positions: [],
		...extra
	};
}
const sh = (n: number) => Math.round(n * MICRO);
const buy = (shares: number, cost: number, securityId = ACME): PositionLeg => ({ securityId, kind: 'buy', shares: sh(shares), cost, reducedCost: cost });
const sell = (shares: number, proceeds: number, securityId = ACME): PositionLeg => ({ securityId, kind: 'sell', shares: sh(shares), cost: 0, reducedCost: 0, proceeds });
const adjust = (shares: number, cost: number, reducedCost: number, securityId = ACME): PositionLeg => ({ securityId, kind: 'adjust', shares: sh(shares), cost, reducedCost });

describe('allocate', () => {
	it('reparte sin perder unidades', () => {
		expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
		expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
		expect(allocate(7, [0, 0])).toEqual([7, 0]);
	});
});

describe('efectivo, capital y resultado', () => {
	it('acumula saldos por cuenta y reinicia el resultado cada año', () => {
		const ops = [
			op('2020-01-10', 'APORTACION', { capitalInEur: 100000, cash: [{ accountId: EUR, amount: 100000 }] }),
			op('2020-02-01', 'COMPRA', { feesEur: 200, purchaseEur: 50000, cash: [{ accountId: EUR, amount: -50200 }], positions: [buy(10, 50000)] }),
			op('2020-06-01', 'DIVIDENDOS', { securityId: ACME, grossEur: 1000, taxEur: 190, cash: [{ accountId: EUR, amount: 810 }] }),
			op('2021-01-05', 'CAMBIO', { feesEur: 100, cash: [{ accountId: EUR, amount: -10000 }, { accountId: USD, amount: 11000 }] })
		];
		const rows: number[] = [];
		const { state } = run(ops, { onRow: (_, s) => rows.push(s.yearResult) });
		expect(state.cash.get(EUR)).toBe(100000 - 50200 + 810 - 10000);
		expect(state.cash.get(USD)).toBe(11000);
		expect(state.capital).toBe(100000);
		expect(rows).toEqual([0, -200, 610, -100]);
		expect(state.years.get(2020)).toMatchObject({ capital: 100000, gross: 1000, tax: 190, fees: 200, purchases: 50000 });
		expect(state.positions.get(ACME)?.dividendsGross).toBe(1000);
	});

	it('ordena por fecha aunque las operaciones se introduzcan desordenadas', () => {
		const ops = [
			op('2020-03-01', 'GASTOS', { feesEur: 500, cash: [{ accountId: EUR, amount: -500 }] }),
			op('2020-01-01', 'APORTACION', { capitalInEur: 1000, cash: [{ accountId: EUR, amount: 1000 }] })
		];
		const balances: number[] = [];
		run(ops, { onRow: (_, s) => balances.push(s.cash.get(EUR)!) });
		expect(balances).toEqual([1000, 500]);
	});

	it('devuelve el estado a una fecha', () => {
		const ops = [
			op('2020-01-01', 'APORTACION', { capitalInEur: 1000, cash: [{ accountId: EUR, amount: 1000 }] }),
			op('2020-05-01', 'APORTACION', { capitalInEur: 500, cash: [{ accountId: EUR, amount: 500 }] })
		];
		expect(run(ops, { until: '2020-04-30' }).state.capital).toBe(1000);
		expect(run(ops, { until: '2020-05-01' }).state.capital).toBe(1500);
	});
});

describe('lotes y FIFO', () => {
	it('una venta parcial consume el lote más antiguo a su coste original', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(100, 100000)] }), // 10,00 por acción
			op('2020-01-01', 'COMPRA', { positions: [buy(100, 200000)] }), // 20,00 por acción
			op('2021-01-01', 'VENTA', { positions: [sell(150, 300000)] })
		];
		const { state, warnings } = run(ops);
		const pos = state.positions.get(ACME)!;
		expect(warnings).toEqual([]);
		expect(totalShares(pos)).toBe(sh(50));
		expect(totalCost(pos)).toBe(100000); // quedan 50 del segundo lote a 20,00
		expect(pos.lots).toHaveLength(1);
		expect(pos.lots[0].date).toBe('2020-01-01');
		expect(pos.realizedGain).toBe(300000 - 200000); // sale: 100 × 10 + 50 × 20
		expect(state.years.get(2021)?.realizedGain).toBe(100000);
	});

	it('una venta total deja el coste a cero', () => {
		const { state } = run([op('2019-01-01', 'COMPRA', { positions: [buy(7, 12345)] }), op('2019-02-01', 'VENTA', { positions: [sell(7, 10000)] })]);
		expect(totalShares(state.positions.get(ACME))).toBe(0);
		expect(totalCost(state.positions.get(ACME))).toBe(0);
	});

	it('avisa si se vende más de lo que hay', () => {
		const { warnings } = run([op('2019-01-01', 'COMPRA', { positions: [buy(5, 500)] }), op('2019-02-01', 'VENTA', { positions: [sell(8, 900)] })]);
		expect(warnings).toHaveLength(1);
	});

	it('las acciones liberadas se reparten entre los lotes sin cambiar el coste', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(100, 100000)] }),
			op('2020-01-01', 'COMPRA', { positions: [buy(300, 600000)] }),
			op('2021-01-01', 'AMPLIACIONLIBERADA', { positions: [adjust(8, 0, 0)] }),
			op('2022-01-01', 'VENTA', { positions: [sell(102, 0)] })
		];
		const pos = run(ops).state.positions.get(ACME)!;
		// El primer lote pasó a 102 acciones con sus 1.000,00 de coste, y es el que se vende entero.
		expect(totalShares(pos)).toBe(sh(306));
		expect(totalCost(pos)).toBe(600000);
	});

	it('un contrasplit reduce acciones y conserva el coste', () => {
		const ops = [op('2019-01-01', 'COMPRA', { positions: [buy(45, 90000)] }), op('2020-01-01', 'SPLIT', { positions: [adjust(-5, 0, 0)] })];
		const pos = run(ops).state.positions.get(ACME)!;
		expect(totalShares(pos)).toBe(sh(40));
		expect(totalCost(pos)).toBe(90000);
	});

	it('venta de derechos y devolución de prima solo bajan el coste reducido', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(100, 100000)] }),
			op('2019-06-01', 'VENTADERECHOS', { grossEur: 3000, positions: [adjust(0, 0, -3000)] }),
			op('2019-07-01', 'DEVOLUCIONPRIMA', { grossEur: 2000, positions: [adjust(0, 0, -2000)] })
		];
		const pos = run(ops).state.positions.get(ACME)!;
		expect(totalCost(pos)).toBe(100000);
		expect(totalReducedCost(pos)).toBe(95000);
	});

	it('la compra de derechos sube el coste de los lotes existentes', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(100, 100000)] }),
			op('2019-06-01', 'COMPRADERECHOS', { positions: [adjust(0, 1500, 1500)] }),
			op('2019-06-15', 'CONVERSIONDERECHOS', { positions: [adjust(2, 0, 0)] })
		];
		const pos = run(ops).state.positions.get(ACME)!;
		expect(totalShares(pos)).toBe(sh(102));
		expect(totalCost(pos)).toBe(101500);
	});

	it('una conversión traslada los lotes al valor nuevo conservando fechas', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(30, 30000)] }),
			op('2020-01-01', 'COMPRA', { positions: [buy(20, 40000, NEWCO)] }),
			op('2021-01-01', 'CONVERSION', { positions: [{ securityId: ACME, kind: 'convert', shares: 0, cost: 0, reducedCost: 0, toSecurityId: NEWCO }] })
		];
		const { state } = run(ops);
		expect(totalShares(state.positions.get(ACME))).toBe(0);
		const pos = state.positions.get(NEWCO)!;
		expect(totalShares(pos)).toBe(sh(50));
		expect(totalCost(pos)).toBe(70000);
		expect(pos.lots.map((l) => l.date)).toEqual(['2019-01-01', '2020-01-01']);
	});

	it('un traspaso entre cuentas no altera los lotes', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(10, 10000)] }),
			op('2022-01-01', 'TRASPASOVALORES', { feesEur: 400, cash: [{ accountId: EUR, amount: 20000 }, { accountId: USD, amount: -22000 }] })
		];
		const pos = run(ops).state.positions.get(ACME)!;
		expect(pos.lots).toEqual([{ date: '2019-01-01', shares: sh(10), cost: 10000, reducedCost: 10000 }]);
	});

	it('acumula dividendos desde la última compra', () => {
		const ops = [
			op('2019-01-01', 'COMPRA', { positions: [buy(10, 10000)] }),
			op('2019-06-01', 'DIVIDENDOS', { securityId: ACME, grossEur: 300 }),
			op('2020-01-01', 'COMPRA', { positions: [buy(5, 6000)] }),
			op('2020-06-01', 'DIVIDENDOS', { securityId: ACME, grossEur: 500 })
		];
		const pos = run(ops).state.positions.get(ACME)!;
		expect(pos.dividendsGross).toBe(800);
		expect(pos.dividendsSinceLastBuy).toBe(500);
	});
});

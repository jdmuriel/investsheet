import { describe, expect, it } from 'vitest';
import { checkChange, sharesBefore } from './check.ts';
import { run, totalCost, totalReducedCost, totalShares } from './engine.ts';
import { parseDecimal, parseInput } from './form.ts';
import { buildOperation, emptyInput, OPERATION_TYPES, type BuildContext, type BuiltOperation, type OperationInput, type OperationType } from './operations.ts';
import { MICRO, type Operation } from './types.ts';

// Todos los datos de estas pruebas son inventados.
const BANK = 1; // cuenta en euros
const BROKER_USD = 2;
const BROKER_EUR = 3;
const ACME = 10;
const NEWCO = 11;

const sh = (n: number) => Math.round(n * MICRO);

function context(held: Record<number, number> = {}): BuildContext {
	return {
		accounts: new Map([
			[BANK, { code: 'BANCO', currency: 'EUR' }],
			[BROKER_USD, { code: 'BRUSD', currency: 'USD' }],
			[BROKER_EUR, { code: 'BREUR', currency: 'EUR' }]
		]),
		securities: new Map([
			[ACME, { ticker: 'ACME' }],
			[NEWCO, { ticker: 'NEWCO' }]
		]),
		sharesHeld: (id) => sh(held[id] ?? 0)
	};
}

function input(type: OperationType, fields: Partial<OperationInput> = {}): OperationInput {
	return { ...emptyInput(type, '2025-03-10'), accountId: BANK, ...fields };
}

function built(type: OperationType, fields: Partial<OperationInput> = {}, ctx = context()): BuiltOperation {
	const result = buildOperation(input(type, fields), ctx);
	if (!result.ok) throw new Error(result.errors.join(' '));
	return result.operation;
}

function errors(type: OperationType, fields: Partial<OperationInput> = {}, ctx = context()): string {
	const result = buildOperation(input(type, fields), ctx);
	return result.ok ? '' : result.errors.join(' ');
}

let nextId = 1;
/** Convierte lo generado en operaciones del motor, en el orden dado. */
function ledger(...operations: BuiltOperation[]): Operation[] {
	return operations.map((o) => ({ ...o, id: nextId++, seq: nextId }));
}

describe('rentas', () => {
	it('dividendo en euros con retención', () => {
		const op = built('DIVIDENDOS', { securityId: ACME, quantity: sh(100), price: 0.5, whtDest: 950 });
		expect(op).toMatchObject({ amountLocal: 5000, taxLocal: 950, whtSourceLocal: 0, whtDestLocal: 950, grossEur: 5000, taxEur: 950, feesEur: 0, securityId: ACME, currency: 'EUR', fxRate: 1 });
		expect(op.cash).toEqual([{ accountId: BANK, amount: 4050 }]);
		expect(op.positions).toEqual([]);
		expect(op.description).toBe('Dividendos ACME (100*0.5 EUR)');
	});

	it('dividendo en dólares cobrado en una cuenta en euros: todo se convierte al cambio', () => {
		const op = built('DIVIDENDOS', { securityId: ACME, currency: 'USD', fxRate: 1.25, amount: 10000, whtSource: 1500, whtDest: 1000 });
		expect(op).toMatchObject({ amountLocal: 10000, taxLocal: 2500, grossEur: 8000, taxEur: 2000, currency: 'USD', fxRate: 1.25 });
		expect(op.cash).toEqual([{ accountId: BANK, amount: 6000 }]);
	});

	it('dividendo en dólares cobrado en una cuenta en dólares: el efectivo queda en dólares', () => {
		const op = built('DIVIDENDOS', { accountId: BROKER_USD, securityId: ACME, currency: 'USD', fxRate: 1.25, amount: 10000, whtSource: 1500, fees: 100 });
		expect(op.cash).toEqual([{ accountId: BROKER_USD, amount: 8400 }]);
		expect(op).toMatchObject({ grossEur: 8000, taxEur: 1200, feesEur: 80, feesLocal: 100 });
	});

	it('con el neto abonado, los gastos son la diferencia', () => {
		const op = built('DIVIDENDOS', { securityId: ACME, currency: 'USD', fxRate: 1.25, amount: 10000, whtSource: 1500, cashTotal: 6797 });
		expect(op.feesEur).toBe(3);
		expect(op.cash).toEqual([{ accountId: BANK, amount: 6797 }]);
		expect(op.grossEur - op.taxEur - op.feesEur).toBe(6797);
		expect(errors('DIVIDENDOS', { securityId: ACME, amount: 10000, cashTotal: 10001 })).toMatch(/no cuadra/);
	});

	it('intereses y promociones', () => {
		const interest = built('INTERESES', { accountId: BROKER_USD, fxRate: 1.25, amount: 500, whtDest: 100 });
		expect(interest).toMatchObject({ grossEur: 400, taxEur: 80, currency: 'USD', securityId: null });
		expect(interest.cash).toEqual([{ accountId: BROKER_USD, amount: 400 }]);
		expect(built('INGRESOPROMOCION', { amount: 4000, whtDest: 760 }).cash).toEqual([{ accountId: BANK, amount: 3240 }]);
	});

	it('rechaza retenciones mayores que el bruto y cuentas en otra moneda', () => {
		expect(errors('DIVIDENDOS', { securityId: ACME, amount: 1000, whtDest: 1001 })).toMatch(/retenciones/);
		expect(errors('DIVIDENDOS', { accountId: BROKER_USD, securityId: ACME, currency: 'GBP', fxRate: 0.85, amount: 1000 })).toMatch(/solo admite/);
		expect(errors('DIVIDENDOS', { securityId: ACME, currency: 'USD', fxRate: 0, amount: 1000 })).toMatch(/tipo de cambio/);
		expect(errors('DIVIDENDOS', { amount: 1000 })).toMatch(/Valor/);
		expect(errors('DIVIDENDOS', { securityId: ACME })).toMatch(/Importe bruto/);
	});

	it('devolución de prima y venta de derechos rebajan solo el coste reducido', () => {
		const refund = built('DEVOLUCIONPRIMA', { securityId: ACME, amount: 2000 });
		expect(refund).toMatchObject({ grossEur: 2000, taxEur: 0 });
		expect(refund.positions).toEqual([{ securityId: ACME, kind: 'adjust', shares: 0, cost: 0, reducedCost: -2000 }]);
		const rights = built('VENTADERECHOS', { securityId: ACME, quantity: sh(100), price: 0.3, whtDest: 570, fees: 30 });
		expect(rights).toMatchObject({ grossEur: 3000, taxEur: 570, feesEur: 30 });
		expect(rights.cash).toEqual([{ accountId: BANK, amount: 2400 }]);
		const ops = ledger(built('COMPRA', { securityId: ACME, quantity: sh(100), price: 10, date: '2025-01-02' }), refund, rights);
		const position = run(ops).state.positions.get(ACME);
		expect(totalCost(position)).toBe(100000);
		expect(totalReducedCost(position)).toBe(95000);
	});
});

describe('compras y ventas', () => {
	it('compra en euros: los gastos van al coste y al resultado', () => {
		const op = built('COMPRA', { securityId: ACME, quantity: sh(40), price: 12.5, fees: 320 });
		expect(op).toMatchObject({ amountLocal: 50000, purchaseEur: 50000, feesEur: 320, grossEur: 0, quantity: 40, price: 12.5 });
		expect(op.cash).toEqual([{ accountId: BANK, amount: -50320 }]);
		expect(op.positions).toEqual([{ securityId: ACME, kind: 'buy', shares: sh(40), cost: 50320, reducedCost: 50320 }]);
		expect(op.description).toBe('Compra 40 x ACME @ 12.5 EUR');
	});

	it('compra en dólares desde una cuenta en dólares', () => {
		const op = built('COMPRA', { accountId: BROKER_USD, securityId: ACME, quantity: sh(2), price: 200, currency: 'USD', fxRate: 1.25, fees: 50 });
		expect(op.cash).toEqual([{ accountId: BROKER_USD, amount: -40050 }]);
		expect(op).toMatchObject({ purchaseEur: 32000, feesEur: 40 });
		expect(op.positions[0]).toMatchObject({ cost: 32040 });
	});

	it('compra en libras desde una cuenta en euros, con el total cargado', () => {
		const op = built('COMPRA', { securityId: ACME, quantity: sh(20), price: 40, currency: 'GBP', fxRate: 0.8, cashTotal: 100900 });
		expect(op).toMatchObject({ purchaseEur: 100000, feesEur: 900 });
		expect(op.cash).toEqual([{ accountId: BANK, amount: -100900 }]);
	});

	it('venta: baja por FIFO y plusvalía sin contar los gastos de la venta', () => {
		const sale = built('VENTA', { securityId: ACME, quantity: sh(15), price: 30, fees: 200, date: '2025-06-01' });
		expect(sale).toMatchObject({ purchaseEur: -45000, feesEur: 200 });
		expect(sale.cash).toEqual([{ accountId: BANK, amount: 44800 }]);
		expect(sale.positions).toEqual([{ securityId: ACME, kind: 'sell', shares: sh(15), cost: 0, reducedCost: 0, proceeds: 45000 }]);
		const ops = ledger(
			built('COMPRA', { securityId: ACME, quantity: sh(10), price: 10, date: '2025-01-02' }),
			built('COMPRA', { securityId: ACME, quantity: sh(10), price: 20, date: '2025-02-02' }),
			sale
		);
		const position = run(ops).state.positions.get(ACME)!;
		expect(totalShares(position)).toBe(sh(5));
		expect(totalCost(position)).toBe(10000);
		expect(position.realizedGain).toBe(45000 - 10000 - 10000);
	});

	it('exige acciones e importe', () => {
		expect(errors('COMPRA', { securityId: ACME, price: 10 })).toMatch(/Acciones/);
		expect(errors('VENTA', { securityId: ACME, quantity: sh(1) })).toMatch(/Importe/);
	});

	it('opciones: la prima cuenta como compra y solo los gastos van al resultado', () => {
		const put = built('VENTAPUT', { accountId: BROKER_USD, securityId: ACME, quantity: sh(1), price: 250, currency: 'USD', fxRate: 1.25, fees: 100 });
		expect(put).toMatchObject({ purchaseEur: -20000, feesEur: 80, grossEur: 0 });
		expect(put.cash).toEqual([{ accountId: BROKER_USD, amount: 24900 }]);
		expect(put.positions).toEqual([]);
		const call = built('COMPRACALL', { accountId: BROKER_USD, amount: 10000, fxRate: 1.25, fees: 100 });
		expect(call).toMatchObject({ purchaseEur: 8000, feesEur: 80 });
		expect(call.cash).toEqual([{ accountId: BROKER_USD, amount: -10100 }]);
	});
});

describe('efectivo', () => {
	it('aportación y retirada mueven el capital', () => {
		const deposit = built('APORTACION', { amount: 100000 });
		expect(deposit).toMatchObject({ capitalInEur: 100000, capitalOutEur: 0, grossEur: 0 });
		expect(deposit.cash).toEqual([{ accountId: BANK, amount: 100000 }]);
		const withdrawal = built('RETIRADA', { accountId: BROKER_USD, amount: 12500, fxRate: 1.25 });
		expect(withdrawal).toMatchObject({ capitalInEur: 0, capitalOutEur: 10000 });
		expect(withdrawal.cash).toEqual([{ accountId: BROKER_USD, amount: -12500 }]);
	});

	it('gasto', () => {
		const op = built('GASTOS', { amount: 640 });
		expect(op).toMatchObject({ feesEur: 640, feesLocal: 640 });
		expect(op.cash).toEqual([{ accountId: BANK, amount: -640 }]);
	});

	it('pérdidas y compensación de fondos son rentas con signo', () => {
		expect(built('PERDIDASFONDOS', { amount: 300 })).toMatchObject({ grossEur: -300, cash: [{ accountId: BANK, amount: -300 }] });
		expect(built('COMPENSACIONFONDOS', { amount: 300 })).toMatchObject({ grossEur: 300, cash: [{ accountId: BANK, amount: 300 }] });
	});

	it('traspaso entre cuentas de la misma moneda', () => {
		const op = built('TRASPASO', { toAccountId: BROKER_EUR, amount: 120000, fees: 100 });
		expect(op.cash).toEqual([
			{ accountId: BANK, amount: -120100 },
			{ accountId: BROKER_EUR, amount: 120000 }
		]);
		expect(op.feesEur).toBe(100);
		expect(errors('TRASPASO', { toAccountId: BROKER_USD, amount: 1000 })).toMatch(/misma moneda/);
		expect(errors('TRASPASO', { toAccountId: BANK, amount: 1000 })).toMatch(/la misma/);
		expect(errors('TRASPASO', { amount: 1000 })).toMatch(/destino/);
	});

	it('cambio de divisa: entran y salen los importes reales', () => {
		const op = built('CAMBIO', { accountId: BROKER_EUR, toAccountId: BROKER_USD, amount: 150120, amountTo: 165000, fees: 120 });
		expect(op.cash).toEqual([
			{ accountId: BROKER_EUR, amount: -150120 },
			{ accountId: BROKER_USD, amount: 165000 }
		]);
		expect(op).toMatchObject({ feesEur: 120, currency: 'USD', grossEur: 0 });
		expect(op.fxRate).toBeCloseTo(1.099121, 6);
		const back = built('CAMBIO', { accountId: BROKER_USD, toAccountId: BROKER_EUR, amount: 125000, amountTo: 100000 });
		expect(back).toMatchObject({ currency: 'USD', fxRate: 1.25 });
		expect(errors('CAMBIO', { toAccountId: BROKER_EUR, amount: 1000, amountTo: 1000 })).toMatch(/Traspaso/);
	});
});

describe('operaciones societarias', () => {
	const holding = () => built('COMPRA', { securityId: ACME, quantity: sh(100), price: 10, date: '2025-01-02' });

	it('compra de derechos: sube el coste sin cambiar las acciones', () => {
		const op = built('COMPRADERECHOS', { securityId: ACME, quantity: sh(200), price: 0.5, fees: 100 });
		expect(op).toMatchObject({ purchaseEur: 10000, feesEur: 100 });
		expect(op.cash).toEqual([{ accountId: BANK, amount: -10100 }]);
		const position = run(ledger(holding(), op)).state.positions.get(ACME);
		expect(totalShares(position)).toBe(sh(100));
		expect(totalCost(position)).toBe(110100);
	});

	it('conversión de derechos y ampliación liberada: más acciones con el mismo coste', () => {
		const conversion = built('CONVERSIONDERECHOS', { securityId: ACME, quantity: sh(4), price: 100 });
		expect(conversion.cash).toEqual([]);
		expect(conversion.description).toBe('Suscripción acciones ACME: 100 derechos generan 4 acciones');
		const bonus = built('AMPLIACIONLIBERADA', { accountId: null, securityId: ACME, quantity: sh(1) });
		const position = run(ledger(holding(), conversion, bonus)).state.positions.get(ACME);
		expect(totalShares(position)).toBe(sh(105));
		expect(totalCost(position)).toBe(100000);
		expect(errors('AMPLIACIONLIBERADA', { accountId: null, securityId: ACME, quantity: sh(1), fees: 10 })).toMatch(/cuenta/);
	});

	it('split y contrasplit parten de las acciones que hay', () => {
		const split = built('SPLIT', { accountId: null, securityId: ACME, ratioNew: 3, ratioOld: 2 }, context({ [ACME]: 100 }));
		expect(split.positions).toEqual([{ securityId: ACME, kind: 'adjust', shares: sh(50), cost: 0, reducedCost: 0 }]);
		expect(split.quantity).toBe(1.5);
		expect(split.cash).toEqual([]);
		const reverse = built('SPLIT', { accountId: null, securityId: ACME, ratioNew: 8, ratioOld: 9, sharesAfter: sh(40) }, context({ [ACME]: 45 }));
		expect(reverse.positions[0].shares).toBe(sh(-5));
		const position = run(ledger(holding(), split)).state.positions.get(ACME);
		expect(totalShares(position)).toBe(sh(150));
		expect(totalCost(position)).toBe(100000);
		expect(errors('SPLIT', { accountId: null, securityId: ACME, ratioNew: 2, ratioOld: 1 })).toMatch(/No hay acciones/);
		expect(errors('SPLIT', { accountId: null, securityId: ACME, ratioNew: 2 }, context({ [ACME]: 1 }))).toMatch(/Proporción/);
	});

	it('spin-off: pasa coste al valor nuevo y cobra los picos', () => {
		const op = built('SPINOFF', { securityId: ACME, toSecurityId: NEWCO, quantity: sh(25), costMoved: 30000, amount: 1200 });
		expect(op).toMatchObject({ grossEur: 1200, securityId: ACME });
		expect(op.cash).toEqual([{ accountId: BANK, amount: 1200 }]);
		const { positions } = run(ledger(holding(), op)).state;
		expect(totalCost(positions.get(ACME))).toBe(70000);
		expect(totalShares(positions.get(ACME))).toBe(sh(100));
		expect(totalShares(positions.get(NEWCO))).toBe(sh(25));
		expect(totalCost(positions.get(NEWCO))).toBe(30000);
		expect(errors('SPINOFF', { securityId: ACME, toSecurityId: ACME, quantity: sh(1) })).toMatch(/mismo/);
	});

	it('conversión de ticker: los lotes pasan al valor nuevo', () => {
		const op = built('CONVERSION', { accountId: null, securityId: ACME, toSecurityId: NEWCO, sharesAfter: sh(50) }, context({ [ACME]: 100 }));
		const { positions } = run(ledger(holding(), op)).state;
		expect(totalShares(positions.get(ACME))).toBe(0);
		expect(totalShares(positions.get(NEWCO))).toBe(sh(50));
		expect(totalCost(positions.get(NEWCO))).toBe(100000);
		expect(positions.get(NEWCO)!.lots[0].date).toBe('2025-01-02');
	});

	it('traspaso de valores: solo los gastos', () => {
		const op = built('TRASPASOVALORES', { securityId: ACME, quantity: sh(100), fees: 900 });
		expect(op.positions).toEqual([]);
		expect(op.cash).toEqual([{ accountId: BANK, amount: -900 }]);
		expect(op.feesEur).toBe(900);
	});
});

describe('invariantes de todos los tipos', () => {
	it('en una cuenta en euros, el efectivo cuadra con resultado, capital y compras', () => {
		const samples: Partial<Record<OperationType, Partial<OperationInput>>> = {
			DIVIDENDOS: { securityId: ACME, currency: 'USD', fxRate: 1.1, amount: 3333, whtSource: 500, whtDest: 400, fees: 7 },
			COMPRA: { securityId: ACME, quantity: sh(3), price: 33.33, currency: 'USD', fxRate: 1.1, fees: 7 },
			VENTA: { securityId: ACME, quantity: sh(3), price: 33.33, currency: 'USD', fxRate: 1.1, fees: 7 },
			APORTACION: { amount: 5000 },
			RETIRADA: { amount: 5000 },
			INTERESES: { amount: 123, whtDest: 23 },
			GASTOS: { amount: 99 },
			DEVOLUCIONPRIMA: { securityId: ACME, amount: 777 },
			COMPRADERECHOS: { securityId: ACME, quantity: sh(10), price: 0.31, fees: 5 },
			VENTADERECHOS: { securityId: ACME, quantity: sh(10), price: 0.31, whtDest: 59, fees: 5 },
			VENTAPUT: { amount: 2000, fees: 9 },
			COMPRACALL: { amount: 2000, fees: 9 },
			INGRESOPROMOCION: { amount: 4000, whtDest: 760 },
			PERDIDASFONDOS: { amount: 40 },
			COMPENSACIONFONDOS: { amount: 40 },
			TRASPASOVALORES: { securityId: ACME, fees: 12 },
			CONVERSIONDERECHOS: { securityId: ACME, quantity: sh(1), fees: 3 },
			SPINOFF: { securityId: ACME, toSecurityId: NEWCO, quantity: sh(1), amount: 55 }
		};
		for (const [type, fields] of Object.entries(samples) as [OperationType, Partial<OperationInput>][]) {
			const op = built(type, fields);
			const cash = op.cash.reduce((s, c) => s + c.amount, 0);
			expect(cash, type).toBe(op.grossEur - op.taxEur - op.feesEur + op.capitalInEur - op.capitalOutEur - op.purchaseEur);
			expect(op.description, type).not.toBe('');
		}
	});

	it('todos los tipos tienen etiqueta y la descripción escrita a mano manda', () => {
		for (const def of Object.values(OPERATION_TYPES)) expect(def.label).not.toBe('');
		expect(built('GASTOS', { amount: 1, description: '  Conectividad  ' }).description).toBe('Conectividad');
		expect(errors('GASTOS', { amount: 1, date: '2025-02-30x' })).toMatch(/fecha/);
	});
});

describe('formulario', () => {
	it('entiende números con coma o punto', () => {
		expect(parseDecimal('1.234,56')).toBe(1234.56);
		expect(parseDecimal('1234.56')).toBe(1234.56);
		expect(parseDecimal(' 0,5 ')).toBe(0.5);
		expect(parseDecimal('')).toBeNull();
		expect(parseDecimal('12a')).toBeNaN();
	});

	it('convierte los campos de texto', () => {
		const { input: parsed, errors: problems } = parseInput({ type: 'COMPRA', date: '2025-03-10', account: '1', security: '10', quantity: '2,5', price: '10,10', fees: '1,5', cashTotal: '', currency: 'usd', fxRate: '1,1' });
		expect(problems).toEqual([]);
		expect(parsed).toMatchObject({ accountId: 1, securityId: 10, quantity: 2_500_000, price: 10.1, fees: 150, cashTotal: null, currency: 'USD', fxRate: 1.1, toAccountId: null });
		expect(parseInput({ type: 'COMPRA', quantity: 'x' }).errors[0]).toMatch(/no es un número/);
		expect(parseInput({ type: 'NADA' }).errors[0]).toMatch(/desconocido/);
	});
});

describe('validación del cambio', () => {
	const names = new Map([[BANK, 'BANCO']]);
	const base = () =>
		ledger(built('APORTACION', { amount: 200000, date: '2025-01-01' }), built('COMPRA', { securityId: ACME, quantity: sh(100), price: 10, date: '2025-01-02' }), built('VENTA', { securityId: ACME, quantity: sh(60), price: 12, date: '2025-03-01' }));

	it('no deja vender más de lo que hay, tampoco con una venta intercalada antes', () => {
		const before = base();
		const tooMuch = ledger(built('VENTA', { securityId: ACME, quantity: sh(41), price: 12, date: '2025-04-01' }));
		expect(checkChange(before, [...before, ...tooMuch], names).errors[0]).toMatch(/01\/04\/2025: Venta de más acciones/);
		const earlier = ledger(built('VENTA', { securityId: ACME, quantity: sh(50), price: 12, date: '2025-02-01' }));
		expect(checkChange(before, [...before, ...earlier], names).errors[0]).toMatch(/01\/03\/2025/);
		const fine = ledger(built('VENTA', { securityId: ACME, quantity: sh(40), price: 12, date: '2025-04-01' }));
		expect(checkChange(before, [...before, ...fine], names)).toEqual({ errors: [], warnings: [] });
	});

	it('avisa si una cuenta pasa a negativo, pero no de lo que ya lo estaba', () => {
		const before = base();
		const big = ledger(built('COMPRA', { securityId: ACME, quantity: sh(100), price: 30, date: '2025-05-01' }));
		const after = [...before, ...big];
		expect(checkChange(before, after, names).warnings).toEqual(['La cuenta BANCO queda en negativo (-1280.00) el 01/05/2025.']);
		const income = ledger(built('INTERESES', { amount: 100, date: '2025-06-01' }));
		expect(checkChange(after, [...after, ...income], names).warnings).toEqual([]);
		// Borrar la aportación deja en negativo operaciones que ya existían.
		expect(checkChange(before, before.slice(1), names).warnings[0]).toMatch(/02\/01\/2025/);
	});

	it('acciones antes de una posición del registro', () => {
		const ops = base();
		expect(sharesBefore(ops, { date: '2025-03-01', seq: ops[2].seq }, ACME)).toBe(sh(100));
		expect(sharesBefore(ops, { date: '2025-03-01', seq: ops[2].seq + 1 }, ACME)).toBe(sh(40));
		expect(sharesBefore(ops, { date: '2025-12-31', seq: 0, excludeId: ops[2].id }, ACME)).toBe(sh(100));
	});
});

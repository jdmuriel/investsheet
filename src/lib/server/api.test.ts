import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { apiDelete, apiDeleteSecurity, apiIndex, apiPatchSecurity, apiOperation, apiOperations, apiSave, apiSecurities, apiState, findPortfolio } from './api.ts';
import { apiTokenValid } from './auth.ts';
import { openDatabase } from './db.ts';

// Todos los datos de estas pruebas son inventados.
let db: DatabaseSync;

beforeEach(() => {
	db = openDatabase(':memory:');
	db.exec(`
		INSERT INTO portfolio (id, name) VALUES (1, 'Prueba'), (2, 'Otra');
		INSERT INTO account (id, portfolio_id, code, name, currency) VALUES (1, 1, 'BANCO', 'Banco', 'EUR'), (2, 1, 'BRUSD', 'Broker USD', 'USD'), (3, 2, 'OTRO', 'Otro banco', 'EUR');
		INSERT INTO security (id, ticker, currency, wht_dest_pct) VALUES (1, 'ACME', 'EUR', 0.19);
	`);
});

type Body = Record<string, any>;
const post = (body: unknown, id: number | null = null) => {
	const response = apiSave(db, 1, id, body);
	return { status: response.status, body: response.body as Body };
};
const count = () => (db.prepare('SELECT count(*) AS n FROM operation').get() as { n: number }).n;
function seed() {
	post({ type: 'APORTACION', date: '2025-01-01', account: 'banco', amount: 5000 });
	return post({ type: 'COMPRA', date: '2025-01-02', account: 'BANCO', security: 'acme', quantity: 100, price: '10,5', fees: 2.5 }).body.id as number;
}

describe('token', () => {
	const token = 'x'.repeat(40);
	it('solo vale la cabecera Bearer con el token exacto', () => {
		expect(apiTokenValid(`Bearer ${token}`, token)).toBe(true);
		expect(apiTokenValid(`Bearer ${token}y`, token)).toBe(false);
		expect(apiTokenValid(token, token)).toBe(false);
		expect(apiTokenValid(null, token)).toBe(false);
		expect(apiTokenValid('Bearer ', undefined)).toBe(false);
		expect(apiTokenValid('Bearer corto', 'corto')).toBe(false);
	});
});

describe('consultas', () => {
	it('la guía lista carteras, cuentas y tipos con sus campos', () => {
		const body = apiIndex(db).body as Body;
		expect(body.portfolios[0]).toMatchObject({ id: 1, name: 'Prueba', accounts: [{ code: 'BANCO', currency: 'EUR' }, { code: 'BRUSD', currency: 'USD' }] });
		expect(body.types.COMPRA.fields.quantity).toBe('Acciones');
		expect(findPortfolio(db, 'prueba')?.id).toBe(1);
		expect(findPortfolio(db, '2')?.name).toBe('Otra');
		expect(findPortfolio(db, 'nada')).toBeNull();
		expect(apiSecurities(db).body).toMatchObject([{ ticker: 'ACME', name: null, currency: 'EUR', whtSourcePct: null, whtDestPct: 0.19 }]);
	});

	it('estado a una fecha, en unidades y no en céntimos', () => {
		seed();
		post({ type: 'DIVIDENDOS', date: '2025-06-01', account: 'BANCO', security: 'ACME', amount: 50, whtDest: 9.5 });
		const now = apiState(db, 1, null).body as Body;
		expect(now.cash[0]).toEqual({ account: 'BANCO', name: 'Banco', currency: 'EUR', balance: 5000 - 1052.5 + 40.5 });
		expect(now).toMatchObject({ capitalContributed: 5000, yearResult: 38, totalCost: 1052.5, year: 2025 });
		expect(now.positions).toEqual([{ ticker: 'ACME', shares: 100, cost: 1052.5, reducedCost: 1052.5, averagePrice: 10.53, lots: 1, dividendsGross: 50, realizedGain: 0 }]);
		expect(now.years[0]).toMatchObject({ year: 2025, gross: 50, tax: 9.5, fees: 2.5, net: 38, purchases: 1050 });
		const before = apiState(db, 1, '2025-01-01').body as Body;
		expect(before.positions).toEqual([]);
		expect(before.cash[0].balance).toBe(5000);
		expect(apiState(db, 1, 'ayer').status).toBe(400);
	});

	it('listado con filtros y límite', () => {
		const purchase = seed();
		post({ type: 'GASTOS', date: '2025-02-01', account: 'BANCO', amount: 3, description: 'Custodia' });
		const list = (query: string) => apiOperations(db, 1, new URLSearchParams(query)).body as Body;
		expect(list('').total).toBe(3);
		expect(list('valor=acme').operations.map((o: Body) => o.id)).toEqual([purchase]);
		expect(list('tipo=gastos').operations[0]).toMatchObject({ description: 'Custodia', feesEur: 3, netEur: -3, cash: [{ account: 'BANCO', amount: -3 }] });
		expect(list('desde=2025-01-02&hasta=2025-01-31').total).toBe(1);
		expect(list('texto=custo').total).toBe(1);
		expect(list('limite=1')).toMatchObject({ total: 3, returned: 1, operations: [{ type: 'GASTOS' }] });
		expect(apiOperations(db, 1, new URLSearchParams('cuenta=nada')).status).toBe(400);
		expect(list('cuenta=brusd').total).toBe(0);
	});
});

describe('escritura', () => {
	it('alta con códigos y tickers, y saldo resultante', () => {
		const id = seed();
		const row = db.prepare('SELECT type, source, account_id, security_id, purchase_eur, fees_eur FROM operation WHERE id = ?').get(id);
		expect(row).toMatchObject({ type: 'COMPRA', source: 'api', account_id: 1, security_id: 1, purchase_eur: 105000, fees_eur: 250 });
		const sale = post({ type: 'VENTA', date: '2025-03-01', account: 'BANCO', security: 'ACME', quantity: 40, price: 12 });
		expect(sale.status).toBe(201);
		expect(sale.body).toMatchObject({ saved: true, description: 'Venta 40 x ACME @ 12 EUR', cash: [{ account: 'BANCO', currency: 'EUR', amount: 480 }], balancesAfter: [{ account: 'BANCO', balance: 5000 - 1052.5 + 480 }], purchaseEur: -480 });
		expect(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'create'").get()).toMatchObject({ n: 3 });
	});

	it('la simulación no guarda nada', () => {
		seed();
		const preview = post({ type: 'DIVIDENDOS', date: '2025-06-01', account: 'BANCO', security: 'ACME', quantity: 100, price: 0.5, whtDest: 9.5, dryRun: true });
		expect(preview).toMatchObject({ status: 200, body: { saved: false, dryRun: true, description: 'Dividendos ACME (100*0.5 EUR)', grossEur: 50, taxEur: 9.5, cash: [{ amount: 40.5 }] } });
		expect(count()).toBe(2);
		// Tampoco deja el valor nuevo que habría creado.
		expect(post({ type: 'COMPRA', date: '2025-06-01', account: 'BANCO', security: 'ZETA', createSecurity: true, quantity: 1, price: 1, dryRun: true }).body.saved).toBe(false);
		expect((apiSecurities(db).body as Body[]).length).toBe(1);
	});

	it('errores (422), avisos que piden confirmación (409) y campos desconocidos', () => {
		seed();
		expect(post({ type: 'VENTA', date: '2025-03-01', account: 'BANCO', security: 'ACME', quantity: 101, price: 12 })).toMatchObject({ status: 422, body: { errors: [expect.stringMatching(/más acciones/)] } });
		const big = { type: 'COMPRA', date: '2025-03-01', account: 'BANCO', security: 'ACME', quantity: 1000, price: 10 };
		expect(post(big)).toMatchObject({ status: 409, body: { errors: [], warnings: [expect.stringMatching(/negativo/)] } });
		expect(post({ ...big, confirm: true }).status).toBe(201);
		expect(post({ type: 'GASTOS', date: '2025-03-01', account: 'BANCO', importe: 3 }).body.errors[0]).toMatch(/Campo desconocido: «importe»/);
		expect(post({ type: 'GASTOS', date: '2025-03-01', account: 'OTRO', amount: 3 }).body.errors[0]).toMatch(/Cuentas: BANCO, BRUSD/);
		expect(post({ type: 'COMPRA', date: '2025-03-01', account: 'BANCO', security: 'ZETA', quantity: 1, price: 1 }).body.errors[0]).toMatch(/createSecurity/);
		expect(post('texto').status).toBe(422);
		expect(post(undefined).status).toBe(422);
	});

	it('consulta, sustitución y borrado de una operación', () => {
		const id = seed();
		const read = apiOperation(db, id).body as Body;
		expect(read).toMatchObject({ id, portfolio: 'Prueba', source: 'api', imported: false, fields: { type: 'COMPRA', account: 'BANCO', security: 'ACME', quantity: '100', price: '10,5' } });
		expect(read.positions).toEqual([{ security: 'ACME', kind: 'buy', shares: 100, costEur: 1052.5, reducedCostEur: 1052.5 }]);
		// Lo leído se puede reenviar cambiando un campo.
		expect(post({ ...read.fields, quantity: 50 }, id)).toMatchObject({ status: 200, body: { saved: true, id, purchaseEur: 525 } });
		expect((apiState(db, 1, null).body as Body).positions[0].shares).toBe(50);
		expect(apiOperation(db, 999).status).toBe(404);
		expect(apiDelete(db, 999, false).status).toBe(404);
		const deposit = (apiOperations(db, 1, new URLSearchParams('tipo=APORTACION')).body as Body).operations[0].id;
		expect(apiDelete(db, deposit, false).status).toBe(409);
		expect(apiDelete(db, deposit, true)).toMatchObject({ status: 200, body: { deleted: true } });
		expect(count()).toBe(1);
	});
});

describe('valores', () => {
	it('cambia solo lo enviado y borra los que no tienen usos', () => {
		expect(apiPatchSecurity(db, 'acme', { name: 'Acme, S. A.', active: false })).toMatchObject({ status: 200, body: { saved: true, ticker: 'ACME', name: 'Acme, S. A.', active: false, currency: 'EUR', whtDestPct: 0.19 } });
		expect(apiPatchSecurity(db, 'acme', { active: 'no' }).status).toBe(422);
		expect(apiPatchSecurity(db, 'acme', { ticker: 'OTRO' }).status).toBe(422);
		expect(apiPatchSecurity(db, 'nada', { name: 'x' }).status).toBe(404);
		db.exec("INSERT INTO security (id, ticker) VALUES (2, 'BME;X')");
		expect(apiDeleteSecurity(db, 'BME;X', false).status).toBe(409);
		expect(apiDeleteSecurity(db, 'bme;x', true)).toMatchObject({ status: 200, body: { deleted: true, ticker: 'BME;X' } });
		seed();
		expect(apiDeleteSecurity(db, 'ACME', true).status).toBe(422);
		expect((apiSecurities(db).body as Body[]).map((s) => [s.ticker, s.uses])).toEqual([['ACME', 2]]);
	});

	it('una operación importada cambia de valor con keepEffects', () => {
		db.exec(`
			INSERT INTO security (id, ticker, currency) VALUES (2, 'ERRATA', 'EUR');
			INSERT INTO operation (id, portfolio_id, date, seq, type, account_id, security_id, gross_eur, description, source) VALUES (70, 1, '2024-06-01', 1, 'DIVIDENDOS', 1, 2, 500, 'Dividendos ACME', 'legacy');
			INSERT INTO cash_leg (operation_id, account_id, amount) VALUES (70, 1, 500);
		`);
		const read = apiOperation(db, 70).body as Body;
		expect(post({ type: read.type, date: read.date, description: read.description, security: 'ACME', keepEffects: true, dryRun: true }, 70).status).toBe(200);
		expect((apiOperation(db, 70).body as Body).security).toBe('ERRATA');
		expect(post({ type: read.type, date: read.date, description: read.description, security: 'ACME', keepEffects: true }, 70)).toMatchObject({ status: 200, body: { saved: true } });
		expect(apiOperation(db, 70).body).toMatchObject({ security: 'ACME', grossEur: 5, imported: true });
	});
});

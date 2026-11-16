import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { run, totalShares } from '../engine/engine.ts';
import { openDatabase } from './db.ts';
import { deleteOperation, getOperation, listDay, moveOperation, saveOperation } from './operations.ts';
import { loadOperations } from './store.ts';

// Todos los datos de estas pruebas son inventados.
let db: DatabaseSync;
const PORTFOLIO = 1;
const BANK = 1;
const ACME = 1;

beforeEach(() => {
	db = openDatabase(':memory:');
	db.exec(`
		INSERT INTO portfolio (id, name) VALUES (1, 'Prueba'), (2, 'Otra');
		INSERT INTO account (id, portfolio_id, code, name, currency) VALUES (1, 1, 'BANCO', 'Banco', 'EUR'), (2, 1, 'BRUSD', 'Broker USD', 'USD');
		INSERT INTO security (id, ticker, currency) VALUES (1, 'ACME', 'EUR');
	`);
});

const save = (fields: Record<string, string>, id: number | null = null, confirmed = false) => saveOperation(db, PORTFOLIO, id, fields, confirmed);
function saved(fields: Record<string, string>, id: number | null = null): number {
	const result = save(fields, id);
	if (!result.ok) throw new Error(result.errors.concat(result.warnings).join(' '));
	return result.id;
}
const deposit = (date = '2025-01-01', amount = '5000') => saved({ type: 'APORTACION', date, account: '1', amount });
const buy = (date: string, quantity: string, price = '10') => saved({ type: 'COMPRA', date, account: '1', security: '1', quantity, price, fees: '1,50' });
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const state = () => run(loadOperations(PORTFOLIO, db)).state;

describe('alta', () => {
	it('guarda cabecera, efectos, campos del formulario y auditoría', () => {
		deposit();
		const id = buy('2025-01-02', '100');
		const row = db.prepare('SELECT * FROM operation WHERE id = ?').get(id) as Record<string, unknown>;
		expect(row).toMatchObject({ portfolio_id: 1, type: 'COMPRA', source: 'manual', purchase_eur: 100000, fees_eur: 150, description: 'Compra 100 x ACME @ 10 EUR', quantity: 100 });
		expect(state().cash.get(BANK)).toBe(500000 - 100150);
		expect(totalShares(state().positions.get(ACME))).toBe(100_000_000);
		expect(getOperation(db, id)).toMatchObject({ imported: false, raw: { quantity: '100', fees: '1,50', type: 'COMPRA' } });
		const log = db.prepare("SELECT action, before_json, after_json FROM audit_log WHERE entity_id = ? AND entity = 'operation'").get(id) as { action: string; before_json: string | null; after_json: string };
		expect(log.action).toBe('create');
		expect(log.before_json).toBeNull();
		expect(JSON.parse(log.after_json)).toMatchObject({ type: 'COMPRA', cash: [{ account_id: 1, amount: -100150 }], positions: [{ kind: 'buy', shares: 100_000_000 }] });
	});

	it('las operaciones nuevas van al final de su día, aunque se metan en otro orden', () => {
		const later = deposit('2025-02-01');
		const first = deposit('2025-01-01');
		const second = deposit('2025-01-01');
		expect(listDay(db, PORTFOLIO, '2025-01-01').map((o) => o.id)).toEqual([first, second]);
		expect(loadOperations(PORTFOLIO, db).map((o) => o.id)).toEqual([first, second, later]);
	});

	it('rechaza sin guardar nada: datos incompletos y ventas de más', () => {
		deposit();
		buy('2025-01-02', '10');
		expect(save({ type: 'COMPRA', date: '2025-01-03', account: '1', security: '1' })).toMatchObject({ ok: false });
		expect(save({ type: 'COMPRA', date: 'ayer', account: '1', security: '1', quantity: '1', price: '1' })).toMatchObject({ ok: false, errors: ['La fecha no es válida.'] });
		const sale = save({ type: 'VENTA', date: '2025-01-03', account: '1', security: '1', quantity: '11', price: '10' });
		expect(sale.ok).toBe(false);
		expect(!sale.ok && sale.errors[0]).toMatch(/más acciones/);
		expect(count('operation')).toBe(2);
		expect(count('audit_log')).toBe(2);
	});

	it('el saldo negativo pide confirmación', () => {
		const attempt = save({ type: 'COMPRA', date: '2025-01-02', account: '1', security: '1', quantity: '1', price: '10' });
		expect(attempt).toMatchObject({ ok: false, errors: [] });
		expect(!attempt.ok && attempt.warnings[0]).toMatch(/Banco queda en negativo/);
		expect(count('operation')).toBe(0);
		expect(save({ type: 'COMPRA', date: '2025-01-02', account: '1', security: '1', quantity: '1', price: '10' }, null, true).ok).toBe(true);
	});

	it('da de alta un valor nuevo, y no lo deja si la operación se rechaza', () => {
		deposit();
		expect(save({ type: 'COMPRA', date: '2025-01-02', account: '1', security: 'nuevo', newTicker: 'zeta', currency: 'EUR' }).ok).toBe(false);
		expect(count('security')).toBe(1);
		const id = saved({ type: 'COMPRA', date: '2025-01-02', account: '1', security: 'nuevo', newTicker: 'zeta', currency: 'EUR', quantity: '1', price: '5' });
		expect(db.prepare("SELECT ticker FROM security WHERE id = (SELECT security_id FROM operation WHERE id = ?)").get(id)).toMatchObject({ ticker: 'ZETA' });
		expect(save({ type: 'COMPRA', date: '2025-01-02', account: '1', security: 'nuevo', newTicker: 'no vale', quantity: '1', price: '5' }).ok).toBe(false);
	});

	it('el split usa las acciones que había en su fecha', () => {
		deposit();
		buy('2025-01-02', '100');
		buy('2025-03-01', '10');
		saved({ type: 'SPLIT', date: '2025-02-01', security: '1', ratioNew: '2', ratioOld: '1' });
		expect(totalShares(state().positions.get(ACME))).toBe(210_000_000);
	});
});

describe('edición y borrado', () => {
	it('editar regenera los efectos y conserva el sitio en el día', () => {
		deposit();
		const first = buy('2025-01-02', '100');
		const second = buy('2025-01-02', '5');
		expect(saved({ type: 'COMPRA', date: '2025-01-02', account: '1', security: '1', quantity: '50', price: '10' }, first)).toBe(first);
		expect(totalShares(state().positions.get(ACME))).toBe(55_000_000);
		expect(count('cash_leg')).toBe(3);
		expect(listDay(db, PORTFOLIO, '2025-01-02').map((o) => o.id)).toEqual([first, second]);
		expect(db.prepare("SELECT count(*) AS n FROM audit_log WHERE action = 'update'").get()).toMatchObject({ n: 1 });
		// Al cambiar de fecha va al final del día nuevo.
		const other = buy('2025-01-05', '1');
		saved({ type: 'COMPRA', date: '2025-01-05', account: '1', security: '1', quantity: '50', price: '10' }, first);
		expect(listDay(db, PORTFOLIO, '2025-01-05').map((o) => o.id)).toEqual([other, first]);
	});

	it('no deja editar ni borrar operaciones de otra cartera', () => {
		const id = deposit();
		expect(saveOperation(db, 2, id, { type: 'APORTACION', date: '2025-01-01', account: '1', amount: '1' }).ok).toBe(false);
		expect(deleteOperation(db, 2, id).ok).toBe(false);
	});

	it('una operación importada conserva sus efectos si no se pide recalcularlos', () => {
		db.exec(`
			INSERT INTO operation (id, portfolio_id, date, seq, type, account_id, gross_eur, description, source) VALUES (50, 1, '2024-05-01', 7, 'CIERREANUAL', 1, 0, 'Ajuste antiguo', 'legacy');
			INSERT INTO cash_leg (operation_id, account_id, amount) VALUES (50, 1, 1234);
		`);
		expect(getOperation(db, 50)).toMatchObject({ imported: true, raw: { account: '1', description: 'Ajuste antiguo' } });
		expect(saved({ type: 'CIERREANUAL', date: '2024-05-02', description: 'Ajuste revisado', notes: 'nota', keepEffects: '1' }, 50)).toBe(50);
		expect(db.prepare('SELECT date, description, notes, source, type FROM operation WHERE id = 50').get()).toMatchObject({ date: '2024-05-02', description: 'Ajuste revisado', notes: 'nota', source: 'legacy', type: 'CIERREANUAL' });
		expect(state().cash.get(BANK)).toBe(1234);
		// Sin esa marca, un tipo que no tiene formulario no se puede guardar.
		expect(save({ type: 'CIERREANUAL', date: '2024-05-02' }, 50).ok).toBe(false);
	});

	it('borrar deja rastro y respeta las validaciones', () => {
		const money = deposit();
		const purchase = buy('2025-01-02', '10');
		saved({ type: 'VENTA', date: '2025-01-03', account: '1', security: '1', quantity: '10', price: '10' });
		expect(deleteOperation(db, PORTFOLIO, purchase)).toMatchObject({ ok: false });
		const attempt = deleteOperation(db, PORTFOLIO, money);
		expect(!attempt.ok && attempt.warnings.length).toBe(1);
		expect(deleteOperation(db, PORTFOLIO, money, true).ok).toBe(true);
		expect(count('operation')).toBe(2);
		expect(count('cash_leg')).toBe(2);
		const log = db.prepare("SELECT before_json, after_json FROM audit_log WHERE action = 'delete'").get() as { before_json: string; after_json: string | null };
		expect(JSON.parse(log.before_json)).toMatchObject({ type: 'APORTACION', cash: [{ amount: 500000 }] });
		expect(log.after_json).toBeNull();
	});
});

describe('orden dentro del día', () => {
	it('sube y baja, y no deja un orden imposible', () => {
		const a = deposit('2025-01-01');
		const b = buy('2025-01-01', '10');
		const c = saved({ type: 'VENTA', date: '2025-01-01', account: '1', security: '1', quantity: '10', price: '10' });
		expect(moveOperation(db, PORTFOLIO, a, 1).ok).toBe(true);
		expect(listDay(db, PORTFOLIO, '2025-01-01').map((o) => o.id)).toEqual([b, a, c]);
		expect(moveOperation(db, PORTFOLIO, a, -1).ok).toBe(true);
		expect(moveOperation(db, PORTFOLIO, a, -1).ok).toBe(true);
		expect(listDay(db, PORTFOLIO, '2025-01-01').map((o) => o.id)).toEqual([a, b, c]);
		// La venta no puede ir antes que la compra.
		expect(moveOperation(db, PORTFOLIO, c, -1).ok).toBe(false);
		expect(listDay(db, PORTFOLIO, '2025-01-01').map((o) => o.id)).toEqual([a, b, c]);
	});
});

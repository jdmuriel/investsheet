import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db.ts';
import { deleteSecurity, findSecurityRecord, listAccountRecords, listSecurityRecords, saveAccount, saveSecurity, securityFields } from './masters.ts';
import { saveOperation } from './operations.ts';
import { accountBalances, deleteReconciliation, listReconciliations, saveReconciliation } from './reconciliation.ts';

// Todos los datos de estas pruebas son inventados.
let db: DatabaseSync;

beforeEach(() => {
	db = openDatabase(':memory:');
	db.exec(`
		INSERT INTO portfolio (id, name) VALUES (1, 'Prueba'), (2, 'Otra');
		INSERT INTO account (id, portfolio_id, code, name, currency) VALUES (1, 1, 'BANCO', 'Banco', 'EUR'), (2, 2, 'OTRA', 'Otra', 'EUR');
		INSERT INTO security (id, ticker, currency, wht_source_pct) VALUES (1, 'ACME', 'EUR', 0.15);
	`);
});

const operation = (fields: Record<string, string>) => {
	const result = saveOperation(db, 1, null, fields);
	if (!result.ok) throw new Error(result.errors.join(' '));
	return result.id;
};
const audits = (entity: string) => db.prepare('SELECT action, before_json AS before, after_json AS after FROM audit_log WHERE entity = ? ORDER BY id').all(entity) as { action: string; before: string | null; after: string }[];

describe('cuentas', () => {
	it('da de alta una cuenta al final de la cartera, con auditoría', () => {
		const result = saveAccount(db, 1, null, { code: ' broker-usd ', name: 'Broker en dólares', broker: 'Broker', currency: 'usd' });
		expect(result.ok).toBe(true);
		expect(listAccountRecords(db, 1).map((a) => [a.code, a.name, a.currency, a.sortOrder, a.closed])).toEqual([
			['BANCO', 'Banco', 'EUR', 0, 0],
			['BROKER-USD', 'Broker en dólares', 'USD', 1, 0]
		]);
		expect(audits('account')).toMatchObject([{ action: 'create', before: null }]);
	});

	it('guarda la marca de broker extranjero', () => {
		expect(saveAccount(db, 1, 1, { code: 'BANCO', name: 'Banco', currency: 'EUR', foreignBroker: '1' }).ok).toBe(true);
		expect(listAccountRecords(db, 1)[0].foreignBroker).toBe(1);
		expect(saveAccount(db, 1, 1, { code: 'BANCO', name: 'Banco', currency: 'EUR' }).ok).toBe(true);
		expect(listAccountRecords(db, 1)[0].foreignBroker).toBe(0);
	});

	it('rechaza códigos repetidos en la cartera, monedas desconocidas y datos sin sentido', () => {
		expect(saveAccount(db, 1, null, { code: 'banco', currency: 'EUR' })).toMatchObject({ ok: false });
		expect(saveAccount(db, 1, null, { code: 'CON ESPACIO', currency: 'EUR' })).toMatchObject({ ok: false });
		expect(saveAccount(db, 1, null, { code: 'NUEVA', currency: 'XXX' })).toMatchObject({ ok: false });
		expect(saveAccount(db, 1, null, { code: 'NUEVA', currency: 'EUR', sortOrder: 'dos' })).toMatchObject({ ok: false });
		// El mismo código sí puede existir en otra cartera, y no se puede editar una cuenta de otra.
		expect(saveAccount(db, 1, null, { code: 'OTRA', currency: 'EUR' })).toMatchObject({ ok: true });
		expect(saveAccount(db, 1, 2, { code: 'OTRA2', currency: 'EUR' })).toMatchObject({ ok: false });
		expect(listAccountRecords(db, 1)).toHaveLength(2);
	});

	it('con movimientos no deja cambiar la moneda ni cerrarla con saldo', () => {
		operation({ type: 'APORTACION', date: '2025-01-01', account: '1', amount: '100' });
		expect(listAccountRecords(db, 1)[0]).toMatchObject({ movements: 1, balance: 10000 });
		expect(saveAccount(db, 1, 1, { code: 'BANCO', name: 'Banco', currency: 'USD' })).toMatchObject({ ok: false });
		expect(saveAccount(db, 1, 1, { code: 'BANCO', name: 'Banco', currency: 'EUR', closed: '1' })).toMatchObject({ ok: false });
		// Renombrarla sí, y cerrarla cuando queda a cero.
		expect(saveAccount(db, 1, 1, { code: 'BANCO1', name: 'Banco principal', currency: 'EUR' })).toMatchObject({ ok: true });
		operation({ type: 'RETIRADA', date: '2025-01-02', account: '1', amount: '100' });
		expect(saveAccount(db, 1, 1, { code: 'BANCO1', name: 'Banco principal', currency: 'EUR', closed: '1' })).toMatchObject({ ok: true });
		expect(listAccountRecords(db, 1)[0]).toMatchObject({ code: 'BANCO1', name: 'Banco principal', closed: 1 });
		expect(audits('account').map((a) => a.action)).toEqual(['update', 'update']);
		expect(JSON.parse(audits('account')[0].before!)).toMatchObject({ code: 'BANCO', name: 'Banco' });
	});
});

describe('valores', () => {
	it('encuentra un valor por su ticker sin distinguir mayúsculas', () => {
		expect(findSecurityRecord(db, 'acme')?.id).toBe(1);
		expect(findSecurityRecord(db, ' ACME ')?.id).toBe(1);
		expect(findSecurityRecord(db, 'NADA')).toBeNull();
	});

	it('da de alta un valor con las retenciones en porcentaje', () => {
		const result = saveSecurity(db, null, { ticker: 'nuevo', name: 'Nuevo, S. A.', currency: 'usd', country: 'us', whtSourcePct: '15', whtDestPct: '4,5 %', reinvest: '1', active: '1' });
		expect(result.ok).toBe(true);
		expect(listSecurityRecords(db).find((s) => s.ticker === 'NUEVO')).toMatchObject({ name: 'Nuevo, S. A.', currency: 'USD', country: 'US', whtSourcePct: 0.15, whtDestPct: 0.045, reinvest: 1, active: 1, uses: 0 });
	});

	it('edita un valor conservando lo que no se toca y deja el cambio en la auditoría', () => {
		expect(saveSecurity(db, 1, { ticker: 'ACME', name: 'Acme', currency: 'EUR', whtSourcePct: '15', whtDestPct: '19', reinvest: '1' })).toMatchObject({ ok: true, id: 1 });
		expect(listSecurityRecords(db)[0]).toMatchObject({ ticker: 'ACME', name: 'Acme', whtSourcePct: 0.15, whtDestPct: 0.19, active: 0 });
		const [log] = audits('security');
		expect(log.action).toBe('update');
		expect(JSON.parse(log.before!)).toMatchObject({ name: null, active: 1 });
		expect(JSON.parse(log.after)).toMatchObject({ name: 'Acme', active: 0 });
	});

	it('rechaza tickers repetidos o mal formados y porcentajes imposibles', () => {
		saveSecurity(db, null, { ticker: 'OTRO' });
		expect(saveSecurity(db, null, { ticker: 'acme' })).toMatchObject({ ok: false });
		expect(saveSecurity(db, 1, { ticker: 'OTRO' })).toMatchObject({ ok: false });
		expect(saveSecurity(db, null, { ticker: 'CON ESPACIO' })).toMatchObject({ ok: false });
		expect(saveSecurity(db, null, { ticker: 'BIEN', whtSourcePct: '150' })).toMatchObject({ ok: false });
		expect(saveSecurity(db, null, { ticker: 'BIEN', whtDestPct: 'mucho' })).toMatchObject({ ok: false });
		expect(saveSecurity(db, 99, { ticker: 'BIEN' })).toMatchObject({ ok: false });
		expect(listSecurityRecords(db).map((s) => s.ticker)).toEqual(['ACME', 'OTRO']);
	});

	it('borra solo valores sin usos, con sus precios y dividendos previstos', () => {
		saveSecurity(db, null, { ticker: 'ERRATA' });
		const errata = listSecurityRecords(db).find((s) => s.ticker === 'ERRATA')!.id;
		db.exec(`INSERT INTO price (security_id, date, price, currency, source) VALUES (${errata}, '2025-01-01', 1, 'EUR', 'manual')`);
		expect(deleteSecurity(db, errata)).toMatchObject({ ok: true });
		expect(listSecurityRecords(db).map((s) => s.ticker)).toEqual(['ACME']);
		expect(db.prepare('SELECT count(*) AS n FROM price').get()).toMatchObject({ n: 0 });
		expect(audits('security').at(-1)).toMatchObject({ action: 'delete', after: null });
		operation({ type: 'APORTACION', date: '2025-01-01', account: '1', amount: '5000' });
		operation({ type: 'COMPRA', date: '2025-01-02', account: '1', security: '1', quantity: '10', price: '10' });
		expect(deleteSecurity(db, 1)).toMatchObject({ ok: false });
		expect(deleteSecurity(db, 99)).toMatchObject({ ok: false });
	});

	it('los campos de un valor guardado se pueden volver a guardar sin cambiar nada', () => {
		saveSecurity(db, 1, { ticker: 'ACME', name: 'Acme', currency: 'EUR', whtSourcePct: '15', whtDestPct: '4,5', reinvest: '1', active: '1' });
		const before = listSecurityRecords(db)[0];
		expect(saveSecurity(db, 1, securityFields(before))).toMatchObject({ ok: true });
		expect(listSecurityRecords(db)[0]).toEqual(before);
	});

	it('cuenta los usos de un valor', () => {
		operation({ type: 'APORTACION', date: '2025-01-01', account: '1', amount: '5000' });
		operation({ type: 'COMPRA', date: '2025-01-02', account: '1', security: '1', quantity: '10', price: '10' });
		expect(listSecurityRecords(db)[0].uses).toBe(2); // la operación y su efecto en la posición
	});
});

describe('conciliación', () => {
	beforeEach(() => {
		operation({ type: 'APORTACION', date: '2025-01-10', account: '1', amount: '1000' });
		operation({ type: 'GASTOS', date: '2025-02-10', account: '1', amount: '12,50' });
	});

	it('da el saldo calculado al cierre de la fecha pedida', () => {
		expect(accountBalances(db, 1, '2025-01-31')).toMatchObject([{ code: 'BANCO', computed: 100000, last: null }]);
		expect(accountBalances(db, 1, '2025-02-10')[0].computed).toBe(98750);
		expect(accountBalances(db, 1, '2024-12-31')[0].computed).toBe(0);
	});

	it('anota el saldo real junto al calculado y lo muestra como última conciliación', () => {
		expect(saveReconciliation(db, 1, '2025-01-31', { '1': '1.000,00' }, 'extracto de enero')).toEqual({ ok: true, saved: 1 });
		expect(saveReconciliation(db, 1, '2025-02-28', { '1': '980' })).toEqual({ ok: true, saved: 1 });
		expect(listReconciliations(db, 1)).toMatchObject([
			{ date: '2025-02-28', real: 98000, computed: 98750, notes: null },
			{ date: '2025-01-31', real: 100000, computed: 100000, notes: 'extracto de enero' }
		]);
		expect(accountBalances(db, 1, '2025-03-01')[0].last).toMatchObject({ date: '2025-02-28', real: 98000, computed: 98750, computedNow: 98750 });
	});

	it('si después se corrige el registro, la última conciliación refleja el saldo de ahora', () => {
		saveReconciliation(db, 1, '2025-02-28', { '1': '980' });
		operation({ type: 'GASTOS', date: '2025-02-20', account: '1', amount: '7,50' });
		expect(accountBalances(db, 1, '2025-03-01')[0].last).toMatchObject({ real: 98000, computed: 98750, computedNow: 98000 });
	});

	it('rechaza fechas e importes no válidos, cuentas de otra cartera y envíos vacíos', () => {
		expect(saveReconciliation(db, 1, 'ayer', { '1': '10' })).toMatchObject({ ok: false });
		expect(saveReconciliation(db, 1, '2025-01-31', { '1': 'diez' })).toMatchObject({ ok: false });
		expect(saveReconciliation(db, 1, '2025-01-31', { '2': '10' })).toMatchObject({ ok: false });
		expect(saveReconciliation(db, 1, '2025-01-31', { '1': ' ' })).toMatchObject({ ok: false });
		expect(listReconciliations(db, 1)).toEqual([]);
	});

	it('borra una conciliación solo desde su cartera', () => {
		saveReconciliation(db, 1, '2025-01-31', { '1': '1000' });
		const [{ id }] = listReconciliations(db, 1);
		expect(deleteReconciliation(db, 2, id)).toBe(false);
		expect(deleteReconciliation(db, 1, id)).toBe(true);
		expect(listReconciliations(db, 1)).toEqual([]);
	});
});

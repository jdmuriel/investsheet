/** Mantenimiento de cuentas y valores. Cada cambio deja rastro en `audit_log`. */
import type { DatabaseSync } from 'node:sqlite';
import { run } from '../engine/engine.ts';
import { parseDecimal } from '../engine/form.ts';
import { loadOperations } from './store.ts';

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'DKK', 'SEK', 'NOK'];

export type MasterResult = { ok: true; id: number } | { ok: false; errors: string[] };
type Fields = Record<string, string>;

export interface AccountRecord {
	id: number;
	portfolioId: number;
	code: string;
	name: string;
	broker: string | null;
	currency: string;
	sortOrder: number;
	closed: number;
	/** Nº de movimientos de efectivo de la cuenta. */
	movements: number;
	/** Saldo actual, en su moneda. */
	balance: number;
}

export interface SecurityRecord {
	id: number;
	ticker: string;
	priceTicker: string | null;
	name: string | null;
	country: string | null;
	currency: string | null;
	sector: string | null;
	supersector: string | null;
	zone: string | null;
	tier: string | null;
	/** Retenciones como fracción (0,15 = 15 %). */
	whtSourcePct: number | null;
	whtDestPct: number | null;
	reinvest: number;
	active: number;
	/** Nº de operaciones y de efectos en posiciones que citan el valor. */
	uses: number;
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
	db.exec('BEGIN IMMEDIATE');
	try {
		const result = work();
		db.exec('COMMIT');
		return result;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

function audit(db: DatabaseSync, entity: 'account' | 'security', id: number, before: unknown, after: unknown): void {
	db.prepare('INSERT INTO audit_log (entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?)').run(entity, id, before ? 'update' : 'create', before ? JSON.stringify(before) : null, JSON.stringify(after));
}

const clean = (fields: Fields, key: string) => (fields[key] ?? '').trim();
const optional = (fields: Fields, key: string) => clean(fields, key) || null;
const flag = (fields: Fields, key: string) => (['1', 'on', 'true'].includes(clean(fields, key)) ? 1 : 0);

// ---------- Cuentas ----------

export function listAccountRecords(db: DatabaseSync, portfolioId: number): AccountRecord[] {
	const rows = db
		.prepare(
			`SELECT a.id, a.portfolio_id AS portfolioId, a.code, a.name, a.broker, a.currency, a.sort_order AS sortOrder, a.closed,
				(SELECT count(*) FROM cash_leg c WHERE c.account_id = a.id) AS movements
			FROM account a WHERE a.portfolio_id = ? ORDER BY a.sort_order, a.id`
		)
		.all(portfolioId) as unknown as AccountRecord[];
	const { state } = run(loadOperations(portfolioId, db));
	for (const r of rows) r.balance = state.cash.get(r.id) ?? 0;
	return rows;
}

/** Alta (`id` nulo) o edición de una cuenta de la cartera. */
export function saveAccount(db: DatabaseSync, portfolioId: number, id: number | null, fields: Fields): MasterResult {
	return transaction(db, (): MasterResult => {
		const errors: string[] = [];
		const accounts = listAccountRecords(db, portfolioId);
		const existing = id == null ? null : accounts.find((a) => a.id === id);
		if (id != null && !existing) return { ok: false, errors: ['La cuenta ya no existe.'] };
		if (!db.prepare('SELECT 1 FROM portfolio WHERE id = ?').get(portfolioId)) return { ok: false, errors: ['La cartera no existe.'] };

		const code = clean(fields, 'code').toUpperCase();
		const name = clean(fields, 'name') || code;
		const currency = clean(fields, 'currency').toUpperCase();
		const closed = flag(fields, 'closed');
		const order = clean(fields, 'sortOrder');
		const sortOrder = order === '' ? (existing?.sortOrder ?? Math.max(-1, ...accounts.map((a) => a.sortOrder)) + 1) : Number(order);

		if (!/^[A-Z0-9_-]{1,12}$/.test(code)) errors.push('El código debe tener entre 1 y 12 letras, cifras o guiones, sin espacios.');
		else if (accounts.some((a) => a.code.toUpperCase() === code && a.id !== id)) errors.push(`Ya hay una cuenta «${code}» en esta cartera.`);
		if (!CURRENCIES.includes(currency)) errors.push(`La moneda debe ser una de: ${CURRENCIES.join(', ')}.`);
		else if (existing && existing.currency !== currency && existing.movements > 0) errors.push('No se puede cambiar la moneda de una cuenta que ya tiene movimientos.');
		if (!Number.isInteger(sortOrder)) errors.push('El orden debe ser un número entero.');
		if (closed && existing && existing.balance !== 0) errors.push('No se puede cerrar una cuenta con saldo: traspásalo o retíralo antes.');
		if (errors.length) return { ok: false, errors };

		const values = [code, name, optional(fields, 'broker'), currency, sortOrder, closed];
		const savedId = existing
			? (db.prepare('UPDATE account SET code = ?, name = ?, broker = ?, currency = ?, sort_order = ?, closed = ? WHERE id = ?').run(...values, existing.id), existing.id)
			: Number(db.prepare('INSERT INTO account (code, name, broker, currency, sort_order, closed, portfolio_id) VALUES (?,?,?,?,?,?,?)').run(...values, portfolioId).lastInsertRowid);
		const row = (a: AccountRecord | null | undefined) => a && { code: a.code, name: a.name, broker: a.broker, currency: a.currency, sortOrder: a.sortOrder, closed: a.closed };
		audit(db, 'account', savedId, row(existing), { code, name, broker: optional(fields, 'broker'), currency, sortOrder, closed });
		return { ok: true, id: savedId };
	});
}

// ---------- Valores ----------

const SECURITY_COLUMNS = `id, ticker, price_ticker AS priceTicker, name, country, currency, sector, supersector, zone, tier,
	wht_source_pct AS whtSourcePct, wht_dest_pct AS whtDestPct, reinvest, active`;

export function listSecurityRecords(db: DatabaseSync): SecurityRecord[] {
	return db
		.prepare(
			`SELECT ${SECURITY_COLUMNS},
				(SELECT count(*) FROM operation o WHERE o.security_id = s.id) + (SELECT count(*) FROM position_leg l WHERE l.security_id = s.id OR l.to_security_id = s.id) AS uses
			FROM security s ORDER BY ticker`
		)
		.all() as unknown as SecurityRecord[];
}

export function getSecurityRecord(db: DatabaseSync, id: number): SecurityRecord | null {
	return listSecurityRecords(db).find((s) => s.id === id) ?? null;
}

/** Porcentaje tecleado («15», «15,5») a fracción; `undefined` si no es válido. */
function percent(text: string): number | null | undefined {
	if (text === '') return null;
	const n = parseDecimal(text.replace('%', '').trim());
	return n == null || !Number.isFinite(n) || n < 0 || n > 100 ? undefined : Math.round(n * 1e4) / 1e6;
}

/** Alta (`id` nulo) o edición de un valor. Las retenciones se teclean en porcentaje. */
export function saveSecurity(db: DatabaseSync, id: number | null, fields: Fields): MasterResult {
	return transaction(db, (): MasterResult => {
		const errors: string[] = [];
		const existing = id == null ? null : getSecurityRecord(db, id);
		if (id != null && !existing) return { ok: false, errors: ['El valor ya no existe.'] };

		const ticker = clean(fields, 'ticker').toUpperCase();
		const currency = clean(fields, 'currency').toUpperCase() || null;
		const whtSource = percent(clean(fields, 'whtSourcePct'));
		const whtDest = percent(clean(fields, 'whtDestPct'));
		if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) errors.push('El ticker debe tener entre 1 y 12 letras, cifras o puntos.');
		else if (((db.prepare('SELECT id FROM security WHERE ticker = ?').get(ticker) as { id: number } | undefined)?.id ?? id) !== id) errors.push(`Ya existe el valor «${ticker}».`);
		if (currency && !CURRENCIES.includes(currency)) errors.push(`La moneda debe ser una de: ${CURRENCIES.join(', ')}.`);
		if (whtSource === undefined) errors.push('La retención en origen debe ser un porcentaje entre 0 y 100.');
		if (whtDest === undefined) errors.push('La retención en destino debe ser un porcentaje entre 0 y 100.');
		if (errors.length) return { ok: false, errors };

		const after = {
			ticker,
			priceTicker: optional(fields, 'priceTicker'),
			name: optional(fields, 'name'),
			country: optional(fields, 'country')?.toUpperCase() ?? null,
			currency,
			sector: optional(fields, 'sector'),
			supersector: optional(fields, 'supersector'),
			zone: optional(fields, 'zone'),
			tier: optional(fields, 'tier'),
			whtSourcePct: whtSource as number | null,
			whtDestPct: whtDest as number | null,
			reinvest: flag(fields, 'reinvest'),
			active: flag(fields, 'active')
		};
		const values = Object.values(after);
		const savedId = existing
			? (db.prepare('UPDATE security SET ticker = ?, price_ticker = ?, name = ?, country = ?, currency = ?, sector = ?, supersector = ?, zone = ?, tier = ?, wht_source_pct = ?, wht_dest_pct = ?, reinvest = ?, active = ? WHERE id = ?').run(...values, existing.id),
				existing.id)
			: Number(
					db.prepare('INSERT INTO security (ticker, price_ticker, name, country, currency, sector, supersector, zone, tier, wht_source_pct, wht_dest_pct, reinvest, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values).lastInsertRowid
				);
		const before = existing && Object.fromEntries(Object.keys(after).map((key) => [key, existing[key as keyof SecurityRecord]]));
		audit(db, 'security', savedId, before, after);
		return { ok: true, id: savedId };
	});
}

/**
 * Borra un valor que no cita ninguna operación ni efecto (un ticker mal tecleado, por ejemplo), con sus precios,
 * calendario y cambios de dividendo. Un valor con historia no se borra: se marca como inactivo.
 */
export function deleteSecurity(db: DatabaseSync, id: number): MasterResult {
	return transaction(db, (): MasterResult => {
		const existing = getSecurityRecord(db, id);
		if (!existing) return { ok: false, errors: ['El valor ya no existe.'] };
		if (existing.uses > 0) return { ok: false, errors: [`No se puede borrar «${existing.ticker}»: lo usan ${existing.uses} operaciones y efectos. Márcalo como inactivo.`] };
		for (const table of ['price', 'dividend_schedule', 'dividend_change']) db.prepare(`DELETE FROM ${table} WHERE security_id = ?`).run(id);
		db.prepare('DELETE FROM security WHERE id = ?').run(id);
		const { uses: _, ...before } = existing;
		db.prepare('INSERT INTO audit_log (entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?)').run('security', id, 'delete', JSON.stringify(before), null);
		return { ok: true, id };
	});
}

/** Campos del formulario de un valor con lo que tiene guardado, para editar solo una parte. */
export function securityFields(record: SecurityRecord): Record<string, string> {
	const pct = (fraction: number | null) => (fraction == null ? '' : String(Math.round(fraction * 1e6) / 1e4));
	const text = (value: string | null) => value ?? '';
	return {
		ticker: record.ticker,
		priceTicker: text(record.priceTicker),
		name: text(record.name),
		country: text(record.country),
		currency: text(record.currency),
		sector: text(record.sector),
		supersector: text(record.supersector),
		zone: text(record.zone),
		tier: text(record.tier),
		whtSourcePct: pct(record.whtSourcePct),
		whtDestPct: pct(record.whtDestPct),
		reinvest: String(record.reinvest),
		active: String(record.active)
	};
}

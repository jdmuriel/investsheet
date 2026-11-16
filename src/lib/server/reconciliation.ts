/** Conciliación (RF-12): saldo real de cada cuenta según el broker frente al que calcula la aplicación. */
import type { DatabaseSync } from 'node:sqlite';
import { run } from '../engine/engine.ts';
import { parseDecimal } from '../engine/form.ts';
import { listAccounts, loadOperations } from './store.ts';

export interface Reconciliation {
	id: number;
	accountId: number;
	date: string;
	/** Saldo según el broker y saldo que calculaba la aplicación al anotarlo, en céntimos de la moneda de la cuenta. */
	real: number;
	computed: number;
	notes: string | null;
}

export interface AccountBalance {
	id: number;
	code: string;
	name: string;
	currency: string;
	closed: number;
	/** Saldo calculado al cierre de la fecha pedida. */
	computed: number;
	/** Última conciliación anotada, con la diferencia de entonces y la que da ahora el registro para aquella fecha. */
	last: (Reconciliation & { computedNow: number }) | null;
}

const isDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));

/** Saldo calculado de cada cuenta de la cartera al cierre de `date`, con su última conciliación. */
export function accountBalances(db: DatabaseSync, portfolioId: number, date: string): AccountBalance[] {
	const operations = loadOperations(portfolioId, db);
	const at = new Map<string, Map<number, number>>();
	const balancesAt = (day: string) => {
		if (!at.has(day)) at.set(day, new Map(run(operations, { until: day }).state.cash));
		return at.get(day)!;
	};
	const lastOf = db.prepare('SELECT id, account_id AS accountId, date, real_balance AS real, computed_balance AS computed, notes FROM reconciliation WHERE account_id = ? ORDER BY date DESC, id DESC LIMIT 1');
	return listAccounts(portfolioId, db).map((a) => {
		const last = lastOf.get(a.id) as unknown as Reconciliation | undefined;
		return { id: a.id, code: a.code, name: a.name, currency: a.currency, closed: a.closed, computed: balancesAt(date).get(a.id) ?? 0, last: last ? { ...last, computedNow: balancesAt(last.date).get(a.id) ?? 0 } : null };
	});
}

export type ReconcileResult = { ok: true; saved: number } | { ok: false; errors: string[] };

/**
 * Anota el saldo real de las cuentas a una fecha. `real` lleva, por id de cuenta, el importe tecleado;
 * las cuentas sin importe se ignoran. Junto a cada saldo se guarda el calculado en ese momento.
 */
export function saveReconciliation(db: DatabaseSync, portfolioId: number, date: string, real: Record<string, string>, notes = ''): ReconcileResult {
	if (!isDate(date)) return { ok: false, errors: ['La fecha no es válida.'] };
	const accounts = accountBalances(db, portfolioId, date);
	const errors: string[] = [];
	const rows: { accountId: number; real: number; computed: number }[] = [];
	for (const [key, text] of Object.entries(real)) {
		if (text.trim() === '') continue;
		const account = accounts.find((a) => String(a.id) === key);
		const amount = parseDecimal(text);
		if (!account) errors.push('La cuenta no pertenece a esta cartera.');
		else if (amount == null || !Number.isFinite(amount)) errors.push(`El saldo de ${account.name} no es un importe válido.`);
		else rows.push({ accountId: account.id, real: Math.round(amount * 100), computed: account.computed });
	}
	if (errors.length) return { ok: false, errors };
	if (rows.length === 0) return { ok: false, errors: ['Teclea el saldo real de al menos una cuenta.'] };
	const insert = db.prepare('INSERT INTO reconciliation (account_id, date, real_balance, computed_balance, notes) VALUES (?,?,?,?,?)');
	db.exec('BEGIN IMMEDIATE');
	try {
		for (const r of rows) insert.run(r.accountId, date, r.real, r.computed, notes.trim() || null);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
	return { ok: true, saved: rows.length };
}

/** Últimas conciliaciones de la cartera, de la más reciente a la más antigua. */
export function listReconciliations(db: DatabaseSync, portfolioId: number, limit = 30): Reconciliation[] {
	return db
		.prepare(
			`SELECT r.id, r.account_id AS accountId, r.date, r.real_balance AS real, r.computed_balance AS computed, r.notes
			FROM reconciliation r JOIN account a ON a.id = r.account_id WHERE a.portfolio_id = ? ORDER BY r.date DESC, r.id DESC LIMIT ?`
		)
		.all(portfolioId, limit) as unknown as Reconciliation[];
}

export function deleteReconciliation(db: DatabaseSync, portfolioId: number, id: number): boolean {
	return db.prepare('DELETE FROM reconciliation WHERE id = ? AND account_id IN (SELECT id FROM account WHERE portfolio_id = ?)').run(id, portfolioId).changes > 0;
}

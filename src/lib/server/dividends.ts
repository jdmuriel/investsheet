/** Calendario de dividendos previstos y cambios de dividendo (RF-16 a RF-18). Cada cambio deja rastro en `audit_log`. */
import type { DatabaseSync } from 'node:sqlite';
import { annualDividend, scheduleBefore } from '../engine/dividends.ts';
import { parseDecimal } from '../engine/form.ts';
import type { Schedule } from '../engine/portfolio.ts';
import { fxOn } from './market.ts';

export interface StoredSchedule extends Schedule {
	validFrom: string;
}

export interface DividendChange {
	id: number;
	securityId: number;
	ticker: string;
	date: string;
	oldAnnual: number;
	newAnnual: number;
	currency: string;
	/** Unidades de la moneda por euro en la fecha del cambio. */
	fxRate: number;
	url: string | null;
	note: string | null;
}

const isDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
const months = (json: string): number[] => {
	const parsed = JSON.parse(json) as unknown;
	return Array.from({ length: 12 }, (_, i) => (Array.isArray(parsed) && typeof parsed[i] === 'number' ? parsed[i] : 0));
};

/** Calendario vigente de cada valor en `date` (por defecto, el más reciente). */
export function currentSchedules(db: DatabaseSync, date = '9999-12-31'): Map<number, StoredSchedule> {
	const rows = db
		.prepare('SELECT d.security_id AS id, d.valid_from AS validFrom, d.currency, d.months_json AS json FROM dividend_schedule d WHERE d.valid_from = (SELECT max(valid_from) FROM dividend_schedule WHERE security_id = d.security_id AND valid_from <= ?)')
		.all(date) as { id: number; validFrom: string; currency: string; json: string }[];
	return new Map(rows.map((r) => [r.id, { validFrom: r.validFrom, currency: r.currency, months: months(r.json) }]));
}

export function listChanges(db: DatabaseSync): DividendChange[] {
	return db
		.prepare(
			`SELECT c.id, c.security_id AS securityId, s.ticker, c.date, c.old_annual AS oldAnnual, c.new_annual AS newAnnual, c.currency, c.fx_rate AS fxRate, c.url, c.note
			FROM dividend_change c JOIN security s ON s.id = c.security_id ORDER BY c.date DESC, c.id DESC`
		)
		.all() as unknown as DividendChange[];
}

export type ScheduleResult = { ok: true; changeId: number | null } | { ok: false; errors: string[] };

const audit = (db: DatabaseSync, entity: string, id: number, action: string, before: unknown, after: unknown) =>
	db.prepare('INSERT INTO audit_log (entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?)').run(entity, id, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));

/** Versiones del calendario de un valor, de la más antigua a la más reciente. */
export function scheduleVersions(db: DatabaseSync, securityId: number): StoredSchedule[] {
	return (db.prepare('SELECT valid_from AS validFrom, currency, months_json AS json FROM dividend_schedule WHERE security_id = ? ORDER BY valid_from').all(securityId) as { validFrom: string; currency: string; json: string }[]).map((v) => ({ validFrom: v.validFrom, currency: v.currency, months: months(v.json) }));
}

const sameSchedule = (a: StoredSchedule, b: { currency: string; months: number[] }) => a.currency === b.currency && a.months.every((m, i) => m === (b.months[i] ?? 0));

/**
 * Guarda el calendario de un valor a partir de `date` (campos `m1` a `m12`, importe por acción de cada mes).
 * Con `change` deja además constancia del cambio de dividendo (RF-17): una sola acción versiona el calendario
 * y anota el dividendo anual anterior y el nuevo con el cambio de la moneda en esa fecha.
 * Sin `change` es una corrección: sustituye la versión de esa fecha o crea la primera.
 * Las versiones posteriores que solo repetían el calendario anterior se quitan, porque si no volverían a ponerlo
 * (por ejemplo, la importada de la hoja ante un cambio fechado unos días antes); quedan en la auditoría con el
 * cambio que las quitó, para restaurarlas si ese cambio se borra.
 */
export function saveSchedule(db: DatabaseSync, securityId: number, fields: Record<string, string>): ScheduleResult {
	const security = db.prepare('SELECT ticker, currency FROM security WHERE id = ?').get(securityId) as { ticker: string; currency: string | null } | undefined;
	if (!security) return { ok: false, errors: ['El valor no existe.'] };
	const errors: string[] = [];
	const date = (fields.date ?? '').trim();
	if (!isDate(date)) errors.push('La fecha no es válida.');
	const currency = (fields.currency || security.currency || '').trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) errors.push('Indica la moneda del dividendo.');
	const amounts: number[] = [];
	for (let m = 1; m <= 12; m++) {
		const n = parseDecimal(fields[`m${m}`]);
		if (n != null && (!Number.isFinite(n) || n < 0)) errors.push(`El importe del mes ${m} no es válido.`);
		amounts.push(n != null && Number.isFinite(n) ? n : 0);
	}
	const isChange = ['1', 'on', 'true'].includes(fields.change ?? '');
	const versions = scheduleVersions(db, securityId);
	const replaced = versions.find((v) => v.validFrom === date) ?? null;
	const before = scheduleBefore(
		versions.filter((v) => v !== replaced),
		date
	);
	if (isChange && before && before.currency !== currency) errors.push(`El calendario anterior está en ${before.currency}: un cambio de dividendo no puede cambiar de moneda.`);
	let fxRate = 1;
	if (isChange && currency !== 'EUR' && errors.length === 0) {
		const typed = parseDecimal(fields.fxRate);
		const known = fxOn(db, currency, date);
		if (typed != null && Number.isFinite(typed) && typed > 0) fxRate = typed;
		else if (known) fxRate = known.rate;
		else errors.push(`No hay tipo de cambio de ${currency} para esa fecha: tecléalo.`);
	}
	if (errors.length) return { ok: false, errors };

	const oldAnnual = before ? annualDividend(before.months) : 0;
	const newAnnual = annualDividend(amounts);
	if (isChange && oldAnnual === newAnnual) return { ok: false, errors: ['El dividendo anual no cambia: para corregir el reparto por meses, desmarca «cambio de dividendo».'] };

	// Versiones posteriores seguidas que repiten el calendario anterior: sobran.
	const stale: StoredSchedule[] = [];
	if (before) {
		for (const v of versions.filter((v) => v.validFrom > date)) {
			if (!sameSchedule(v, before)) break;
			stale.push(v);
		}
	}

	db.exec('BEGIN IMMEDIATE');
	try {
		db.prepare('INSERT INTO dividend_schedule (security_id, valid_from, currency, months_json) VALUES (?,?,?,?) ON CONFLICT (security_id, valid_from) DO UPDATE SET currency = excluded.currency, months_json = excluded.months_json').run(securityId, date, currency, JSON.stringify(amounts));
		audit(db, 'dividend_schedule', securityId, replaced ? 'update' : 'create', replaced ?? before, { validFrom: date, currency, months: amounts });
		let changeId: number | null = null;
		if (isChange) {
			const change = { date, oldAnnual, newAnnual, currency, fxRate, url: (fields.url ?? '').trim() || null, note: (fields.note ?? '').trim() || null };
			changeId = Number(db.prepare('INSERT INTO dividend_change (security_id, date, old_annual, new_annual, currency, fx_rate, url, note) VALUES (?,?,?,?,?,?,?,?)').run(securityId, date, oldAnnual, newAnnual, currency, fxRate, change.url, change.note).lastInsertRowid);
			audit(db, 'dividend_change', changeId, 'create', null, { ticker: security.ticker, ...change });
		}
		for (const v of stale) {
			db.prepare('DELETE FROM dividend_schedule WHERE security_id = ? AND valid_from = ?').run(securityId, v.validFrom);
			audit(db, 'dividend_schedule', securityId, 'delete', { ...v, removedBy: changeId, removedFor: date }, null);
		}
		db.exec('COMMIT');
		return { ok: true, changeId };
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/**
 * Borra un cambio de dividendo y deshace lo que hizo en el calendario: quita la versión de su fecha si sigue siendo
 * la que anotó, y repone las versiones posteriores que quitó al guardarlo.
 */
export function deleteChange(db: DatabaseSync, id: number): boolean {
	const before = listChanges(db).find((c) => c.id === id);
	if (!before) return false;
	db.exec('BEGIN IMMEDIATE');
	try {
		db.prepare('DELETE FROM dividend_change WHERE id = ?').run(id);
		audit(db, 'dividend_change', id, 'delete', before, null);
		const version = scheduleVersions(db, before.securityId).find((v) => v.validFrom === before.date);
		if (version && version.currency === before.currency && annualDividend(version.months) === before.newAnnual) {
			db.prepare('DELETE FROM dividend_schedule WHERE security_id = ? AND valid_from = ?').run(before.securityId, before.date);
			audit(db, 'dividend_schedule', before.securityId, 'delete', { ...version, removedWithChange: id }, null);
		}
		const removed = db.prepare(`SELECT before_json AS json FROM audit_log WHERE entity = 'dividend_schedule' AND entity_id = ? AND action = 'delete' AND json_extract(before_json, '$.removedBy') = ?`).all(before.securityId, id) as { json: string }[];
		for (const r of removed) {
			const v = JSON.parse(r.json) as StoredSchedule;
			const restored = db.prepare('INSERT INTO dividend_schedule (security_id, valid_from, currency, months_json) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').run(before.securityId, v.validFrom, v.currency, JSON.stringify(v.months));
			if (restored.changes) audit(db, 'dividend_schedule', before.securityId, 'create', null, { validFrom: v.validFrom, currency: v.currency, months: v.months, restoredFrom: id });
		}
		db.exec('COMMIT');
		return true;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/** Borra una versión del calendario (para deshacer una anotada por error). Los cambios anotados no se tocan. */
export function deleteScheduleVersion(db: DatabaseSync, securityId: number, validFrom: string): boolean {
	const version = scheduleVersions(db, securityId).find((v) => v.validFrom === validFrom);
	if (!version) return false;
	db.prepare('DELETE FROM dividend_schedule WHERE security_id = ? AND valid_from = ?').run(securityId, validFrom);
	audit(db, 'dividend_schedule', securityId, 'delete', version, null);
	return true;
}

/**
 * Corrige la moneda y el cambio de un cambio de dividendo ya anotado (por ejemplo, uno importado de la hoja con la
 * moneda equivocada). Sin `fxRate` se toma el cambio de la moneda en la fecha del cambio; en euros es siempre 1.
 */
export function updateChangeCurrency(db: DatabaseSync, id: number, currency: string, fxRate?: number): { ok: true; change: DividendChange } | { ok: false; errors: string[] } {
	const before = listChanges(db).find((c) => c.id === id);
	if (!before) return { ok: false, errors: ['Ese cambio de dividendo no existe.'] };
	const code = currency.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(code)) return { ok: false, errors: ['La moneda debe ser un código de tres letras, como USD.'] };
	let rate = code === 'EUR' ? 1 : fxRate;
	if (rate == null) rate = fxOn(db, code, before.date)?.rate;
	if (rate == null) return { ok: false, errors: [`No hay tipo de cambio de ${code} en ${before.date}: indícalo.`] };
	if (!Number.isFinite(rate) || rate <= 0) return { ok: false, errors: ['El cambio debe ser un número positivo.'] };
	db.prepare('UPDATE dividend_change SET currency = ?, fx_rate = ? WHERE id = ?').run(code, rate, id);
	const after = listChanges(db).find((c) => c.id === id)!;
	audit(db, 'dividend_change', id, 'update', before, after);
	return { ok: true, change: after };
}

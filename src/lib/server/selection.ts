/**
 * Selección mensual (RF-31 a RF-36): valores de cada lista con su orden, datos del día, revisiones cerradas
 * con el precio de cada valor, propuestas y elección del mes. El cálculo de cada fila está en el motor.
 */
import type { DatabaseSync } from 'node:sqlite';
import { run, totalReducedCost, totalShares } from '../engine/engine.ts';
import { DEFAULT_PARAMS, LISTS, listOf, selectionRow, type ListKey, type SelectionParams, type SelectionRow } from '../engine/selection.ts';
import { MICRO } from '../engine/types.ts';
import { currentSchedules } from './dividends.ts';
import { fxOn, getSetting, latestFx, latestQuotes, setSetting } from './market.ts';
import { loadOperations } from './store.ts';

export interface SelectionItem extends SelectionRow {
	id: number;
	name: string | null;
	country: string | null;
	currency: string | null;
	priceDate: string | null;
	position: number;
}

export interface Review {
	id: number;
	date: string;
	proposals: string | null;
	choice: string | null;
	source: string;
	items: number;
}

export interface SelectionData {
	lists: { key: ListKey; label: string; rows: SelectionItem[] }[];
	params: SelectionParams;
	/** Revisión con la que se compara la variación. */
	lastReview: Review | null;
	reviews: Review[];
	/** Valores activos que no están en la selección, para añadirlos. */
	candidates: { id: number; ticker: string; name: string | null }[];
}

export function loadParams(db: DatabaseSync): SelectionParams {
	const saved = getSetting(db, 'selection_params');
	if (!saved) return DEFAULT_PARAMS;
	const p = JSON.parse(saved) as Partial<SelectionParams>;
	return { ...DEFAULT_PARAMS, ...p, limits: { ...DEFAULT_PARAMS.limits, ...p.limits } };
}

/** Parámetros tecleados: `T1`, `T1E`… en miles de euros y los umbrales en porcentaje. */
export function saveParams(db: DatabaseSync, fields: Record<string, string>): { ok: true } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const read = (key: string, label: string, max: number) => {
		const n = Number((fields[key] ?? '').replace(',', '.'));
		if (!Number.isFinite(n) || n < 0 || n > max) errors.push(`${label}: debe ser un número entre 0 y ${max}.`);
		return n;
	};
	const limits = Object.fromEntries((['T1', 'T2', 'T3'] as const).map((t) => [t, { other: read(t, `${t}, resto`, 1000), spain: read(`${t}E`, `${t}, España`, 1000) }])) as SelectionParams['limits'];
	const significant = read('significant', 'Variación reseñable', 100) / 100;
	const high = read('high', 'Variación grande', 100) / 100;
	if (!errors.length && high < significant) errors.push('La variación grande no puede ser menor que la reseñable.');
	if (errors.length) return { ok: false, errors };
	setSetting(db, 'selection_params', JSON.stringify({ limits, significant, high }));
	return { ok: true };
}

export function listReviews(db: DatabaseSync, portfolioId: number): Review[] {
	return db
		.prepare('SELECT r.id, r.date, r.proposals, r.choice, r.source, (SELECT count(*) FROM selection_review_item i WHERE i.review_id = r.id) AS items FROM selection_review r WHERE r.portfolio_id = ? ORDER BY r.date DESC')
		.all(portfolioId) as unknown as Review[];
}

/**
 * `today` fija la revisión de referencia para la variación: la última anterior a hoy, de modo que cerrar
 * la de hoy no deja a cero las variaciones del día.
 */
export function loadSelection(db: DatabaseSync, portfolioId: number, today = '9999-12-31'): SelectionData {
	const params = loadParams(db);
	const reviews = listReviews(db, portfolioId);
	const lastReview = reviews.find((r) => r.date < today) ?? reviews[0] ?? null;
	const lastPrices = new Map(
		lastReview ? (db.prepare('SELECT security_id AS id, price FROM selection_review_item WHERE review_id = ?').all(lastReview.id) as { id: number; price: number }[]).map((r) => [r.id, r.price]) : []
	);
	const entries = db
		.prepare(
			`SELECT s.id, s.ticker, s.name, s.country, s.currency, s.zone, s.tier, s.target_price AS target, s.dividend_estimate AS estimate, e.position
			FROM selection_entry e JOIN security s ON s.id = e.security_id WHERE e.portfolio_id = ? ORDER BY e.position, s.ticker`
		)
		.all(portfolioId) as { id: number; ticker: string; name: string | null; country: string | null; currency: string | null; zone: string | null; tier: string | null; target: number | null; estimate: number | null; position: number }[];
	const { state } = run(loadOperations(portfolioId, db));
	const quotes = latestQuotes(db);
	const schedules = currentSchedules(db);
	const fx = latestFx(db);
	const toEur = (amount: number, currency: string) => (currency === 'EUR' ? amount : fx.get(currency) ? amount / fx.get(currency)!.rate : null);

	const rows: SelectionItem[] = entries.map((e) => {
		const quote = quotes.get(e.id) ?? null;
		const currency = quote?.currency ?? e.currency;
		const position = state.positions.get(e.id);
		const shares = totalShares(position);
		// RPD con el calendario vigente; si no hay, con el dividendo estimado (candidatos).
		const schedule = schedules.get(e.id);
		const annual = schedule ? { amount: schedule.months.reduce((a, m) => a + m, 0), currency: schedule.currency } : e.estimate != null && currency ? { amount: e.estimate, currency } : null;
		const priceEur = quote ? toEur(quote.price, quote.currency) : null;
		const annualEur = annual ? toEur(annual.amount, annual.currency) : null;
		// Precio medio de compra en la moneda del valor: coste reducido de los lotes vivos al cambio del día de cada compra.
		let pmc: number | null = null;
		if (shares > 0 && currency) {
			const local = position!.lots.reduce((a, l) => (a == null ? null : currency === 'EUR' ? a + l.reducedCost : fxOn(db, currency, l.date) ? a + l.reducedCost * fxOn(db, currency, l.date)!.rate : null), 0 as number | null);
			pmc = local == null ? null : local / 100 / (shares / MICRO);
		}
		const row = selectionRow(
			{
				ticker: e.ticker,
				zone: e.zone,
				tier: e.tier,
				price: quote?.price ?? null,
				lastPrice: lastPrices.get(e.id) ?? null,
				target: e.target,
				rpd: priceEur && annualEur != null ? annualEur / priceEur : null,
				invested: shares > 0 ? totalReducedCost(position) : 0,
				pmc
			},
			params
		);
		return { ...row, id: e.id, name: e.name, country: e.country, currency, priceDate: quote?.date ?? null, position: e.position };
	});
	const inSelection = new Set(entries.map((e) => e.id));
	const candidates = (db.prepare('SELECT id, ticker, name FROM security WHERE active = 1 ORDER BY ticker').all() as { id: number; ticker: string; name: string | null }[]).filter((s) => !inSelection.has(s.id));
	return {
		lists: LISTS.map((l) => ({ key: l.key, label: l.label, rows: rows.filter((r) => r.list === l.key) })),
		params,
		lastReview,
		reviews,
		candidates
	};
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

/** Nuevo orden: los identificadores en el orden deseado (una lista o todas). Los demás conservan el suyo detrás. */
export function saveOrder(db: DatabaseSync, portfolioId: number, ids: number[]): void {
	transaction(db, () => {
		const current = (db.prepare('SELECT security_id AS id FROM selection_entry WHERE portfolio_id = ? ORDER BY position').all(portfolioId) as { id: number }[]).map((r) => r.id);
		const wanted = ids.filter((id) => current.includes(id));
		// Los valores reordenados ocupan, en su nuevo orden, los mismos huecos que ocupaban.
		const slots = current.map((id, i) => (wanted.includes(id) ? i : -1)).filter((i) => i >= 0);
		const next = [...current];
		slots.forEach((slot, k) => (next[slot] = wanted[k]));
		const upd = db.prepare('UPDATE selection_entry SET position = ? WHERE portfolio_id = ? AND security_id = ?');
		next.forEach((id, i) => upd.run(i + 1, portfolioId, id));
	});
}

export function addEntry(db: DatabaseSync, portfolioId: number, securityId: number): boolean {
	if (!db.prepare('SELECT 1 FROM security WHERE id = ?').get(securityId)) return false;
	const max = (db.prepare('SELECT coalesce(max(position), 0) AS n FROM selection_entry WHERE portfolio_id = ?').get(portfolioId) as { n: number }).n;
	db.prepare('INSERT OR IGNORE INTO selection_entry (portfolio_id, security_id, position) VALUES (?,?,?)').run(portfolioId, securityId, max + 1);
	return true;
}

export function removeEntry(db: DatabaseSync, portfolioId: number, securityId: number): void {
	db.prepare('DELETE FROM selection_entry WHERE portfolio_id = ? AND security_id = ?').run(portfolioId, securityId);
}

/**
 * Cierra la revisión del día (RF-32): guarda la lista, la posición y el precio de hoy de cada valor con precio,
 * y las propuestas y la elección. Cerrarla otra vez el mismo día la sustituye.
 */
export function closeReview(db: DatabaseSync, portfolioId: number, date: string, proposals: string, choice: string): { ok: true; id: number; items: number } | { ok: false; errors: string[] } {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, errors: ['La fecha no es válida.'] };
	const data = loadSelection(db, portfolioId, date);
	const rows = data.lists.flatMap((l) => l.rows).filter((r) => r.price != null && r.currency);
	if (!rows.length) return { ok: false, errors: ['Ningún valor de la selección tiene precio.'] };
	return transaction(db, () => {
		const existing = db.prepare('SELECT id FROM selection_review WHERE portfolio_id = ? AND date = ?').get(portfolioId, date) as { id: number } | undefined;
		let id: number;
		if (existing) {
			id = existing.id;
			db.prepare("UPDATE selection_review SET proposals = ?, choice = ?, source = 'app' WHERE id = ?").run(proposals.trim() || null, choice.trim() || null, id);
			db.prepare('DELETE FROM selection_review_item WHERE review_id = ?').run(id);
		} else id = Number(db.prepare('INSERT INTO selection_review (portfolio_id, date, proposals, choice) VALUES (?,?,?,?)').run(portfolioId, date, proposals.trim() || null, choice.trim() || null).lastInsertRowid);
		const ins = db.prepare('INSERT INTO selection_review_item (review_id, security_id, list, position, price, currency) VALUES (?,?,?,?,?,?)');
		rows.forEach((r, i) => ins.run(id, r.id, r.list, i + 1, r.price, r.currency));
		return { ok: true as const, id, items: rows.length };
	});
}

/** Propuestas y elección de una revisión ya cerrada (RF-36). */
export function saveReviewNotes(db: DatabaseSync, portfolioId: number, reviewId: number, proposals: string, choice: string): boolean {
	return db.prepare('UPDATE selection_review SET proposals = ?, choice = ? WHERE id = ? AND portfolio_id = ?').run(proposals.trim() || null, choice.trim() || null, reviewId, portfolioId).changes > 0;
}

/** Precio de cada valor en cada revisión, de la más antigua a la más reciente (evolución mensual). */
export function priceHistory(db: DatabaseSync, portfolioId: number, securityId: number): { date: string; price: number; currency: string }[] {
	return db
		.prepare('SELECT r.date, i.price, i.currency FROM selection_review_item i JOIN selection_review r ON r.id = i.review_id WHERE r.portfolio_id = ? AND i.security_id = ? ORDER BY r.date')
		.all(portfolioId, securityId) as { date: string; price: number; currency: string }[];
}

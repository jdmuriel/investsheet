/** Datos del cuadro de cartera: posiciones del registro con el último precio, cambio y calendario guardados. */
import type { DatabaseSync } from 'node:sqlite';
import { run } from '../engine/engine.ts';
import { portfolioView, reorder, type PortfolioView, type SecurityInfo } from '../engine/portfolio.ts';
import { currentSchedules } from './dividends.ts';
import { latestFx, latestQuotes } from './market.ts';
import { listAccounts, loadOperations } from './store.ts';

export function listSecurityInfo(db: DatabaseSync): SecurityInfo[] {
	const rows = db.prepare('SELECT id, ticker, name, country, sector, supersector, zone, tier, wht_source_pct AS whtSourcePct, wht_dest_pct AS whtDestPct, reinvest FROM security ORDER BY ticker').all() as unknown as (Omit<SecurityInfo, 'reinvest'> & { reinvest: number })[];
	return rows.map((s) => ({ ...s, reinvest: Boolean(s.reinvest) }));
}

export interface PortfolioData extends PortfolioView {
	/** Posición por defecto de cada valor en la cartera (el orden de \`Control cartera\`), por identificador. */
	order: Record<number, number>;
	/** Fechas del precio más antiguo y más reciente entre los valores con posición, y cambios usados. */
	oldestQuote: string | null;
	newestQuote: string | null;
	fx: { currency: string; rate: number; date: string }[];
}

/** `today` (AAAA-MM-DD) fija el mes en que empieza la previsión. */
export function loadPortfolio(db: DatabaseSync, portfolioId: number, today: string): PortfolioData {
	const { state } = run(loadOperations(portfolioId, db));
	const fx = latestFx(db);
	const view = portfolioView({
		state,
		securities: listSecurityInfo(db),
		quotes: latestQuotes(db),
		schedules: currentSchedules(db),
		fx: new Map([...fx].map(([currency, r]) => [currency, r.rate])),
		cash: listAccounts(portfolioId, db).map((a) => ({ currency: a.currency, amount: state.cash.get(a.id) ?? 0 })),
		month: Number(today.slice(5, 7))
	});
	const dates = view.rows.flatMap((r) => (r.quote ? [r.quote.date] : [])).sort();
	const order = db.prepare('SELECT security_id AS id, sort_order AS n FROM portfolio_security WHERE portfolio_id = ?').all(portfolioId) as { id: number; n: number }[];
	return { ...view, order: Object.fromEntries(order.map((o) => [o.id, o.n])), oldestQuote: dates[0] ?? null, newestQuote: dates.at(-1) ?? null, fx: [...fx].map(([currency, r]) => ({ currency, ...r })).sort((a, b) => a.currency.localeCompare(b.currency)) };
}

/** Guarda el orden de los valores que se ven en el cuadro (`ids`, en el orden nuevo), sin mover los demás. */
export function savePortfolioOrder(db: DatabaseSync, portfolioId: number, ids: number[]): void {
	const current = db.prepare('SELECT security_id AS id FROM portfolio_security WHERE portfolio_id = ? ORDER BY sort_order').all(portfolioId) as { id: number }[];
	const known = new Set((db.prepare('SELECT id FROM security').all() as { id: number }[]).map((r) => r.id));
	const order = reorder(
		current.map((r) => r.id),
		[...new Set(ids)].filter((id) => known.has(id))
	);
	const save = db.prepare('INSERT INTO portfolio_security (portfolio_id, security_id, sort_order) VALUES (?, ?, ?) ON CONFLICT (portfolio_id, security_id) DO UPDATE SET sort_order = excluded.sort_order');
	db.exec('BEGIN IMMEDIATE');
	try {
		order.forEach((id, i) => save.run(portfolioId, id, i));
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

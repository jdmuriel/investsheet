/** Lectura de los cobros de una cartera para el historial de dividendos (`#lib/engine/history.ts`). */
import type { DatabaseSync } from 'node:sqlite';
import { sharesAt } from '#lib/engine/dividends.ts';
import { HISTORY_TYPES, addMonths, buildHistory, type History, type Month, type Split } from '#lib/engine/history.ts';
import { MICRO } from '#lib/engine/types.ts';
import { listSecurities, loadOperations, type OperationRow } from './store.ts';

export interface PortfolioHistory {
	history: History;
	splits: Split[];
	/** Acciones de cada valor al final de un mes. */
	heldAt: (month: Month) => (securityId: number) => number;
}

function dayBefore(date: string): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export function loadHistory(db: DatabaseSync, portfolioId: number): PortfolioHistory {
	const ops = loadOperations(portfolioId, db);
	const currencies = new Map(listSecurities(db).map((s) => [s.id, s.currency]));
	const paid = ops.filter((o): o is OperationRow & { securityId: number } => HISTORY_TYPES.includes(o.type) && o.securityId != null && o.grossEur !== 0);
	// Si un cobro no trae el nº de acciones, se toman las que había en su fecha.
	const missing = paid.filter((o) => o.quantity == null);
	const known = new Map(sharesAt(ops, missing.map((o) => ({ securityId: o.securityId, date: o.date }))).map((s, i) => [missing[i].id, s]));
	const history = buildHistory(
		paid.map((o) => {
			const shares = o.quantity ?? known.get(o.id) ?? null;
			const dps = o.price ?? (o.amountLocal != null && shares ? o.amountLocal / 100 / shares : null);
			return { date: o.date, securityId: o.securityId, ticker: o.ticker ?? '', account: o.accountCode ?? '', shares: shares || null, dps, currency: o.currency ?? currencies.get(o.securityId) ?? 'EUR', gross: o.grossEur, net: o.grossEur - o.taxEur - o.feesEur };
		})
	);
	// Factor de cada split: acciones después entre acciones antes. `sharesAt` da las acciones al final del día pedido.
	const splitOps = ops.filter((o) => o.type === 'SPLIT');
	const before = sharesAt(
		ops,
		splitOps.flatMap((o) => o.positions.map((l) => ({ securityId: l.securityId, date: dayBefore(o.date) })))
	);
	let k = 0;
	const splits: Split[] = [];
	for (const o of splitOps)
		for (const l of o.positions) {
			const prev = before[k++];
			if (prev > 0) splits.push({ securityId: l.securityId, date: o.date, factor: (prev + l.shares / MICRO) / prev });
		}
	const heldAt = (month: Month) => {
		const ids = [...history.tickers.keys()];
		const date = dayBefore(`${addMonths(month, 1)}-01`);
		const shares = new Map(sharesAt(ops, ids.map((securityId) => ({ securityId, date }))).map((s, i) => [ids[i], s]));
		return (securityId: number) => shares.get(securityId) ?? 0;
	};
	return { history, splits, heldAt };
}

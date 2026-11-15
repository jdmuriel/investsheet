import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Operation } from '../engine/types.ts';
import { openDatabase } from './db.ts';

let db: DatabaseSync | null = null;

/** Base de datos de la aplicación, en `DATA_DIR` (por defecto `./data`). */
export function getDb(): DatabaseSync {
	db ??= openDatabase(join(process.env.DATA_DIR ?? 'data', 'invest.db'));
	return db;
}

export interface Portfolio {
	id: number;
	name: string;
}
export interface Account {
	id: number;
	code: string;
	name: string;
	currency: string;
}
/** Operación con los campos informativos que muestra el listado, además de sus efectos. */
export interface OperationRow extends Operation {
	description: string;
	ticker: string | null;
	accountCode: string | null;
	quantity: number | null;
	price: number | null;
	currency: string | null;
	fxRate: number | null;
}

export function listPortfolios(): Portfolio[] {
	return getDb().prepare('SELECT id, name FROM portfolio ORDER BY sort_order, id').all() as unknown as Portfolio[];
}

export function listAccounts(portfolioId: number): Account[] {
	return getDb().prepare('SELECT id, code, name, currency FROM account WHERE portfolio_id = ? ORDER BY sort_order, id').all(portfolioId) as unknown as Account[];
}

export function loadOperations(portfolioId: number): OperationRow[] {
	const d = getDb();
	const rows = d
		.prepare(
			`SELECT o.id, o.date, o.seq, o.type, o.security_id AS securityId, o.gross_eur AS grossEur, o.tax_eur AS taxEur, o.fees_eur AS feesEur,
				o.capital_in_eur AS capitalInEur, o.capital_out_eur AS capitalOutEur, o.purchase_eur AS purchaseEur,
				o.description, s.ticker, a.code AS accountCode, o.quantity, o.price, o.currency, o.fx_rate AS fxRate
			FROM operation o LEFT JOIN security s ON s.id = o.security_id LEFT JOIN account a ON a.id = o.account_id
			WHERE o.portfolio_id = ? ORDER BY o.date, o.seq, o.id`
		)
		.all(portfolioId) as unknown as OperationRow[];
	const byId = new Map<number, OperationRow>();
	for (const r of rows) {
		r.cash = [];
		r.positions = [];
		byId.set(r.id, r);
	}
	const cash = d.prepare('SELECT c.operation_id AS op, c.account_id AS accountId, c.amount FROM cash_leg c JOIN operation o ON o.id = c.operation_id WHERE o.portfolio_id = ?').all(portfolioId) as unknown as {
		op: number;
		accountId: number;
		amount: number;
	}[];
	for (const c of cash) byId.get(c.op)?.cash.push({ accountId: c.accountId, amount: c.amount });
	const legs = d
		.prepare(
			`SELECT l.operation_id AS op, l.security_id AS securityId, l.kind, l.shares, l.cost_eur AS cost, l.reduced_cost_eur AS reducedCost,
				l.proceeds_eur AS proceeds, l.to_security_id AS toSecurityId
			FROM position_leg l JOIN operation o ON o.id = l.operation_id WHERE o.portfolio_id = ? ORDER BY l.id`
		)
		.all(portfolioId) as unknown as ({ op: number } & Operation['positions'][number])[];
	for (const { op, ...leg } of legs) byId.get(op)?.positions.push({ ...leg, proceeds: leg.proceeds ?? undefined, toSecurityId: leg.toSecurityId ?? undefined });
	return rows;
}

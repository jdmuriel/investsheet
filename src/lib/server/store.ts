import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Operation } from '../engine/types.ts';
import { openDatabase } from './db.ts';
import { MIGRATIONS } from './migrations.ts';

const LATEST_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

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
	/** 1 si la cuenta está cerrada: no se ofrece para operaciones nuevas. */
	closed: number;
	/** 1 si es de un broker extranjero: sin retención española, la de los dividendos es en origen. */
	foreignBroker: number;
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
	/** Importe, impuestos y gastos en la moneda de la operación, si se registraron. */
	amountLocal: number | null;
	taxLocal: number | null;
	feesLocal: number | null;
}

export function listPortfolios(d: DatabaseSync = getDb()): Portfolio[] {
	return d.prepare('SELECT id, name FROM portfolio ORDER BY sort_order, id').all() as unknown as Portfolio[];
}

export function listAccounts(portfolioId: number, d: DatabaseSync = getDb()): Account[] {
	return d.prepare('SELECT id, code, name, currency, closed, foreign_broker AS foreignBroker FROM account WHERE portfolio_id = ? ORDER BY sort_order, id').all(portfolioId) as unknown as Account[];
}

export interface Security {
	id: number;
	ticker: string;
	name: string | null;
	currency: string | null;
	whtSourcePct: number | null;
	whtDestPct: number | null;
	/** 0 si el valor ya no se sigue: no se ofrece para operaciones nuevas salvo que haya posición. */
	active: number;
}

export function listSecurities(d: DatabaseSync = getDb()): Security[] {
	return d.prepare('SELECT id, ticker, name, currency, wht_source_pct AS whtSourcePct, wht_dest_pct AS whtDestPct, active FROM security ORDER BY ticker').all() as unknown as Security[];
}

export function loadOperations(portfolioId: number, d: DatabaseSync = getDb()): OperationRow[] {
	const rows = d
		.prepare(
			`SELECT o.id, o.date, o.seq, o.type, o.security_id AS securityId, o.gross_eur AS grossEur, o.tax_eur AS taxEur, o.fees_eur AS feesEur,
				o.capital_in_eur AS capitalInEur, o.capital_out_eur AS capitalOutEur, o.purchase_eur AS purchaseEur,
				o.description, s.ticker, a.code AS accountCode, o.quantity, o.price, o.currency, o.fx_rate AS fxRate,
				o.amount_local AS amountLocal, o.tax_local AS taxLocal, o.fees_local AS feesLocal
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

// ---------- Copia y restauración ----------

const dataDir = () => process.env.DATA_DIR ?? 'data';
const dbFile = () => join(dataDir(), 'invest.db');

/** Copia consistente de la base de datos en un único fichero, lista para descargar. */
export function exportDatabase(): Buffer {
	const tmp = join(dataDir(), `copia-${Date.now()}.tmp`);
	getDb().exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
	try {
		return readFileSync(tmp);
	} finally {
		rmSync(tmp, { force: true });
	}
}

export interface RestoreResult {
	portfolios: number;
	operations: number;
	previous: string;
}

/**
 * Sustituye la base de datos por la del fichero recibido. Antes la valida y guarda una copia
 * de la actual junto a ella (`invest.anterior-<fecha>.db`).
 */
export function restoreDatabase(data: Uint8Array): RestoreResult {
	const dir = dataDir();
	mkdirSync(dir, { recursive: true });
	const incoming = join(dir, `restaurar-${Date.now()}.tmp`);
	writeFileSync(incoming, data);
	let portfolios = 0;
	let operations = 0;
	try {
		const candidate = new DatabaseSync(incoming);
		try {
			const check = candidate.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
			if (check.integrity_check !== 'ok') throw new Error('el fichero está dañado');
			const version = (candidate.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
			if (version < 1 || version > LATEST_VERSION) throw new Error(`versión de esquema no admitida (${version})`);
			portfolios = (candidate.prepare('SELECT count(*) AS n FROM portfolio').get() as { n: number }).n;
			operations = (candidate.prepare('SELECT count(*) AS n FROM operation').get() as { n: number }).n;
		} finally {
			candidate.close();
		}
	} catch (e) {
		rmSync(incoming, { force: true });
		throw new Error(`No es una copia válida: ${e instanceof Error ? e.message : e}`);
	}

	const previous = `invest.anterior-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
	getDb().exec(`VACUUM INTO '${join(dir, previous).replaceAll("'", "''")}'`);
	getDb().close();
	db = null;
	for (const suffix of ['-wal', '-shm']) rmSync(dbFile() + suffix, { force: true });
	renameSync(incoming, dbFile());
	getDb();
	return { portfolios, operations, previous };
}

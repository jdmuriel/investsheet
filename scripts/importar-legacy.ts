/**
 * Importa la hoja de cálculo antigua a una base de datos SQLite y compara lo que calcula
 * el motor con lo que dice la hoja.
 *
 *   node scripts/importar-legacy.ts legacy/Inversión.xlsx data/invest.db
 *
 * El Excel, la base de datos y el informe contienen datos reales: no se versionan.
 */
import ExcelJS from 'exceljs';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOperation, emptyState, investedCapital, run, totalCost, totalReducedCost, totalShares } from '../src/lib/engine/engine.ts';
import { MICRO, type Operation, type PositionLeg, type State, type Warning } from '../src/lib/engine/types.ts';
import { openDatabase } from '../src/lib/server/db.ts';

type Cell = string | number | Date | null;
type Sheet = Cell[][]; // filas y columnas con índice 1, como en la hoja

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, 'legacy-config.json'), 'utf8')) as {
	currencyFixes: Record<string, string>;
	tickerAliases: Record<string, string>;
	overrides: { sheet: string; match: { date: string; ticker: string }; set: { date: string } }[];
};

// ---------- Lectura ----------

function plain(v: unknown): Cell {
	if (v == null) return null;
	if (v instanceof Date) return v;
	if (typeof v === 'object') {
		const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
		if ('result' in o) return plain(o.result);
		if (o.richText) return o.richText.map((t) => t.text).join('');
		if (o.error) return null;
		if (typeof o.text === 'string') return o.text;
		return null;
	}
	if (typeof v === 'string' || typeof v === 'number') return v;
	return null;
}

async function readSheets(path: string, wanted: (name: string) => boolean): Promise<Map<string, Sheet>> {
	const out = new Map<string, Sheet>();
	const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, { sharedStrings: 'cache', styles: 'cache', worksheets: 'emit', hyperlinks: 'ignore' } as never);
	for await (const ws of reader as AsyncIterable<{ name: string } & AsyncIterable<{ number: number; values: unknown[] }>>) {
		if (!wanted(ws.name)) {
			for await (const _ of ws) void _;
			continue;
		}
		const sheet: Sheet = [];
		for await (const row of ws) sheet[row.number] = (row.values as unknown[]).map(plain);
		out.set(ws.name, sheet);
	}
	return out;
}

// ---------- Utilidades ----------

const col = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const num = (v: Cell): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const cents = (v: Cell): number => Math.round(num(v) * 100);
const micro = (v: Cell): number => Math.round(num(v) * MICRO);
const text = (v: Cell): string => (v == null ? '' : String(v).trim());
const isoDate = (v: Cell): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : null);
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

function baseTicker(v: Cell): string {
	const t = text(v).toUpperCase().split(':').pop()!.trim();
	return config.tickerAliases[t] ?? t;
}
function currency(v: Cell): string | null {
	const c = text(v).toUpperCase();
	if (!c) return null;
	return config.currencyFixes[c] ?? c;
}

interface Row {
	rowNumber: number;
	date: string;
	description: string;
	type: string;
	ticker: string;
	quantity: number;
	price: number;
	currency: string | null;
	fx: number;
	account: string;
	cells: Cell[];
}

interface Draft {
	row: Row;
	op: Operation;
	accountCode: string | null;
	amountLocal: number | null;
	taxLocal: number | null;
	feesLocal: number | null;
	cashByCode: Map<string, number>;
	legs: (Omit<PositionLeg, 'securityId' | 'toSecurityId'> & { ticker: string; toTicker?: string })[];
}

interface PortfolioImport {
	name: string;
	sheetName: string;
	accounts: { code: string; currency: string }[];
	drafts: Draft[];
}

const report: string[] = [];
const say = (line = '') => report.push(line);

function readRows(sheetName: string, sheet: Sheet, c: { date: number; desc: number; type: number; ticker: number; qty: number; price: number; cur: number; fx: number; account: number }): Row[] {
	const rows: Row[] = [];
	for (let r = 10; r < sheet.length; r++) {
		const cells = sheet[r];
		if (!cells) continue;
		let date = isoDate(cells[c.date]);
		if (!date) continue;
		const ticker = baseTicker(cells[c.ticker]);
		for (const o of config.overrides) if (o.sheet === sheetName && o.match.date === date && o.match.ticker === ticker) date = o.set.date;
		rows.push({
			rowNumber: r,
			date,
			description: text(cells[c.desc]),
			type: text(cells[c.type]).toUpperCase() || (rows.length === 0 ? 'APERTURA' : 'CIERREANUAL'),
			ticker: text(cells[c.ticker]) ? ticker : '',
			quantity: num(cells[c.qty]),
			price: num(cells[c.price]),
			currency: currency(cells[c.cur]),
			fx: num(cells[c.fx]),
			account: text(cells[c.account]).toUpperCase(),
			cells
		});
	}
	return rows;
}

function baseOperation(row: Row, id: number, c: { gross: number; tax: number; fees: number; capIn: number; capOut: number; purchase: number }): Operation {
	return {
		id,
		date: row.date,
		seq: row.rowNumber,
		type: row.type,
		securityId: null,
		grossEur: cents(row.cells[c.gross]),
		taxEur: cents(row.cells[c.tax]),
		feesEur: cents(row.cells[c.fees]),
		capitalInEur: cents(row.cells[c.capIn]),
		capitalOutEur: cents(row.cells[c.capOut]),
		purchaseEur: cents(row.cells[c.purchase]),
		cash: [],
		positions: []
	};
}

/** Efecto en acciones deducido del tipo de operación, para registros sin columnas por valor. */
function legsFromFields(d: Draft): void {
	const { row, op } = d;
	if (!row.ticker || !row.quantity) return;
	const shares = Math.abs(micro(row.quantity));
	if (row.type === 'COMPRA') d.legs.push({ ticker: row.ticker, kind: 'buy', shares, cost: op.purchaseEur, reducedCost: op.purchaseEur });
	else if (row.type === 'VENTA') d.legs.push({ ticker: row.ticker, kind: 'sell', shares, cost: 0, reducedCost: 0, proceeds: -op.purchaseEur });
	else if (row.type === 'SPLIT' || row.type === 'SPINOFF') d.legs.push({ ticker: row.ticker, kind: 'adjust', shares, cost: op.purchaseEur, reducedCost: op.purchaseEur });
}

// ---------- Registro principal: efectos tomados de las columnas arrastradas ----------

function importMainLog(sheetName: string, sheet: Sheet, nextId: () => number): PortfolioImport {
	const header = sheet[9];
	const cashCols = [col('X'), col('Y'), col('Z'), col('AA')];
	const accountCodes = cashCols.map((c) => text(sheet[7][c]).toUpperCase());
	const accountCurrencies = cashCols.map((c) => currency(sheet[6][c]) ?? 'EUR');
	const costStart = col('AE');
	const reducedStart = col('CP');
	const sharesStart = col('HO');
	const nTickers = col('CM') - costStart + 1;
	const tickers = Array.from({ length: nTickers }, (_, i) => baseTicker(header[costStart + i]));

	const rows = readRows(sheetName, sheet, { date: col('C'), desc: col('D'), type: col('E'), ticker: col('F'), qty: col('G'), price: col('H'), cur: col('I'), fx: col('J'), account: col('K') });
	const untracked = new Map<string, number>();
	const notes: string[] = [];
	const drafts: Draft[] = [];
	let prev: Cell[] | null = null;
	for (const row of rows) {
		const op = baseOperation(row, nextId(), { gross: col('P'), tax: col('Q'), fees: col('R'), capIn: col('S'), capOut: col('T'), purchase: col('U') });
		const d: Draft = {
			row,
			op,
			accountCode: row.account || null,
			amountLocal: row.cells[col('L')] == null ? null : cents(row.cells[col('L')]),
			taxLocal: row.cells[col('M')] == null ? null : cents(row.cells[col('M')]),
			feesLocal: row.cells[col('N')] == null ? null : cents(row.cells[col('N')]),
			cashByCode: new Map(),
			legs: []
		};
		cashCols.forEach((c, i) => {
			const delta = cents(row.cells[c]) - (prev ? cents(prev[c]) : 0);
			if (delta !== 0) d.cashByCode.set(accountCodes[i], delta);
		});
		if (!prev) op.capitalInEur = cents(row.cells[col('V')]);

		let tracked = false;
		const deltas = tickers.map((ticker, i) => {
			const dShares = micro(row.cells[sharesStart + i]) - (prev ? micro(prev[sharesStart + i]) : 0);
			const dCost = cents(row.cells[costStart + i]) - (prev ? cents(prev[costStart + i]) : 0);
			const dReduced = cents(row.cells[reducedStart + i]) - (prev ? cents(prev[reducedStart + i]) : 0);
			if (ticker === row.ticker) tracked = true;
			return { ticker, dShares, dCost, dReduced };
		});
		const changed = deltas.filter((x) => x.dShares !== 0 || x.dCost !== 0 || x.dReduced !== 0);
		if (row.type === 'CONVERSION') {
			const target = changed.find((x) => x.dShares > 0);
			let moved = 0;
			for (const x of changed) {
				if (x.dShares < 0 && target) {
					d.legs.push({ ticker: x.ticker, kind: 'convert', shares: 0, cost: 0, reducedCost: 0, toTicker: target.ticker });
					moved += -x.dShares;
				}
			}
			if (target && target.dShares !== moved) d.legs.push({ ticker: target.ticker, kind: 'adjust', shares: target.dShares - moved, cost: 0, reducedCost: 0 });
		} else {
			for (const x of changed) {
				if (row.type === 'VENTA' && x.dShares < 0) d.legs.push({ ticker: x.ticker, kind: 'sell', shares: -x.dShares, cost: 0, reducedCost: 0, proceeds: -op.purchaseEur });
				else if ((row.type === 'COMPRA' || row.type === 'APERTURA') && x.dShares > 0) d.legs.push({ ticker: x.ticker, kind: 'buy', shares: x.dShares, cost: x.dCost, reducedCost: x.dReduced });
				else if (x.dShares < 0 && x.dShares === -(prev ? micro(prev[sharesStart + tickers.indexOf(x.ticker)]) : 0) && row.type !== 'SPLIT')
					// La posición queda a cero sin ser una venta registrada como tal: se da de baja entera.
					d.legs.push({ ticker: x.ticker, kind: 'sell', shares: -x.dShares, cost: 0, reducedCost: 0, proceeds: 0 });
				else d.legs.push({ ticker: x.ticker, kind: 'adjust', shares: x.dShares, cost: x.dCost, reducedCost: x.dReduced });
			}
		}
		if (!tracked && row.ticker) {
			legsFromFields(d);
			// Valores sin columna propia (spin-offs vendidos al recibirlos): se da de alta a coste cero lo que falte.
			const held = untracked.get(row.ticker) ?? 0;
			const sell = d.legs.find((l) => l.kind === 'sell');
			if (sell && sell.shares > held) {
				d.legs.unshift({ ticker: row.ticker, kind: 'adjust', shares: sell.shares - held, cost: 0, reducedCost: 0 });
				untracked.set(row.ticker, 0);
			} else untracked.set(row.ticker, held + d.legs.reduce((n, l) => n + (l.kind === 'sell' ? -l.shares : l.shares), 0));
		}
		// Resultado anotado a mano sin desglose (pérdidas de un fondo monetario): se registra como renta negativa.
		const manual = cents(row.cells[col('O')]);
		if (manual !== 0 && op.grossEur === 0 && op.taxEur === 0 && op.feesEur === 0) {
			op.grossEur = manual;
			notes.push(`fila ${row.rowNumber} (${row.date}): resultado manual de ${manual / 100} € sin desglose, importado como renta`);
		}
		prev = row.cells;
		// Las filas sin tipo ni efecto son marcas de fin de año o de trimestre.
		if (row.type === 'CIERREANUAL' && d.cashByCode.size === 0 && d.legs.length === 0 && op.grossEur === 0) continue;
		drafts.push(d);
	}
	say('### Notas de la importación del registro principal');
	say();
	for (const n of notes) say(`- ${n}`);
	say();
	return { name: 'Principal', sheetName, accounts: accountCodes.map((code, i) => ({ code, currency: accountCurrencies[i] })), drafts };
}

// ---------- Registros secundarios: efectos deducidos de los campos ----------

function importChildLog(sheetName: string, sheet: Sheet, nextId: () => number): PortfolioImport {
	const cashCols = [col('V'), col('W'), col('X')].filter((c) => text(sheet[7][c]) && !text(sheet[7][c]).startsWith('='));
	const accountCodes = cashCols.map((c) => text(sheet[7][c]).toUpperCase());
	const rows = readRows(sheetName, sheet, { date: col('C'), desc: col('D'), type: col('E'), ticker: col('F'), qty: col('G'), price: col('H'), cur: col('I'), fx: col('J'), account: col('K') });
	const drafts: Draft[] = [];
	let prev: Cell[] | null = null;
	for (const row of rows) {
		const op = baseOperation(row, nextId(), { gross: col('M'), tax: col('N'), fees: col('O'), capIn: col('P'), capOut: col('Q'), purchase: col('R') });
		const d: Draft = { row, op, accountCode: row.account || null, amountLocal: null, taxLocal: null, feesLocal: null, cashByCode: new Map(), legs: [] };
		cashCols.forEach((c, i) => {
			const delta = cents(row.cells[c]) - (prev ? cents(prev[c]) : 0);
			if (delta !== 0) d.cashByCode.set(accountCodes[i], delta);
		});
		legsFromFields(d);
		prev = row.cells;
		if (row.type === 'CIERREANUAL' && d.cashByCode.size === 0 && op.grossEur === 0) continue;
		drafts.push(d);
	}
	return { name: sheetName.replace(/^Log/, ''), sheetName, accounts: accountCodes.map((code) => ({ code, currency: 'EUR' })), drafts };
}

// ---------- Traspasos anotados como venta y recompra ----------

function pairTransfers(p: PortfolioImport): void {
	const sells = p.drafts.filter((d) => d.row.type === 'VENTA' && d.row.ticker);
	const buys = p.drafts.filter((d) => d.row.type === 'COMPRA' && d.row.ticker);
	const remaining = new Map<Draft, number>(buys.map((b) => [b, Math.abs(micro(b.row.quantity))]));
	say(`### Traspasos detectados en «${p.name}»`);
	say();
	say('| Fecha | Valor | Vendidas | Recompradas | Tratamiento |');
	say('|---|---|---|---|---|');
	for (const s of sells) {
		const qty = Math.abs(micro(s.row.quantity));
		const mentionsTransfer = /rasp|rr[oó]ne/i.test(s.row.description);
		const candidates = buys
			.filter((b) => b.row.ticker === s.row.ticker && (remaining.get(b) ?? 0) > 0)
			.map((b) => ({ b, gap: daysBetween(b.row.date, s.row.date) }))
			.filter((x) => x.gap === 0 || (mentionsTransfer && x.gap <= 7))
			.sort((x, y) => Number(remaining.get(y.b) === qty) - Number(remaining.get(x.b) === qty) || x.gap - y.gap || Number(/rasp|rr[oó]ne/i.test(y.b.row.description)) - Number(/rasp|rr[oó]ne/i.test(x.b.row.description)));
		const match = candidates[0]?.b;
		if (!match) continue;
		const moved = Math.min(qty, remaining.get(match)!);
		remaining.set(match, remaining.get(match)! - moved);
		// La venta deja de dar de baja las acciones traspasadas.
		const sellLeg = s.legs.find((l) => l.kind === 'sell');
		const buyLeg = match.legs.find((l) => l.kind === 'buy');
		if (sellLeg && buyLeg && sellLeg.ticker !== buyLeg.ticker) {
			// Mismo valor en otro mercado: los lotes pasan de una columna a otra.
			s.legs = s.legs.filter((l) => l !== sellLeg);
			s.legs.push({ ticker: sellLeg.ticker, kind: 'convert', shares: 0, cost: 0, reducedCost: 0, toTicker: buyLeg.ticker });
			match.legs = match.legs.filter((l) => l !== buyLeg);
		} else {
			if (sellLeg) {
				sellLeg.shares -= moved;
				if (sellLeg.shares <= 0) s.legs = s.legs.filter((l) => l !== sellLeg);
			}
			if (buyLeg) {
				// Solo queda como compra el exceso sobre lo traspasado, con su parte proporcional del coste.
				const total = buyLeg.shares;
				const rest = total - moved;
				buyLeg.cost = Math.round((buyLeg.cost * rest) / total);
				buyLeg.reducedCost = Math.round((buyLeg.reducedCost * rest) / total);
				buyLeg.shares = rest;
				if (rest <= 0) match.legs = match.legs.filter((l) => l !== buyLeg);
			}
		}
		s.op.type = 'TRASPASOVALORES';
		if (micro(match.row.quantity) === moved || !match.legs.some((l) => l.kind === 'buy')) match.op.type = 'TRASPASOVALORES';
		const extra = micro(match.row.quantity) - moved;
		say(`| ${s.row.date} | ${s.row.ticker} | ${qty / MICRO} | ${micro(match.row.quantity) / MICRO} (${match.row.date}) | traspaso de ${moved / MICRO}${extra > 0 && remaining.get(match) === extra ? `; el resto de la compra puede ser nuevo` : ''} |`);
	}
	say();
}

// ---------- Programa ----------

const [, , xlsxPath, dbPath = 'data/invest.db'] = process.argv;
if (!xlsxPath) {
	console.error('Uso: node scripts/importar-legacy.ts <hoja.xlsx> [base.db]');
	process.exit(1);
}

const sheets = await readSheets(xlsxPath, (n) => n.startsWith('Log') || n === 'Control cartera');
let idCounter = 0;
const nextId = () => ++idCounter;

const portfolios: PortfolioImport[] = [];
for (const [name, sheet] of sheets) {
	if (name === 'Log') portfolios.unshift(importMainLog(name, sheet, nextId));
	else if (name.startsWith('Log')) portfolios.push(importChildLog(name, sheet, nextId));
}

say('# Informe de importación');
say();
say('Generado por `scripts/importar-legacy.ts`. Contiene datos reales: no versionar.');
say();

// Datos maestros de valores, desde «Control cartera».
interface SecurityInfo {
	ticker: string;
	priceTicker?: string;
	country?: string;
	currency?: string;
	sector?: string;
	supersector?: string;
	whtSource?: number;
	whtDest?: number;
	reinvest?: boolean;
}
const securities = new Map<string, SecurityInfo>();
const cc = sheets.get('Control cartera');
if (cc) {
	const label = (r: number) => text(cc[r]?.[1]).toLowerCase();
	const rowOf = (prefix: string) => cc.findIndex((_, r) => r > 0 && label(r).startsWith(prefix));
	const rCurrency = rowOf('moneda');
	const rSource = rowOf('retención origen');
	const rDest = rowOf('retención destino');
	const rReinvest = rowOf('reinvertir');
	const rSector = rowOf('sector');
	for (let c = 3; c < cc[1].length; c++) {
		const priceTicker = text(cc[1][c]);
		if (!priceTicker || priceTicker.endsWith(':')) continue;
		const ticker = baseTicker(priceTicker);
		if (securities.has(ticker)) continue;
		securities.set(ticker, {
			ticker,
			priceTicker,
			country: text(cc[2][c]) || undefined,
			currency: currency(cc[rCurrency]?.[c]) ?? undefined,
			sector: text(cc[rSector]?.[c]) || undefined,
			supersector: text(cc[rSector + 1]?.[c]) || undefined,
			whtSource: typeof cc[rSource]?.[c] === 'number' ? (cc[rSource][c] as number) : undefined,
			whtDest: typeof cc[rDest]?.[c] === 'number' ? (cc[rDest][c] as number) : undefined,
			reinvest: !/^no/i.test(text(cc[rReinvest]?.[c]))
		});
	}
}
for (const p of portfolios) for (const d of p.drafts) for (const t of [d.row.ticker, ...d.legs.flatMap((l) => [l.ticker, l.toTicker ?? ''])]) if (t && !securities.has(t)) securities.set(t, { ticker: t });

for (const p of portfolios) pairTransfers(p);

// Opciones: la hoja anota la prima como compra; aquí es renta del año, negativa si se pagó (igual que la migración 3).
for (const p of portfolios)
	for (const { op } of p.drafts)
		if (op.type === 'VENTAPUT' || op.type === 'COMPRACALL') {
			op.type = op.type === 'VENTAPUT' ? 'VENTAOPCION' : 'COMPRAOPCION';
			op.grossEur -= op.purchaseEur;
			op.purchaseEur = 0;
		}

// Escritura
if (existsSync(dbPath)) for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
const db = openDatabase(dbPath);
db.exec('BEGIN');
const securityId = new Map<string, number>();
const insSecurity = db.prepare('INSERT INTO security (ticker, price_ticker, country, currency, sector, supersector, wht_source_pct, wht_dest_pct, reinvest) VALUES (?,?,?,?,?,?,?,?,?)');
for (const s of securities.values()) {
	const r = insSecurity.run(s.ticker, s.priceTicker ?? null, s.country ?? null, s.currency ?? null, s.sector ?? null, s.supersector ?? null, s.whtSource ?? null, s.whtDest ?? null, s.reinvest === false ? 0 : 1);
	securityId.set(s.ticker, Number(r.lastInsertRowid));
}
const insPortfolio = db.prepare('INSERT INTO portfolio (name, sort_order) VALUES (?,?)');
const insAccount = db.prepare('INSERT INTO account (portfolio_id, code, name, currency, sort_order) VALUES (?,?,?,?,?)');
const insOp = db.prepare(`INSERT INTO operation (id, portfolio_id, date, seq, type, account_id, security_id, quantity, price, currency, fx_rate,
	amount_local, tax_local, fees_local, gross_eur, tax_eur, fees_eur, capital_in_eur, capital_out_eur, purchase_eur, description, source, legacy_ref)
	VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insCash = db.prepare('INSERT INTO cash_leg (operation_id, account_id, amount) VALUES (?,?,?)');
const insLeg = db.prepare('INSERT INTO position_leg (operation_id, security_id, kind, shares, cost_eur, reduced_cost_eur, proceeds_eur, to_security_id) VALUES (?,?,?,?,?,?,?,?)');

const summaries: string[] = [];
portfolios.forEach((p, index) => {
	const portfolioId = Number(insPortfolio.run(p.name, index).lastInsertRowid);
	const accountId = new Map<string, number>();
	p.accounts.forEach((a, i) => accountId.set(a.code, Number(insAccount.run(portfolioId, a.code, a.code, a.currency, i).lastInsertRowid)));

	const unknownAccounts = new Set<string>();
	const outOfOrder: string[] = [];
	let lastDate = '';
	for (const d of p.drafts) {
		const { op, row } = d;
		op.securityId = row.ticker ? (securityId.get(row.ticker) ?? null) : null;
		op.cash = [...d.cashByCode].map(([code, amount]) => ({ accountId: accountId.get(code)!, amount }));
		op.positions = d.legs.map((l) => ({ securityId: securityId.get(l.ticker)!, kind: l.kind, shares: l.shares, cost: l.cost, reducedCost: l.reducedCost, proceeds: l.proceeds, toSecurityId: l.toTicker ? securityId.get(l.toTicker) : undefined }));
		if (d.accountCode && !accountId.has(d.accountCode)) unknownAccounts.add(d.accountCode);
		if (row.date < lastDate) outOfOrder.push(`fila ${row.rowNumber}: ${row.date} después de ${lastDate} (${row.description.slice(0, 60)})`);
		lastDate = row.date > lastDate ? row.date : lastDate;
		insOp.run(op.id, portfolioId, op.date, op.seq, op.type, d.accountCode ? (accountId.get(d.accountCode) ?? null) : null, op.securityId ?? null, row.quantity || null, row.price || null, row.currency, row.fx || null,
			d.amountLocal, d.taxLocal, d.feesLocal, op.grossEur, op.taxEur, op.feesEur, op.capitalInEur, op.capitalOutEur, op.purchaseEur, row.description, 'legacy', `${p.sheetName}!${row.rowNumber}`);
		for (const leg of op.cash) insCash.run(op.id, leg.accountId, leg.amount);
		for (const leg of op.positions) insLeg.run(op.id, leg.securityId, leg.kind, leg.shares, leg.cost, leg.reducedCost, leg.proceeds ?? null, leg.toSecurityId ?? null);
	}

	// ---- Validación contra la hoja ----
	say(`## Cartera «${p.name}» (${p.drafts.length} operaciones)`);
	say();
	if (unknownAccounts.size) say(`- Cuentas citadas en operaciones que no tienen columna de saldo: ${[...unknownAccounts].join(', ')}`);
	say(`- Fechas fuera de orden: ${outOfOrder.length}`);
	for (const line of outOfOrder) say(`  - ${line}`);

	const sheet = sheets.get(p.sheetName)!;
	const main = p.sheetName === 'Log';
	const cCapital = main ? col('V') : col('S');
	const cYear = main ? col('W') : col('T');
	const warnings: Warning[] = [];
	const state: State = emptyState();
	let capitalDiffs = 0;
	const capitalDiffValues = new Map<number, number>();
	let yearDiffs = 0;
	const yearDiffRows: string[] = [];
	const idByTicker = securityId;
	const tickerById = new Map([...idByTicker].map(([t, id]) => [id, t]));
	const sharesDiffs = new Map<string, number>();
	const header = sheet[9];
	const sharesStart = col('HO');
	const costStart = col('AE');
	const nTickers = col('CM') - costStart + 1;
	for (const d of p.drafts) {
		applyOperation(state, d.op, warnings);
		const cells = d.row.cells;
		// El registro principal capitaliza el resultado de cada año cerrado; los secundarios no.
		const capitalDiff = (main ? investedCapital(state) : state.capital) - cents(cells[cCapital]);
		if (capitalDiff !== 0) {
			capitalDiffs++;
			capitalDiffValues.set(capitalDiff, (capitalDiffValues.get(capitalDiff) ?? 0) + 1);
		}
		if (state.yearResult !== cents(cells[cYear])) {
			yearDiffs++;
			if (yearDiffRows.length < 8) yearDiffRows.push(`fila ${d.row.rowNumber} (${d.row.date}): motor ${state.yearResult / 100}, hoja ${num(cells[cYear])}`);
		}
		if (main) {
			for (let i = 0; i < nTickers; i++) {
				const t = baseTicker(header[costStart + i]);
				if (totalShares(state.positions.get(idByTicker.get(t)!)) !== micro(cells[sharesStart + i])) sharesDiffs.set(t, (sharesDiffs.get(t) ?? 0) + 1);
			}
		}
	}
	say(`- Filas donde el capital invertido no coincide con la hoja: ${capitalDiffs}${capitalDiffs ? ' (diferencia en € × nº de filas: ' + [...capitalDiffValues].map(([v, n]) => `${v / 100} × ${n}`).join('; ') + ')' : ''}`);
	say(`- Filas donde las ganancias acumuladas del año no coinciden: ${yearDiffs}`);
	for (const line of yearDiffRows) say(`  - ${line}`);
	say(`- Avisos del motor: ${warnings.length}`);
	for (const w of warnings.slice(0, 20)) {
		const d = p.drafts.find((x) => x.op.id === w.operationId)!;
		say(`  - fila ${d.row.rowNumber} (${d.row.date}, ${d.row.ticker}): ${w.message}`);
	}
	// El recorrido ordenado por fecha debe dar el mismo estado final que el orden de la hoja.
	const sorted = run(p.drafts.map((d) => d.op)).state;
	const sameFinal = [...state.cash].every(([k, v]) => sorted.cash.get(k) === v) && state.capital === sorted.capital;
	say(`- Estado final igual recorriendo por fecha que en el orden de la hoja: ${sameFinal ? 'sí' : 'NO'}`);
	say();

	const last = p.drafts[p.drafts.length - 1].row.cells;
	say('| Valor | Acciones | Coste hoja | Coste FIFO | Diferencia | Coste reducido hoja | Coste reducido FIFO | Lotes |');
	say('|---|---|---|---|---|---|---|---|');
	let costDiffTickers: string[] = [];
	if (main) {
		const reducedStart = col('CP');
		for (let i = 0; i < nTickers; i++) {
			const t = baseTicker(header[costStart + i]);
			const pos = state.positions.get(idByTicker.get(t)!);
			const shares = totalShares(pos);
			const sheetCost = cents(last[costStart + i]);
			const diff = totalCost(pos) - sheetCost;
			if (shares === 0 && sheetCost === 0 && diff === 0) continue;
			if (Math.abs(diff) > 1 || sharesDiffs.has(t)) costDiffTickers.push(t);
			say(`| ${t} | ${shares / MICRO}${sharesDiffs.has(t) ? ` (≠ hoja en ${sharesDiffs.get(t)} filas)` : ''} | ${sheetCost / 100} | ${totalCost(pos) / 100} | ${diff / 100} | ${cents(last[reducedStart + i]) / 100} | ${totalReducedCost(pos) / 100} | ${pos?.lots.length ?? 0} |`);
		}
	} else {
		for (const [id, pos] of state.positions) {
			const shares = totalShares(pos);
			if (shares === 0 && totalCost(pos) === 0) continue;
			say(`| ${tickerById.get(id)} | ${shares / MICRO} | – | ${totalCost(pos) / 100} | – | – | ${totalReducedCost(pos) / 100} | ${pos.lots.length} |`);
		}
	}
	say();
	const cashOk = p.accounts.every((a, i) => (state.cash.get(accountId.get(a.code)!) ?? 0) === cents(last[(main ? [col('X'), col('Y'), col('Z'), col('AA')] : [col('V'), col('W'), col('X')])[i]]));
	summaries.push(
		`${p.name}: ${p.drafts.length} operaciones; saldos finales ${cashOk ? 'OK' : 'DIFIEREN'}; capital ≠ en ${capitalDiffs} filas; ganancias año ≠ en ${yearDiffs} filas; ` +
			`fechas fuera de orden ${outOfOrder.length}; avisos ${warnings.length}; valores con acciones ≠ hoja: ${[...sharesDiffs.keys()].join(', ') || 'ninguno'}; valores con coste ≠ hoja: ${costDiffTickers.join(', ') || (main ? 'ninguno' : 'n/d')}`
	);
});
db.exec('COMMIT');
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

const reportPath = join(dirname(dbPath), 'informe-importacion.md');
writeFileSync(reportPath, report.join('\n') + '\n');
console.log(summaries.join('\n'));
console.log(`Valores: ${securities.size}. Base de datos: ${dbPath}. Informe: ${reportPath}`);

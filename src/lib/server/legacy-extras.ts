/**
 * Datos de la hoja antigua que no son operaciones: objetivos del año (cabecera de cada registro),
 * precios, tipos de cambio y calendario de dividendos (`Control cartera`) y cambios de dividendo (`Variación divs`).
 * Los usa el importador y, para completar una base de datos ya en uso, Ajustes → «Importar datos de la hoja».
 */
import type { DatabaseSync } from 'node:sqlite';
import config from '../../../scripts/legacy-config.json' with { type: 'json' };
import type { Goals } from '../engine/goals.ts';
import { goalsFromReference, type SheetCell, type SheetRows } from '../engine/log-export.ts';
import { readSheets } from './legacy-sheet.ts';

const aliases: Record<string, string> = config.tickerAliases;
const text = (v: SheetCell | undefined) => (v == null ? '' : String(v).trim());
const number = (v: SheetCell | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const baseTicker = (label: string) => {
	const t = label.toUpperCase().split(':').pop()!.trim();
	return aliases[t] ?? t;
};

export interface SheetSecurity {
	ticker: string;
	currency: string | null;
	/** Precio en unidades de la moneda y cambio en unidades por euro (lo que la hoja da en peniques, ya en libras). */
	price: number | null;
	fxRate: number | null;
	/** Dividendo por acción previsto de enero a diciembre; `null` si la hoja no prevé ninguno. */
	months: number[] | null;
}

export interface SheetChange {
	date: string;
	ticker: string;
	oldAnnual: number;
	newAnnual: number;
	currency: string;
	/** Unidades de la moneda por euro (la hoja lo anota al revés). */
	fxRate: number;
	url: string | null;
	note: string | null;
}

export interface SheetExtras {
	securities: SheetSecurity[];
	changes: SheetChange[];
	/** Objetivos de la cabecera de cada registro, por nombre de solapa. */
	goals: { sheet: string; goals: Goals }[];
}

/** Columnas de valores de `Control cartera`: precio, cambio y calendario de dividendos de cada uno. */
export function parseControlCartera(cc: SheetRows): SheetSecurity[] {
	const label = (r: number) => text(cc[r]?.[1]).toLowerCase();
	const rowOf = (prefix: string) => cc.findIndex((_, r) => r > 0 && label(r).startsWith(prefix));
	const rShares = rowOf('nº acciones');
	const rCurrency = rowOf('moneda');
	const rFx = rowOf('moneda - cambio');
	const rPrice = rowOf('precio actual');
	const rSchedule = rowOf('dividendos futuros');
	const found = new Map<string, SheetSecurity & { held: boolean }>();
	for (let c = 3; c < (cc[1]?.length ?? 0); c++) {
		const priceTicker = typeof cc[1][c] === 'string' ? text(cc[1][c]) : '';
		if (!/^[A-Z0-9.]+(:[A-Z0-9.]+)?$/i.test(priceTicker)) continue;
		const ticker = baseTicker(priceTicker);
		const held = (number(cc[rShares]?.[c]) ?? 0) > 0;
		// Un mismo valor puede tener dos columnas (cambió de mercado): manda la que tiene posición.
		if (found.has(ticker) && (found.get(ticker)!.held || !held)) continue;
		const raw = text(cc[rCurrency]?.[c]).toUpperCase();
		const pence = raw === 'GBX';
		const unit = pence ? 100 : 1;
		const currency = (pence ? 'GBP' : ((config.currencyFixes as Record<string, string>)[raw] ?? raw)) || null;
		const price = rPrice > 0 ? number(cc[rPrice][c]) : null;
		const fx = rFx > 0 ? number(cc[rFx][c]) : null;
		const months = rSchedule > 0 ? Array.from({ length: 12 }, (_, m) => Math.round(((number(cc[rSchedule + m]?.[c]) ?? 0) / unit) * 1e8) / 1e8) : [];
		found.set(ticker, { ticker, currency, price: price && price > 0 ? price / unit : null, fxRate: fx && fx > 0 ? fx / unit : null, months: months.some((m) => m > 0) ? months : null, held });
	}
	return [...found.values()].map(({ held: _held, ...s }) => s);
}

/** Filas de `Variación divs`: una por cambio de dividendo. */
export function parseDividendChanges(sheet: SheetRows): SheetChange[] {
	const out: SheetChange[] = [];
	for (let r = 2; r < sheet.length; r++) {
		const row = sheet[r];
		if (!row) continue;
		const date = row[1] instanceof Date ? row[1].toISOString().slice(0, 10) : null;
		const oldAnnual = number(row[3]);
		const newAnnual = number(row[4]);
		const currency = text(row[7]).toUpperCase();
		const eurPerUnit = number(row[9]);
		if (!date || !text(row[2]) || oldAnnual == null || newAnnual == null || !/^[A-Z]{3}$/.test(currency)) continue;
		out.push({ date, ticker: baseTicker(text(row[2])), oldAnnual, newAnnual, currency, fxRate: currency === 'EUR' || !eurPerUnit ? 1 : Math.round((1 / eurPerUnit) * 1e6) / 1e6, url: text(row[13]) || null, note: text(row[12]) || null });
	}
	return out;
}

export function extrasFromSheets(sheets: Map<string, SheetRows>): SheetExtras {
	const cc = sheets.get('Control cartera');
	const vd = sheets.get('Variación divs');
	return {
		securities: cc ? parseControlCartera(cc) : [],
		changes: vd ? parseDividendChanges(vd) : [],
		goals: [...sheets].filter(([name]) => name.startsWith('Log')).map(([name, sheet]) => ({ sheet: name, goals: goalsFromReference(sheet, name === 'Log') }))
	};
}

/** Lee del libro solo lo necesario: de los registros, la cabecera. */
export async function readExtras(path: string): Promise<SheetExtras> {
	const sheets = await readSheets(path, (n) => n.startsWith('Log') || n === 'Control cartera' || n === 'Variación divs', (n) => (n.startsWith('Log') ? 9 : n === 'Control cartera' ? 62 : Infinity));
	return extrasFromSheets(sheets);
}

export interface ExtrasSummary {
	prices: number;
	fxRates: number;
	schedules: number;
	changes: number;
	goals: number;
	/** Tickers de la hoja sin valor en la aplicación. */
	unknown: string[];
}

/**
 * Vuelca los datos en la base **sin pisar nada**: solo añade precios y cambios a quien no tenga uno más reciente,
 * calendario a los valores que no tienen ninguno, cambios de dividendo si aún no hay ninguno anotado
 * y objetivos a las carteras que no los tienen ese año. Se puede repetir sin riesgo.
 * `date` es la fecha a la que corresponden los precios de la hoja.
 */
export function applyExtras(db: DatabaseSync, extras: SheetExtras, date: string): ExtrasSummary {
	const summary: ExtrasSummary = { prices: 0, fxRates: 0, schedules: 0, changes: 0, goals: 0, unknown: [] };
	const ids = new Map((db.prepare('SELECT id, ticker FROM security').all() as { id: number; ticker: string }[]).map((s) => [s.ticker, s.id]));
	const unknown = new Set<string>();
	db.exec('BEGIN IMMEDIATE');
	try {
		const hasPrice = db.prepare('SELECT 1 FROM price WHERE security_id = ? AND date >= ?');
		const insPrice = db.prepare(`INSERT INTO price (security_id, date, price, currency, source) VALUES (?,?,?,?,'legacy')`);
		const hasFx = db.prepare('SELECT 1 FROM fx_rate WHERE currency = ? AND date >= ?');
		const insFx = db.prepare(`INSERT INTO fx_rate (currency, date, rate, source) VALUES (?,?,?,'legacy')`);
		const hasSchedule = db.prepare('SELECT 1 FROM dividend_schedule WHERE security_id = ?');
		const insSchedule = db.prepare('INSERT INTO dividend_schedule (security_id, valid_from, currency, months_json) VALUES (?,?,?,?)');
		for (const s of extras.securities) {
			const id = ids.get(s.ticker);
			if (id == null) {
				if (s.price != null || s.months) unknown.add(s.ticker);
				continue;
			}
			if (!s.currency) continue;
			if (s.price != null && !hasPrice.get(id, date)) {
				insPrice.run(id, date, s.price, s.currency);
				summary.prices++;
			}
			if (s.currency !== 'EUR' && s.fxRate != null && !hasFx.get(s.currency, date)) {
				insFx.run(s.currency, date, s.fxRate);
				summary.fxRates++;
			}
			if (s.months && !hasSchedule.get(id)) {
				insSchedule.run(id, date, s.currency, JSON.stringify(s.months));
				summary.schedules++;
			}
		}

		if ((db.prepare('SELECT count(*) AS n FROM dividend_change').get() as { n: number }).n === 0) {
			const insChange = db.prepare('INSERT INTO dividend_change (security_id, date, old_annual, new_annual, currency, fx_rate, url, note) VALUES (?,?,?,?,?,?,?,?)');
			for (const c of extras.changes) {
				const id = ids.get(c.ticker);
				if (id == null) {
					unknown.add(c.ticker);
					continue;
				}
				insChange.run(id, c.date, c.oldAnnual, c.newAnnual, c.currency, c.fxRate, c.url, c.note);
				summary.changes++;
			}
		}

		// La solapa `Log` es la primera cartera; las demás se llaman como su solapa sin el prefijo.
		const portfolios = db.prepare('SELECT id, name FROM portfolio ORDER BY sort_order, id').all() as { id: number; name: string }[];
		const year = Number(date.slice(0, 4));
		const hasGoals = db.prepare('SELECT 1 FROM goal WHERE portfolio_id = ? AND year = ?');
		const insGoal = db.prepare('INSERT INTO goal (portfolio_id, year, metric, amount_eur) VALUES (?,?,?,?)');
		for (const g of extras.goals) {
			const portfolio = g.sheet === 'Log' ? portfolios[0] : portfolios.find((p) => p.name === g.sheet.replace(/^Log/, ''));
			if (!portfolio || hasGoals.get(portfolio.id, year)) continue;
			for (const [metric, amount] of Object.entries(g.goals)) {
				insGoal.run(portfolio.id, year, metric, amount);
				summary.goals++;
			}
		}
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
	summary.unknown = [...unknown].sort();
	return summary;
}

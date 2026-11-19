/**
 * Datos de la hoja antigua que no son operaciones: objetivos del año (cabecera de cada registro),
 * precios, tipos de cambio, calendario de dividendos y orden de los valores (`Control cartera`), cambios de dividendo
 * (`Variación divs`) y la selección mensual con su histórico de revisiones (`Selección`).
 * Los usa el importador y, para completar una base de datos ya en uso, Ajustes → «Importar datos de la hoja».
 */
import type { DatabaseSync } from 'node:sqlite';
import config from '../../../scripts/legacy-config.json' with { type: 'json' };
import type { Goals } from '../engine/goals.ts';
import { DEFAULT_PARAMS, type SelectionParams } from '../engine/selection.ts';
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

/** Un valor de `Selección`, en el orden de la hoja. Precios en la moneda del valor (los de Londres, ya en libras). */
export interface SheetSelectionEntry {
	ticker: string;
	priceTicker: string;
	/** Columna «País» de la hoja (ES, US, UK, AMS…). */
	country: string;
	zone: string;
	tier: string | null;
	currency: string | null;
	price: number | null;
	target: number | null;
	/** Dividendo anual por acción, de la RPD y el precio de la hoja. */
	dividendEstimate: number | null;
}

export interface SheetSelection {
	params: SelectionParams;
	entries: SheetSelectionEntry[];
	/** Revisiones mensuales: fecha y precio de cada valor ese día. */
	reviews: { date: string; prices: Map<string, number> }[];
}

export interface SheetExtras {
	securities: SheetSecurity[];
	changes: SheetChange[];
	selection: SheetSelection | null;
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

const MARKET_CURRENCY: Record<string, string> = { BME: 'EUR', AMS: 'EUR', EPA: 'EUR', ETR: 'EUR', BIT: 'EUR', EBR: 'EUR', ELI: 'EUR', LON: 'GBP', CPH: 'DKK', STO: 'SEK', OSL: 'NOK', SWX: 'CHF', TSE: 'CAD' };
const zoneOf = (country: string) => (country === 'ES' ? 'España' : country === 'US' ? 'EE. UU.' : 'Resto del mundo');

/**
 * Solapa `Selección`: parámetros (fila 3), una fila por valor desde la 5 agrupadas en listas, y a la derecha
 * una columna por revisión mensual con su fecha en la cabecera (fila 4) y el precio de cada valor ese día.
 */
export function parseSeleccion(sheet: SheetRows): SheetSelection {
	const p = sheet[3] ?? [];
	const n = (c: number) => number(p[c]);
	const params: SelectionParams = {
		limits: {
			T1: { other: n(3) ?? DEFAULT_PARAMS.limits.T1.other, spain: n(4) ?? DEFAULT_PARAMS.limits.T1.spain },
			T2: { other: n(5) ?? DEFAULT_PARAMS.limits.T2.other, spain: n(6) ?? DEFAULT_PARAMS.limits.T2.spain },
			T3: { other: n(7) ?? DEFAULT_PARAMS.limits.T3.other, spain: n(8) ?? DEFAULT_PARAMS.limits.T3.spain }
		},
		significant: n(10) ?? DEFAULT_PARAMS.significant,
		high: n(11) ?? DEFAULT_PARAMS.high
	};
	const header = sheet[4] ?? [];
	const reviewColumns: { col: number; date: string }[] = [];
	for (let c = 13; c < header.length; c++) {
		const m = /(\d{4}-\d{2}-\d{2})/.exec(text(header[c]));
		if (m) reviewColumns.push({ col: c, date: m[1] });
	}
	const entries: SheetSelectionEntry[] = [];
	const reviews = reviewColumns.map((r) => ({ date: r.date, prices: new Map<string, number>() }));
	const seen = new Set<string>();
	for (let r = 5; r < sheet.length; r++) {
		const row = sheet[r];
		const priceTicker = text(row?.[2]).toUpperCase();
		if (!row || !/^[A-Z0-9.-]+(:[A-Z0-9.-]+)?$/.test(priceTicker)) continue;
		const ticker = baseTicker(priceTicker);
		if (seen.has(ticker)) continue;
		seen.add(ticker);
		const market = priceTicker.includes(':') ? priceTicker.split(':')[0] : '';
		const unit = market === 'LON' ? 100 : 1;
		const value = (c: number) => {
			const v = number(row[c]);
			return v == null || v <= 0 ? null : Math.round((v / unit) * 1e6) / 1e6;
		};
		const price = value(6);
		const rpd = number(row[5]);
		const tier = /^T[123]$/.test(text(row[3]).toUpperCase()) ? text(row[3]).toUpperCase() : null;
		const country = text(row[1]).toUpperCase();
		entries.push({
			ticker,
			priceTicker,
			country,
			zone: zoneOf(country),
			tier,
			currency: market ? (MARKET_CURRENCY[market] ?? null) : 'USD',
			price,
			target: value(7),
			dividendEstimate: price != null && rpd != null && rpd > 0 ? Math.round(price * rpd * 1e6) / 1e6 : null
		});
		reviewColumns.forEach((rc, i) => {
			const v = value(rc.col);
			if (v != null) reviews[i].prices.set(ticker, v);
		});
	}
	return { params, entries, reviews: reviews.filter((r) => r.prices.size > 0) };
}

export function extrasFromSheets(sheets: Map<string, SheetRows>): SheetExtras {
	const cc = sheets.get('Control cartera');
	const vd = sheets.get('Variación divs');
	const sel = sheets.get('Selección');
	return {
		securities: cc ? parseControlCartera(cc) : [],
		changes: vd ? parseDividendChanges(vd) : [],
		selection: sel ? parseSeleccion(sel) : null,
		goals: [...sheets].filter(([name]) => name.startsWith('Log')).map(([name, sheet]) => ({ sheet: name, goals: goalsFromReference(sheet, name === 'Log') }))
	};
}

/** Lee del libro solo lo necesario: de los registros, la cabecera. */
export async function readExtras(path: string): Promise<SheetExtras> {
	const sheets = await readSheets(path, (n) => n.startsWith('Log') || n === 'Control cartera' || n === 'Variación divs' || n === 'Selección', (n) => (n.startsWith('Log') ? 9 : n === 'Control cartera' ? 62 : Infinity));
	return extrasFromSheets(sheets);
}

export interface ExtrasSummary {
	prices: number;
	fxRates: number;
	schedules: number;
	changes: number;
	goals: number;
	/** Carteras a las que se ha puesto el orden de `Control cartera`. */
	orders: number;
	/** Valores puestos en la selección, valores nuevos dados de alta desde ella y revisiones importadas. */
	selection: number;
	created: string[];
	reviews: number;
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
	const summary: ExtrasSummary = { prices: 0, fxRates: 0, schedules: 0, changes: 0, goals: 0, orders: 0, selection: 0, created: [], reviews: 0, unknown: [] };
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
		// Orden por defecto del cuadro: el de las columnas de `Control cartera`, en las carteras que aún no tienen ninguno.
		const order = extras.securities.map((s) => ids.get(s.ticker)).filter((id): id is number => id != null);
		const hasOrder = db.prepare('SELECT 1 FROM portfolio_security WHERE portfolio_id = ?');
		const insOrder = db.prepare('INSERT INTO portfolio_security (portfolio_id, security_id, sort_order) VALUES (?,?,?)');
		if (order.length)
			for (const p of portfolios) {
				if (hasOrder.get(p.id)) continue;
				order.forEach((id, i) => insOrder.run(p.id, id, i + 1));
				summary.orders++;
			}

		if (extras.selection && portfolios.length) applySelection(db, extras.selection, portfolios[0].id, date, ids, summary);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
	summary.unknown = [...unknown].sort();
	return summary;
}

/**
 * Selección de la cartera principal: zona, tier, objetivo y dividendo estimado de cada valor (solo donde faltan),
 * alta de los candidatos que la aplicación no conoce, listas en el orden de la hoja (si la cartera aún no tiene
 * selección), parámetros (si no están guardados) y revisiones de fechas que aún no existen.
 */
function applySelection(db: DatabaseSync, sel: SheetSelection, portfolioId: number, date: string, ids: Map<string, number>, summary: ExtrasSummary): void {
	const insSecurity = db.prepare('INSERT INTO security (ticker, price_ticker, country, currency) VALUES (?,?,?,?)');
	const fill = db.prepare(
		'UPDATE security SET zone = coalesce(zone, ?), tier = coalesce(tier, ?), target_price = coalesce(target_price, ?), dividend_estimate = coalesce(dividend_estimate, ?), price_ticker = coalesce(price_ticker, ?), currency = coalesce(currency, ?) WHERE id = ?'
	);
	const hasPrice = db.prepare('SELECT 1 FROM price WHERE security_id = ?');
	const insPrice = db.prepare(`INSERT INTO price (security_id, date, price, currency, source) VALUES (?,?,?,?,'legacy')`);
	const currencyOf = db.prepare('SELECT currency FROM security WHERE id = ?');
	for (const e of sel.entries) {
		let id = ids.get(e.ticker);
		if (id == null) {
			id = Number(insSecurity.run(e.ticker, e.priceTicker, e.country || null, e.currency).lastInsertRowid);
			ids.set(e.ticker, id);
			summary.created.push(e.ticker);
		}
		fill.run(e.zone, e.tier, e.target, e.dividendEstimate, e.priceTicker, e.currency, id);
		const currency = (currencyOf.get(id) as { currency: string | null }).currency;
		if (e.price != null && currency && !hasPrice.get(id)) {
			insPrice.run(id, date, e.price, currency);
			summary.prices++;
		}
	}

	if (!(db.prepare('SELECT 1 FROM selection_entry WHERE portfolio_id = ?').get(portfolioId))) {
		const ins = db.prepare('INSERT INTO selection_entry (portfolio_id, security_id, position) VALUES (?,?,?)');
		sel.entries.forEach((e, i) => ins.run(portfolioId, ids.get(e.ticker)!, i + 1));
		summary.selection = sel.entries.length;
	}
	if (!(db.prepare("SELECT 1 FROM setting WHERE key = 'selection_params'").get())) db.prepare("INSERT INTO setting (key, value) VALUES ('selection_params', ?)").run(JSON.stringify(sel.params));

	const hasReview = db.prepare('SELECT 1 FROM selection_review WHERE portfolio_id = ? AND date = ?');
	const insReview = db.prepare("INSERT INTO selection_review (portfolio_id, date, source) VALUES (?, ?, 'legacy')");
	const insItem = db.prepare('INSERT INTO selection_review_item (review_id, security_id, position, price, currency) VALUES (?,?,?,?,?)');
	const position = new Map(sel.entries.map((e, i) => [e.ticker, i + 1]));
	for (const r of sel.reviews) {
		if (hasReview.get(portfolioId, r.date)) continue;
		const reviewId = Number(insReview.run(portfolioId, r.date).lastInsertRowid);
		for (const [ticker, price] of r.prices) {
			const id = ids.get(ticker)!;
			const currency = (currencyOf.get(id) as { currency: string | null }).currency;
			if (currency) insItem.run(reviewId, id, position.get(ticker) ?? null, price, currency);
		}
		summary.reviews++;
	}
}

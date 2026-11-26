/**
 * Historial de dividendos cobrados (RF-38) y explicación de las variaciones de un mes (RF-40):
 * cobros por mes y valor, evolución del acumulado anual frente al año anterior, comparación de un mes
 * con el mismo mes del año o del trimestre anterior y el texto que resume las diferencias.
 * Puro: recibe los cobros ya leídos. Importes en céntimos de euro.
 */
import { MONTH_NAMES } from './dividends.ts';
import type { Cents } from './types.ts';

/**
 * Tipos de operación que cuentan como cobro: los dividendos, la venta de derechos (con o sin retención; la hoja no
 * la sumaba) y la devolución de prima (la hoja sí la sumaba, p. ej. la de MRL).
 */
export const HISTORY_TYPES = ['DIVIDENDOS', 'VENTADERECHOS', 'DEVOLUCIONPRIMA'];

export type Measure = 'bruto' | 'neto';

/** Un cobro: una operación de dividendo, de venta de derechos o de devolución de prima. */
export interface Payment {
	/** AAAA-MM-DD, fecha de abono. */
	date: string;
	securityId: number;
	ticker: string;
	/** Cuenta en que se cobró: un mismo dividendo cobrado en dos cuentas suma acciones, no dividendo por acción. */
	account: string;
	/** Acciones (o derechos) con que se cobró, en unidades; nulo si no se sabe. */
	shares: number | null;
	/** Importe por acción en `currency`; nulo si no se sabe. */
	dps: number | null;
	currency: string;
	gross: Cents;
	net: Cents;
}

/** Cobros de un valor en un mes, sumados. */
export interface Cell {
	gross: Cents;
	net: Cents;
	/** Acciones con que se cobró: en cada cuenta, las del último cobro del mes, y sumadas las cuentas. */
	shares: number | null;
	/** Lo cobrado por acción en el mes: dos pagos en la misma cuenta se suman; de varias cuentas, el de la que tiene más acciones. */
	dps: number | null;
	currency: string;
	count: number;
}

/** Mes como «AAAA-MM». */
export type Month = string;

export interface History {
	/** Mes → valor → cobros. */
	months: Map<Month, Map<number, Cell>>;
	tickers: Map<number, string>;
	/** Primer mes con cobro de cada valor. */
	first: Map<number, Month>;
	/** Cobros en orden de fecha, para saber el día en que se supera un total. */
	payments: Payment[];
}

export const monthOf = (date: string): Month => date.slice(0, 7);
export function addMonths(month: Month, n: number): Month {
	const i = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
	return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
const value = (c: { gross: Cents; net: Cents } | undefined, m: Measure): Cents => (c ? (m === 'bruto' ? c.gross : c.net) : 0);

export function buildHistory(payments: Payment[]): History {
	const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
	const months = new Map<Month, Map<number, Cell>>();
	const tickers = new Map<number, string>();
	const first = new Map<number, Month>();
	// Acciones y dividendo por acción de cada valor en cada mes, por cuenta.
	const accounts = new Map<Cell, Map<string, { shares: number | null; dps: number | null; currency: string }>>();
	for (const p of sorted) {
		const key = monthOf(p.date);
		let row = months.get(key);
		if (!row) months.set(key, (row = new Map()));
		tickers.set(p.securityId, p.ticker);
		if (!first.has(p.securityId)) first.set(p.securityId, key);
		let c = row.get(p.securityId);
		if (!c) {
			row.set(p.securityId, (c = { gross: 0, net: 0, shares: null, dps: null, currency: p.currency, count: 0 }));
			accounts.set(c, new Map());
		}
		c.gross += p.gross;
		c.net += p.net;
		c.count++;
		const byAccount = accounts.get(c)!;
		const a = byAccount.get(p.account);
		if (!a) byAccount.set(p.account, { shares: p.shares, dps: p.dps, currency: p.currency });
		else {
			if (p.shares != null) a.shares = p.shares;
			// Lo cobrado por acción se suma solo si se conoce en todos los pagos y en la misma moneda.
			a.dps = a.dps != null && p.dps != null && a.currency === p.currency ? a.dps + p.dps : null;
		}
	}
	for (const [c, byAccount] of accounts) {
		const list = [...byAccount.values()];
		c.shares = list.every((a) => a.shares != null) ? list.reduce((t, a) => t + a.shares!, 0) : null;
		const main = list.reduce((best, a) => ((a.shares ?? 0) > (best.shares ?? 0) ? a : best), list[0]);
		c.dps = list.every((a) => a.currency === main.currency) ? main.dps : null;
		c.currency = main.currency;
	}
	return { months, tickers, first, payments: sorted };
}

/** Total de un mes en la medida elegida. */
export function monthTotal(h: History, month: Month, m: Measure): Cents {
	let t = 0;
	for (const c of h.months.get(month)?.values() ?? []) t += value(c, m);
	return t;
}

/** Totales por año, del más antiguo al más reciente, con su variación respecto al anterior. */
export function yearTotals(h: History, m: Measure): { year: number; amount: Cents; change: number | null }[] {
	const by = new Map<number, Cents>();
	for (const [month, row] of h.months) {
		const y = Number(month.slice(0, 4));
		for (const c of row.values()) by.set(y, (by.get(y) ?? 0) + value(c, m));
	}
	if (!by.size) return [];
	const years = [...by.keys()];
	const out = [];
	for (let y = Math.min(...years); y <= Math.max(...years); y++) {
		const amount = by.get(y) ?? 0;
		const prev = by.get(y - 1);
		out.push({ year: y, amount, change: prev ? (amount - prev) / prev : null });
	}
	return out;
}

export interface EvolutionMonth {
	month: Month;
	amount: Cents;
	cumulative: Cents;
	prevAmount: Cents;
	prevCumulative: Cents;
	/** Variación del mes y del acumulado frente al mismo mes del año anterior, en fracción; nula sin base. */
	change: number | null;
	cumChange: number | null;
	/** Mes aún por llegar: sin cifras del año en curso. */
	future: boolean;
}

export interface Evolution {
	year: number;
	months: EvolutionMonth[];
	total: Cents;
	prevTotal: Cents;
	/** Día del cobro con el que el acumulado del año alcanza el total del año anterior. */
	reachedOn: string | null;
	/** Acumulado del año anterior hasta el mismo día (solo en el año en curso). */
	prevToDate: Cents | null;
	/** Mes en que, con el calendario previsto, se alcanzará el total del año anterior; nulo si no se alcanza en el año. */
	forecastMonth: Month | null;
}

/**
 * Evolución mensual de un año (columnas BL a BQ de `Control cartera`). `forecast` son los doce importes
 * previstos del año con las acciones de hoy, para estimar cuándo se alcanzará el total del año anterior.
 */
export function evolution(h: History, year: number, m: Measure, today: string, forecast?: Cents[]): Evolution {
	const now = monthOf(today);
	const months: EvolutionMonth[] = [];
	let cumulative = 0;
	let prevCumulative = 0;
	for (let i = 1; i <= 12; i++) {
		const month = `${year}-${String(i).padStart(2, '0')}`;
		const future = month > now;
		const amount = future ? 0 : monthTotal(h, month, m);
		const prevAmount = monthTotal(h, addMonths(month, -12), m);
		cumulative += amount;
		prevCumulative += prevAmount;
		months.push({
			month,
			amount,
			cumulative,
			prevAmount,
			prevCumulative,
			change: future || !prevAmount ? null : (amount - prevAmount) / prevAmount,
			cumChange: future || !prevCumulative ? null : (cumulative - prevCumulative) / prevCumulative,
			future
		});
	}
	const total = cumulative;
	const prevTotal = prevCumulative;
	let reachedOn: string | null = null;
	if (prevTotal > 0) {
		let run = 0;
		for (const p of h.payments) {
			if (Number(p.date.slice(0, 4)) !== year || p.date > today) continue;
			run += value(p, m);
			if (run >= prevTotal) {
				reachedOn = p.date;
				break;
			}
		}
	}
	let prevToDate: Cents | null = null;
	let forecastMonth: Month | null = null;
	if (Number(today.slice(0, 4)) === year) {
		const sameDay = `${year - 1}${today.slice(4)}`;
		prevToDate = h.payments.filter((p) => p.date.startsWith(String(year - 1)) && p.date <= sameDay).reduce((a, p) => a + value(p, m), 0);
		if (!reachedOn && forecast && prevTotal > 0) {
			let run = total;
			for (let i = Number(now.slice(5, 7)) - 1; i < 12; i++) {
				const done = months[i].amount;
				// En el mes en curso solo cuenta lo previsto que falta por cobrar.
				run += i === Number(now.slice(5, 7)) - 1 ? Math.max(0, forecast[i] - done) : forecast[i];
				if (run >= prevTotal) {
					forecastMonth = months[i].month;
					break;
				}
			}
		}
	}
	return { year, months, total, prevTotal, reachedOn, prevToDate, forecastMonth };
}

/** Un split o contrasplit: las acciones se multiplican por `factor` y el dividendo por acción se divide. */
export interface Split {
	securityId: number;
	date: string;
	factor: number;
}

export type Direction = -1 | 0 | 1;

/**
 * Causa de la diferencia de un valor entre los dos meses:
 * - `cambio`: cobra en los dos; `dividend` y `shares` dicen si sube, baja o se mantiene cada cosa.
 * - `nuevo`: primer cobro de este valor; `vuelve`: ya había cobrado antes, pero no en el mes de comparación.
 * - `adelanta` / `atrasa`: cobra un mes antes o después que en el periodo de comparación.
 * - `no-trimestral`: en la comparación con el trimestre anterior, un valor que no paga cada trimestre.
 * - `vendido`: ya no hay acciones; `sin-cobro`: hay acciones pero no ha cobrado este mes; `pendiente`: igual, en el mes en curso.
 * - `sin-datos`: cobra en los dos, pero falta el nº de acciones o el dividendo por acción de alguno.
 */
export type Cause = 'cambio' | 'nuevo' | 'vuelve' | 'adelanta' | 'atrasa' | 'no-trimestral' | 'vendido' | 'sin-cobro' | 'pendiente' | 'sin-datos';

export interface CompareRow {
	securityId: number;
	ticker: string;
	current: Cell | null;
	base: Cell | null;
	/** Diferencia en la medida elegida (actual menos comparación). */
	diff: Cents;
	cause: Cause;
	dividend: Direction;
	shares: Direction;
	/** Variación del dividendo por acción, en fracción; y de las acciones, en unidades (ajustadas por splits). */
	dividendChange: number | null;
	sharesChange: number | null;
	/** Reparto de `diff` entre acciones, dividendo y tipo de cambio (solo en `cambio`). */
	parts: { shares: Cents; dividend: Cents; fx: Cents } | null;
	/** Mes en que cobró en el otro periodo (en `adelanta` y `atrasa`). */
	movedFrom: Month | null;
}

export interface Comparison {
	month: Month;
	base: Month;
	kind: 'anual' | 'trimestral';
	total: Cents;
	baseTotal: Cents;
	rows: CompareRow[];
}

/** Variación del dividendo por acción por debajo de la cual se considera el mismo (redondeos de la hoja y del broker). */
const SAME_DIVIDEND = 0.005;

/**
 * Compara un mes con el mismo mes del año anterior (`anual`) o con tres meses antes (`trimestral`).
 * `held` da las acciones de un valor al final de un mes, para saber si un valor que no ha cobrado se ha vendido.
 */
export function compareMonth(h: History, month: Month, kind: 'anual' | 'trimestral', m: Measure, opts: { today: string; splits?: Split[]; held?: (securityId: number) => number }): Comparison {
	const base = addMonths(month, kind === 'anual' ? -12 : -3);
	const at = (mo: Month, id: number) => h.months.get(mo)?.get(id);
	const cur = h.months.get(month) ?? new Map<number, Cell>();
	const old = h.months.get(base) ?? new Map<number, Cell>();
	const ids = [...new Set([...cur.keys(), ...old.keys()])];
	const ongoing = monthOf(opts.today) === month;
	const rows: CompareRow[] = ids.map((id) => {
		const c = cur.get(id) ?? null;
		const b = old.get(id) ?? null;
		const row: CompareRow = { securityId: id, ticker: h.tickers.get(id) ?? '', current: c, base: b, diff: value(c ?? undefined, m) - value(b ?? undefined, m), cause: 'cambio', dividend: 0, shares: 0, dividendChange: null, sharesChange: null, parts: null, movedFrom: null };
		if (c && b) return explain(row, c, b, m, splitFactor(opts.splits ?? [], id, base, month));
		if (c) {
			if (kind === 'trimestral' && at(addMonths(month, -12), id)) row.cause = 'no-trimestral';
			else if (at(addMonths(base, 1), id) && !at(addMonths(month, 1), id)) [row.cause, row.movedFrom] = ['adelanta', addMonths(base, 1)];
			else if (at(addMonths(base, -1), id) && !at(addMonths(month, -1), id)) [row.cause, row.movedFrom] = ['atrasa', addMonths(base, -1)];
			else row.cause = (h.first.get(id) ?? month) < base ? 'vuelve' : 'nuevo';
			return row;
		}
		if (kind === 'trimestral' && !at(addMonths(month, -12), id)) row.cause = 'no-trimestral';
		else if (at(addMonths(month, -1), id) && !at(addMonths(base, -1), id)) [row.cause, row.movedFrom] = ['adelanta', addMonths(month, -1)];
		else if (at(addMonths(month, 1), id) && !at(addMonths(base, 1), id)) [row.cause, row.movedFrom] = ['atrasa', addMonths(month, 1)];
		else if (opts.held && opts.held(id) <= 0) row.cause = 'vendido';
		else row.cause = ongoing ? 'pendiente' : 'sin-cobro';
		return row;
	});
	rows.sort((a, b) => value(b.current ?? undefined, m) - value(a.current ?? undefined, m) || value(b.base ?? undefined, m) - value(a.base ?? undefined, m) || a.ticker.localeCompare(b.ticker));
	return { month, base, kind, total: monthTotal(h, month, m), baseTotal: monthTotal(h, base, m), rows };
}

function splitFactor(splits: Split[], id: number, from: Month, to: Month): number {
	return splits.filter((s) => s.securityId === id && monthOf(s.date) > from && monthOf(s.date) <= to).reduce((f, s) => f * s.factor, 1);
}

/**
 * Reparte la diferencia de un valor que cobra en los dos meses: primero las acciones (con el dividendo de antes),
 * luego el dividendo por acción (en su moneda) y lo que queda es el efecto del tipo de cambio y los redondeos.
 */
function explain(row: CompareRow, c: Cell, b: Cell, m: Measure, factor: number): CompareRow {
	if (c.shares == null || b.shares == null || c.dps == null || b.dps == null || !b.shares || !b.dps || c.currency !== b.currency) {
		row.cause = 'sin-datos';
		row.dividend = Math.sign(row.diff) as Direction;
		return row;
	}
	const q0 = b.shares * factor;
	const d0 = b.dps / factor;
	const sharesRatio = c.shares / q0;
	const dividendRatio = c.dps / d0;
	row.sharesChange = c.shares - q0;
	row.dividendChange = dividendRatio - 1;
	row.shares = Math.abs(row.sharesChange) < 1e-6 ? 0 : row.sharesChange > 0 ? 1 : -1;
	row.dividend = Math.abs(row.dividendChange) < SAME_DIVIDEND ? 0 : row.dividendChange > 0 ? 1 : -1;
	const v0 = value(b, m);
	const shares = Math.round(v0 * (sharesRatio - 1));
	const dividend = row.dividend ? Math.round(v0 * sharesRatio * (dividendRatio - 1)) : 0;
	row.parts = { shares, dividend, fx: row.diff - shares - dividend };
	return row;
}

/** Clave del grupo de la frase en que va una fila. */
function groupOf(r: CompareRow): string {
	if (r.cause !== 'cambio') return r.cause;
	return `${r.dividend},${r.shares}`;
}

/** Orden de los grupos en el texto y su encabezado. */
const GROUPS: [string, string][] = [
	['nuevo', 'nuevo cobro de'],
	['vuelve', 'vuelvo a cobrar'],
	['1,1', 'subida de dividendo y acciones de'],
	['1,0', 'subida de dividendo de'],
	['0,1', 'compra de acciones de'],
	['1,-1', 'subida de dividendo y menos acciones de'],
	['-1,1', 'bajada de dividendo y compra de acciones de'],
	['adelanta', 'se adelanta el cobro de'],
	['atrasa', 'se atrasa el cobro de'],
	['no-trimestral', 'pagos no trimestrales de'],
	['0,0', 'sin cambios'],
	['sin-datos', 'cambio sin detalle de'],
	['-1,0', 'bajada de dividendo de'],
	['0,-1', 'menos acciones de'],
	['-1,-1', 'bajada de dividendo y menos acciones de'],
	['pendiente', 'pendiente de cobro'],
	['sin-cobro', 'sin cobro este mes de'],
	['vendido', 'ya no cobro, por venta,']
];

/** Euros enteros con signo, con punto decimal y sin separador, como en el texto que se copiaba a mano: «+35€». */
const signed = (cents: Cents) => {
	const e = Math.round(cents / 100);
	return `${e < 0 ? '-' : '+'}${Math.abs(e)}€`;
};
const plainEur = (cents: Cents) => `${(cents / 100).toFixed(2)}€`;

export const monthName = (month: Month) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;

/**
 * Texto que resume la comparación, con el formato que el propietario escribía a mano:
 * «En bruto 120.50€, por 100.00€ del año pasado. Vuelvo a cobrar AAA(+15€), que no cobré en 2029; subida de dividendo de BBB(+4€); sin cambios CCC(+0€).»
 */
export function comparisonText(cmp: Comparison, m: Measure): string {
	const ref = cmp.kind === 'anual' ? 'del año pasado' : `de ${MONTH_NAMES[Number(cmp.base.slice(5, 7)) - 1]}`;
	const head = `En ${m} ${plainEur(cmp.total)}, por ${plainEur(cmp.baseTotal)} ${ref}.`;
	const parts: string[] = [];
	for (const [key, label] of GROUPS) {
		const rows = cmp.rows.filter((r) => groupOf(r) === key).sort((a, b) => b.diff - a.diff || a.ticker.localeCompare(b.ticker));
		if (!rows.length) continue;
		let list = rows.map((r) => `${r.ticker}(${signed(r.diff)})`).join(', ');
		if (key === 'vuelve') list += `, que no cobré en ${cmp.kind === 'anual' ? cmp.base.slice(0, 4) : MONTH_NAMES[Number(cmp.base.slice(5, 7)) - 1]}`;
		parts.push(`${label} ${list}`);
	}
	if (!parts.length) return head;
	const body = parts.join('; ');
	return `${head} ${body[0].toUpperCase()}${body.slice(1)}.`;
}

/** Cobros de un valor por año y mes, del año más reciente al más antiguo. */
export function securityHistory(h: History, securityId: number): { year: number; months: (Cell | null)[]; gross: Cents; net: Cents; dps: number | null; shares: number | null; currency: string | null }[] {
	const years = new Map<number, (Cell | null)[]>();
	for (const [month, row] of h.months) {
		const c = row.get(securityId);
		if (!c) continue;
		const y = Number(month.slice(0, 4));
		if (!years.has(y)) years.set(y, new Array(12).fill(null));
		years.get(y)![Number(month.slice(5, 7)) - 1] = c;
	}
	return [...years.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([year, months]) => {
			const cells = months.filter((c): c is Cell => c != null);
			const sameCurrency = cells.every((c) => c.currency === cells[0].currency);
			return {
				year,
				months,
				gross: cells.reduce((a, c) => a + c.gross, 0),
				net: cells.reduce((a, c) => a + c.net, 0),
				dps: sameCurrency && cells.every((c) => c.dps != null) ? cells.reduce((a, c) => a + c.dps!, 0) : null,
				shares: cells.findLast((c) => c.shares != null)?.shares ?? null,
				currency: sameCurrency ? cells[0].currency : null
			};
		});
}

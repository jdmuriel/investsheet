/**
 * Exportación de validación (RF-49): el registro de una cartera con la disposición de la solapa
 * `Log` de la hoja antigua (mismas columnas, en el mismo orden), y su comparación con una copia
 * de la hoja. Aquí solo se calculan celdas y diferencias; escribir y leer el libro es cosa del servidor.
 */
import { investedCapital, run, totalCost, totalReducedCost, totalShares } from './engine.ts';
import { MICRO, type Operation, type YearMetrics } from './types.ts';

export type SheetCell = string | number | Date | null;
/** Celdas de una solapa como `[fila][columna]`, las dos con índice 1, como en la hoja. */
export type SheetRows = SheetCell[][];

export const colIndex = (letters: string): number => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export function colName(index: number): string {
	let name = '';
	for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
	return name;
}

/** Operación con los datos informativos que lleva cada fila del registro. */
export interface LogOperation extends Operation {
	description: string;
	ticker: string | null;
	accountCode: string | null;
	quantity: number | null;
	price: number | null;
	currency: string | null;
	fxRate: number | null;
	amountLocal: number | null;
	taxLocal: number | null;
	feesLocal: number | null;
}

export interface YearColumn {
	col: number;
	label: string | number;
	/** Año cuyas métricas muestra la columna; `null` es el total histórico. */
	year: number | null;
}

export interface LogLayout {
	/** Nombre de la solapa. */
	sheet: string;
	/** El registro principal lleva importes en moneda local, bloques por valor y capitaliza el resultado de los años cerrados. */
	main: boolean;
	accounts: { col: number; id: number; name: string; code: string; currency: string }[];
	/** Valores de los bloques de coste, coste reducido y nº de acciones, con la etiqueta de su columna. */
	tickers: { label: string; securityId: number | null }[];
	costStart: number;
	reducedStart: number;
	sharesStart: number;
	years: YearColumn[];
}

/** Primera fila de datos y fila de títulos de columna. */
export const HEADER_ROW = 9;
export const FIRST_ROW = 10;
const C = { date: 3, description: 4, type: 5, ticker: 6, quantity: 7, price: 8, currency: 9, fxRate: 10, account: 11 };
/** Columnas que cambian entre el registro principal y los secundarios. */
const MAIN = { amountLocal: 12, taxLocal: 13, feesLocal: 14, net: 15, gross: 16, tax: 17, fees: 18, capitalIn: 19, capitalOut: 20, purchase: 21, capital: 22, yearResult: 23, cash: 24, metrics: 17 };
const CHILD = { amountLocal: 0, taxLocal: 0, feesLocal: 0, net: 12, gross: 13, tax: 14, fees: 15, capitalIn: 16, capitalOut: 17, purchase: 18, capital: 19, yearResult: 20, cash: 22, metrics: 14 };
export const fixedColumns = (main: boolean) => (main ? MAIN : CHILD);

const METRICS: { row: number; label: string; value: (y: YearMetrics) => number }[] = [
	{ row: 2, label: 'Total aumento capital', value: (y) => y.capital },
	{ row: 3, label: 'Total ingresos', value: (y) => y.gross },
	{ row: 4, label: 'Total gastos', value: (y) => y.fees },
	{ row: 5, label: 'Total rendimiento bruto', value: (y) => y.gross - y.fees },
	{ row: 6, label: 'Total rendimiento neto (sin impuestos)', value: (y) => y.gross - y.tax - y.fees },
	{ row: 7, label: 'Total compras', value: (y) => y.purchases }
];

/** Columnas de años de la cabecera cuando no hay hoja de referencia: año en curso, los cinco anteriores y el total. */
export function defaultYears(main: boolean, currentYear: number, firstYear: number): YearColumn[] {
	const first = fixedColumns(main).metrics;
	return [
		{ col: first, label: 'Año en curso', year: currentYear },
		...[1, 2, 3, 4, 5].map((n) => ({ col: first + n, label: currentYear - n, year: currentYear - n })),
		{ col: first + 6, label: `Desde ${firstYear}`, year: null }
	];
}

/** Posición de los bloques por valor del registro principal para `n` valores, como en la hoja. */
export function defaultBlocks(n: number): Pick<LogLayout, 'costStart' | 'reducedStart' | 'sharesStart'> {
	const costStart = colIndex('AE');
	const reducedStart = costStart + n + 2; // total y columna en blanco
	const marketStart = reducedStart + n + 2;
	return { costStart, reducedStart, sharesStart: marketStart + n + 5 }; // total, variación, cambio, ganancia y blanco
}

export interface NumericColumn {
	col: number;
	header: string;
	/** `flow`: importe de la operación (se compara la suma del día). `acc`: acumulado tras la operación. */
	kind: 'flow' | 'acc';
	unit: 'money' | 'shares';
}

export interface LogModel {
	layout: LogLayout;
	/** Cabecera: filas 1 a 9. */
	header: SheetRows;
	columns: NumericColumn[];
	/** Filas de datos en orden; los importes van en euros (o en la moneda de la cuenta) y las fechas como AAAA-MM-DD. */
	rows: { date: string; cells: SheetCell[] }[];
	years: Map<number, YearMetrics>;
}

const money = (cents: number) => cents / 100;
const moneyOrBlank = (cents: number | null) => (cents == null || cents === 0 ? null : cents / 100);

function totals(years: Iterable<YearMetrics>): YearMetrics {
	const total: YearMetrics = { year: 0, capital: 0, gross: 0, tax: 0, fees: 0, purchases: 0, realizedGain: 0 };
	for (const y of years) for (const key of ['capital', 'gross', 'tax', 'fees', 'purchases', 'realizedGain'] as const) total[key] += y[key];
	return total;
}
const EMPTY_YEAR: YearMetrics = { year: 0, capital: 0, gross: 0, tax: 0, fees: 0, purchases: 0, realizedGain: 0 };

/** Valor de una métrica de cabecera, en euros. */
function metricValue(years: Map<number, YearMetrics>, column: YearColumn, metric: (typeof METRICS)[number]): number {
	return money(metric.value(column.year == null ? totals(years.values()) : (years.get(column.year) ?? EMPTY_YEAR)));
}

export function buildLog(operations: LogOperation[], layout: LogLayout): LogModel {
	const f = fixedColumns(layout.main);
	const blocks = layout.tickers.length > 0;
	const n = layout.tickers.length;

	const columns: NumericColumn[] = [];
	const add = (col: number, header: string, kind: NumericColumn['kind'], unit: NumericColumn['unit'] = 'money') => columns.push({ col, header, kind, unit });
	add(f.gross, 'Ingresos brutos €', 'flow');
	add(f.tax, 'Impuestos €', 'flow');
	add(f.fees, 'Gastos €', 'flow');
	add(f.capitalIn, 'Aumento capital', 'flow');
	add(f.capitalOut, 'Retirada capital', 'flow');
	add(f.purchase, 'Importe compra sin comisiones', 'flow');
	add(f.capital, 'Capital invertido', 'acc');
	add(f.yearResult, 'Ganancias acumuladas año', 'acc');
	for (const a of layout.accounts) add(a.col, `${a.name} (${a.currency})`, 'acc');
	if (blocks) {
		layout.tickers.forEach((t, i) => add(layout.costStart + i, `Coste ${t.label}`, 'acc'));
		add(layout.costStart + n, 'Total coste', 'acc');
		layout.tickers.forEach((t, i) => add(layout.reducedStart + i, `Coste reducido ${t.label}`, 'acc'));
		add(layout.reducedStart + n, 'Total coste reducido', 'acc');
		layout.tickers.forEach((t, i) => add(layout.sharesStart + i, `Acciones ${t.label}`, 'acc', 'shares'));
	}

	const rows: LogModel['rows'] = [];
	const { state } = run(operations, {
		onRow: (op, s) => {
			const o = op as LogOperation;
			const cells: SheetCell[] = [];
			cells[C.date] = o.date;
			cells[C.description] = o.description;
			cells[C.type] = o.type;
			cells[C.ticker] = o.ticker;
			cells[C.quantity] = o.quantity;
			cells[C.price] = o.price;
			cells[C.currency] = o.currency;
			cells[C.fxRate] = o.fxRate;
			cells[C.account] = o.accountCode;
			if (layout.main) {
				cells[f.amountLocal] = moneyOrBlank(o.amountLocal);
				cells[f.taxLocal] = moneyOrBlank(o.taxLocal);
				cells[f.feesLocal] = moneyOrBlank(o.feesLocal);
			}
			cells[f.net] = money(o.grossEur - o.taxEur - o.feesEur);
			cells[f.gross] = moneyOrBlank(o.grossEur);
			cells[f.tax] = moneyOrBlank(o.taxEur);
			cells[f.fees] = moneyOrBlank(o.feesEur);
			cells[f.capitalIn] = moneyOrBlank(o.capitalInEur);
			cells[f.capitalOut] = moneyOrBlank(o.capitalOutEur);
			cells[f.purchase] = moneyOrBlank(o.purchaseEur);
			cells[f.capital] = money(layout.main ? investedCapital(s) : s.capital);
			cells[f.yearResult] = money(s.yearResult);
			for (const a of layout.accounts) cells[a.col] = money(s.cash.get(a.id) ?? 0);
			if (blocks) {
				let cost = 0;
				let reduced = 0;
				layout.tickers.forEach((t, i) => {
					const p = t.securityId == null ? undefined : s.positions.get(t.securityId);
					cost += totalCost(p);
					reduced += totalReducedCost(p);
					cells[layout.costStart + i] = money(totalCost(p));
					cells[layout.reducedStart + i] = money(totalReducedCost(p));
					cells[layout.sharesStart + i] = totalShares(p) / MICRO;
				});
				cells[layout.costStart + n] = money(cost);
				cells[layout.reducedStart + n] = money(reduced);
			}
			rows.push({ date: o.date, cells });
		}
	});

	const header: SheetRows = [];
	const put = (row: number, col: number, value: SheetCell) => ((header[row] ??= [])[col] = value);
	for (const y of layout.years) put(1, y.col, y.label);
	for (const m of METRICS) {
		put(m.row, C.description, m.label);
		for (const y of layout.years) put(m.row, y.col, metricValue(state.years, y, m));
	}
	for (const a of layout.accounts) {
		if (layout.main) put(6, a.col, a.currency);
		put(7, a.col, a.code);
	}
	if (layout.accounts.length) put(8, layout.accounts[0].col, 'Cuentas');
	const titles: [number, string][] = [
		[C.date, 'Fecha'], [C.description, 'Descripción'], [C.type, 'Operación'], [C.ticker, 'Ticker'], [C.quantity, 'Cantidad'], [C.price, 'Precio unitario'],
		[C.currency, 'Moneda'], [C.fxRate, 'Tipo cambio'], [C.account, 'Cuenta'], [f.amountLocal, 'Importe moneda local'], [f.taxLocal, 'Impuestos m.l.'], [f.feesLocal, 'Gastos m.l.'],
		[f.net, 'Resultado neto operac.']
	];
	for (const [col, title] of titles) if (col) put(HEADER_ROW, col, title);
	for (const c of columns) put(HEADER_ROW, c.col, c.header);
	if (blocks) {
		put(8, layout.costStart, 'Capital invertido activos');
		put(8, layout.reducedStart, 'Importe compra ajustado (descontando venta de derechos)');
		put(8, layout.sharesStart, 'Nº acciones');
		// En los bloques, como en la hoja, el título de cada columna es solo el valor.
		layout.tickers.forEach((t, i) => {
			for (const start of [layout.costStart, layout.reducedStart, layout.sharesStart]) put(HEADER_ROW, start + i, t.label);
		});
		put(HEADER_ROW, layout.reducedStart + n, 'Total coste');
	}
	return { layout, header, columns, rows, years: state.years };
}

// ---------- Comparación con la hoja ----------

export interface LogDifference {
	sheet: string;
	/** Fecha de las filas comparadas; `null` en las métricas de cabecera. */
	date: string | null;
	/** Letra de la columna (o celda, en la cabecera). */
	cell: string;
	column: string;
	kind: 'Movimientos del día' | 'Acumulado' | 'Métrica anual' | 'Diferencia vigente';
	reference: number;
	app: number;
	difference: number;
	/** En los acumulados, cuánto cambia la diferencia respecto a la que ya se arrastraba. */
	change?: number;
}

export interface LogComparison {
	sheet: string;
	differences: LogDifference[];
	/** Filas con fecha leídas de la hoja y fechas en las que se han podido comparar acumulados. */
	referenceRows: number;
	checkpoints: number;
	lastCheckpoint: string | null;
	/** Fechas con filas descolocadas en la hoja, donde solo se comparan los movimientos del día. */
	skippedDates: number;
}

export interface DiffOptions {
	/** Solo se informan diferencias de esta fecha en adelante (AAAA-MM-DD). */
	from?: string;
	/** Fechas mal tecleadas en la hoja que la importación corrige. */
	overrides?: { date: string; ticker: string; set: string }[];
}

const isoDate = (v: SheetCell): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const numeric = (v: SheetCell): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Unidades enteras de comparación: céntimos o millonésimas de acción. */
const scale = (unit: NumericColumn['unit']) => (unit === 'money' ? 100 : MICRO);
/** Tolerancia en esas unidades: un céntimo, o una diezmilésima de acción. */
const tolerance = (unit: NumericColumn['unit']) => (unit === 'money' ? 1 : 100);

/**
 * Compara el registro calculado con la solapa equivalente de la hoja. No se comparan fila a fila
 * (el orden dentro del día y las filas de cierre no coinciden), sino:
 *
 * - los importes de cada operación, sumados por fecha;
 * - los acumulados, al cierre de cada fecha en la que la hoja está en orden (ninguna fila anterior
 *   tiene fecha posterior ni al revés). Una diferencia arrastrada solo se informa cuando cambia;
 *   la hoja reinicia las ganancias del año en filas elegidas a mano, así que el 31 de diciembre y
 *   el 1 de enero se admite que lo haya hecho ya o todavía no;
 * - las métricas anuales de la cabecera.
 */
export function diffLog(model: LogModel, reference: SheetRows, options: DiffOptions = {}): LogComparison {
	const { layout } = model;
	const sheet = layout.sheet;
	const f = fixedColumns(layout.main);
	const from = options.from ?? '';
	const differences: LogDifference[] = [];

	const ref: { date: string; cells: SheetCell[] }[] = [];
	for (let r = FIRST_ROW; r < reference.length; r++) {
		const cells = reference[r];
		let date = cells ? isoDate(cells[C.date]) : null;
		if (!cells || !date) continue;
		const ticker = String(cells[C.ticker] ?? '').toUpperCase().split(':').pop()!.trim();
		for (const o of options.overrides ?? []) if (o.date === date && o.ticker === ticker) date = o.set;
		ref.push({ date, cells });
	}

	// Importes por fecha.
	const flows = model.columns.filter((c) => c.kind === 'flow');
	const sumByDate = (rows: { date: string; cells: SheetCell[] }[]) => {
		const out = new Map<string, number[]>();
		for (const row of rows) {
			let sums = out.get(row.date);
			if (!sums) out.set(row.date, (sums = flows.map(() => 0)));
			flows.forEach((c, i) => (sums![i] += Math.round((numeric(row.cells[c.col]) ?? 0) * 100)));
		}
		return out;
	};
	const appFlows = sumByDate(model.rows);
	const refFlows = sumByDate(ref);
	for (const date of [...new Set([...appFlows.keys(), ...refFlows.keys()])].sort()) {
		if (date < from) continue;
		flows.forEach((c, i) => {
			const a = appFlows.get(date)?.[i] ?? 0;
			const b = refFlows.get(date)?.[i] ?? 0;
			if (Math.abs(a - b) > 1) differences.push({ sheet, date, cell: colName(c.col), column: c.header, kind: 'Movimientos del día', reference: b / 100, app: a / 100, difference: (a - b) / 100 });
		});
	}

	// Acumulados al cierre de las fechas en que la hoja está en orden.
	const acc = model.columns.filter((c) => c.kind === 'acc');
	const laterMin: string[] = new Array(ref.length + 1).fill('9999-99-99');
	for (let i = ref.length - 1; i >= 0; i--) laterMin[i] = ref[i].date < laterMin[i + 1] ? ref[i].date : laterMin[i + 1];
	const carried = acc.map(() => 0);
	const standing = acc.map(() => null as { reference: number; app: number } | null);
	let earlierMax = '';
	let appIndex = -1;
	let checkpoints = 0;
	let lastCheckpoint: string | null = null;
	const dates = new Set<string>();
	const checked = new Set<string>();
	ref.forEach((row, i) => {
		dates.add(row.date);
		if (row.date > earlierMax) earlierMax = row.date;
		if (row.date !== earlierMax || laterMin[i + 1] <= row.date) return;
		while (appIndex + 1 < model.rows.length && model.rows[appIndex + 1].date <= row.date) appIndex++;
		checkpoints++;
		lastCheckpoint = row.date;
		checked.add(row.date);
		const current = appIndex < 0 ? null : model.rows[appIndex].cells;
		const value = (col: number) => (current ? (numeric(current[col]) ?? 0) : 0);
		const yearEnd = /-(12-31|01-01)$/.test(row.date);
		acc.forEach((c, k) => {
			const b = numeric(row.cells[c.col]);
			if (b == null) return;
			let a = value(c.col);
			let diff = Math.round(a * scale(c.unit)) - Math.round(b * scale(c.unit));
			// En el cambio de año la hoja puede haber pasado ya el resultado del año al capital invertido, o no:
			// se da por buena la variante que no altera la diferencia que se arrastraba.
			const closed = !yearEnd ? null : c.col === f.yearResult ? 0 : c.col === f.capital && layout.main ? a + value(f.yearResult) : null;
			if (closed != null) {
				const alternative = Math.round(closed * 100) - Math.round(b * 100);
				if (Math.abs(alternative - carried[k]) < Math.abs(diff - carried[k])) [a, diff] = [closed, alternative];
			}
			standing[k] = Math.abs(diff) > tolerance(c.unit) ? { reference: b, app: a } : null;
			if (Math.abs(diff - carried[k]) <= tolerance(c.unit)) return;
			if (row.date >= from) differences.push({ sheet, date: row.date, cell: colName(c.col), column: c.header, kind: 'Acumulado', reference: b, app: a, difference: diff / scale(c.unit), change: (diff - carried[k]) / scale(c.unit) });
			carried[k] = diff;
		});
	});
	acc.forEach((c, k) => {
		const s = standing[k];
		if (s) differences.push({ sheet, date: lastCheckpoint, cell: colName(c.col), column: c.header, kind: 'Diferencia vigente', reference: s.reference, app: s.app, difference: Math.round((s.app - s.reference) * scale(c.unit)) / scale(c.unit) });
	});

	// Métricas anuales de la cabecera.
	const fromYear = from ? Number(from.slice(0, 4)) : 0;
	for (const y of layout.years) {
		if (y.year != null && y.year < fromYear) continue;
		for (const m of METRICS) {
			const b = numeric(reference[m.row]?.[y.col] ?? null);
			if (b == null) continue;
			const a = metricValue(model.years, y, m);
			if (Math.abs(Math.round(a * 100) - Math.round(b * 100)) > 1)
				differences.push({ sheet, date: null, cell: `${colName(y.col)}${m.row}`, column: `${m.label} · ${y.year ?? y.label}`, kind: 'Métrica anual', reference: b, app: a, difference: Math.round((a - b) * 100) / 100 });
		}
	}

	return { sheet, differences, referenceRows: ref.length, checkpoints, lastCheckpoint, skippedDates: dates.size - checked.size };
}

/** Columnas de años que trae la cabecera de la hoja: años sueltos, «Año en curso» (el siguiente al mayor) y el total. */
export function yearsFromReference(reference: SheetRows, main: boolean): YearColumn[] {
	const first = fixedColumns(main).metrics;
	const labels: { col: number; label: string | number }[] = [];
	for (let col = first; col < first + 12; col++) {
		const v = reference[1]?.[col];
		if (typeof v === 'number' || (typeof v === 'string' && v.trim())) labels.push({ col, label: typeof v === 'string' ? v.trim() : v });
		else if (labels.length) break;
	}
	const numbers = labels.map((l) => l.label).filter((l): l is number => typeof l === 'number');
	return labels.map(({ col, label }) => ({ col, label, year: typeof label === 'number' ? label : /curso/i.test(label) && numbers.length ? Math.max(...numbers) + 1 : null }));
}

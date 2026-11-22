/**
 * Agregación de dividendos cobrados a partir de las operaciones que devuelve la API
 * (`GET /api/v1/carteras/{cartera}/operaciones`). Pura: no lee red ni base de datos.
 * Trabaja en céntimos para no acumular errores de coma flotante.
 */

/** Lo que usa la agregación de cada operación de la API (importes en euros, en unidades). */
export interface DividendRow {
	date: string;
	type: string;
	security: string | null;
	account: string | null;
	grossEur: number;
	taxEur: number;
	feesEur: number;
	/** Cartera de la que viene, cuando se agregan varias. */
	portfolio?: string;
}

export type Period = 'año' | 'trimestre' | 'mes';
export type Breakdown = 'valor' | 'cuenta' | 'cartera' | 'tipo';
export type Measure = 'bruto' | 'neto';

/** Tipos que cuentan como cobro: los dividendos y, si se piden, lo que el cuadro de cartera suma a «Cobrado». */
export const DIVIDEND_TYPES = ['DIVIDENDOS'];
export const RETURN_TYPES = ['DEVOLUCIONPRIMA', 'VENTADERECHOS'];

export interface DividendPeriod {
	period: string;
	count: number;
	gross: number;
	tax: number;
	fees: number;
	net: number;
	/** Variación de la medida elegida respecto al periodo anterior, en fracción (0,1 = +10 %); nula si no hay base. */
	change: number | null;
	/** Medida acumulada desde el primer periodo. */
	cumulative: number;
	/** Medida por grupo del desglose, si se ha pedido. */
	parts?: Record<string, number>;
}

export interface DividendReport {
	measure: Measure;
	period: Period;
	breakdown: Breakdown | null;
	/** Grupos del desglose, de mayor a menor (con «Otros» al final si se han agrupado). */
	groups: string[];
	rows: DividendPeriod[];
	total: { count: number; gross: number; tax: number; fees: number; net: number };
}

const cents = (eur: number) => Math.round(eur * 100);

export function periodOf(date: string, period: Period): string {
	const year = date.slice(0, 4);
	if (period === 'año') return year;
	const month = Number(date.slice(5, 7));
	if (period === 'trimestre') return `${year}-T${Math.ceil(month / 3)}`;
	return date.slice(0, 7);
}

/** Todos los periodos entre el primero y el último, para que los huecos salgan como cero. */
export function periodRange(first: string, last: string, period: Period): string[] {
	const out: string[] = [];
	if (period === 'año') {
		for (let y = Number(first); y <= Number(last); y++) out.push(String(y));
		return out;
	}
	const split = (p: string) => (period === 'mes' ? [Number(p.slice(0, 4)), Number(p.slice(5, 7))] : [Number(p.slice(0, 4)), Number(p.slice(6))]);
	const steps = period === 'mes' ? 12 : 4;
	let [y, n] = split(first);
	const [ly, ln] = split(last);
	while (y < ly || (y === ly && n <= ln)) {
		out.push(period === 'mes' ? `${y}-${String(n).padStart(2, '0')}` : `${y}-T${n}`);
		n++;
		if (n > steps) {
			n = 1;
			y++;
		}
	}
	return out;
}

const TYPE_LABELS: Record<string, string> = { DIVIDENDOS: 'Dividendos', DEVOLUCIONPRIMA: 'Devolución de prima', VENTADERECHOS: 'Venta de derechos' };

function groupOf(row: DividendRow, breakdown: Breakdown): string {
	if (breakdown === 'valor') return row.security ?? '(sin valor)';
	if (breakdown === 'cuenta') return row.account ?? '(sin cuenta)';
	if (breakdown === 'cartera') return row.portfolio ?? '(sin cartera)';
	return TYPE_LABELS[row.type] ?? row.type;
}

export interface ReportOptions {
	period?: Period;
	measure?: Measure;
	breakdown?: Breakdown | null;
	/** Número máximo de grupos en el desglose; el resto se suma en «Otros». */
	maxGroups?: number;
}

/**
 * Suma los cobros por periodo (con los huecos a cero), con variación y acumulado de la medida elegida
 * y, si se pide, desglosada por valor, cuenta, cartera o tipo. Importes de salida en céntimos.
 */
export function dividendReport(rows: DividendRow[], options: ReportOptions = {}): DividendReport {
	const period = options.period ?? 'año';
	const measure = options.measure ?? 'neto';
	const breakdown = options.breakdown ?? null;
	const maxGroups = Math.max(1, options.maxGroups ?? 8);
	const value = (r: DividendRow) => (measure === 'bruto' ? cents(r.grossEur) : cents(r.grossEur) - cents(r.taxEur) - cents(r.feesEur));

	const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
	const empty = { count: 0, gross: 0, tax: 0, fees: 0, net: 0 };
	if (!sorted.length) return { measure, period, breakdown, groups: [], rows: [], total: empty };

	// Grupos del desglose ordenados por su total; los que no caben se suman en «Otros».
	let groups: string[] = [];
	const rename = new Map<string, string>();
	if (breakdown) {
		const totals = new Map<string, number>();
		for (const r of sorted) totals.set(groupOf(r, breakdown), (totals.get(groupOf(r, breakdown)) ?? 0) + value(r));
		const ranked = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g]) => g);
		const kept = ranked.length > maxGroups ? ranked.slice(0, maxGroups - 1) : ranked;
		for (const g of ranked) rename.set(g, kept.includes(g) ? g : 'Otros');
		groups = ranked.length > maxGroups ? [...kept, 'Otros'] : kept;
	}

	const byPeriod = new Map<string, DividendPeriod>();
	for (const p of periodRange(periodOf(sorted[0].date, period), periodOf(sorted.at(-1)!.date, period), period)) {
		byPeriod.set(p, { period: p, count: 0, gross: 0, tax: 0, fees: 0, net: 0, change: null, cumulative: 0, parts: breakdown ? Object.fromEntries(groups.map((g) => [g, 0])) : undefined });
	}
	const total = { ...empty };
	for (const r of sorted) {
		const row = byPeriod.get(periodOf(r.date, period))!;
		const [gross, tax, fees] = [cents(r.grossEur), cents(r.taxEur), cents(r.feesEur)];
		for (const t of [row, total]) {
			t.count++;
			t.gross += gross;
			t.tax += tax;
			t.fees += fees;
			t.net += gross - tax - fees;
		}
		if (row.parts) row.parts[rename.get(groupOf(r, breakdown!))!] += value(r);
	}
	const out = [...byPeriod.values()];
	let cumulative = 0;
	out.forEach((row, i) => {
		const v = measure === 'bruto' ? row.gross : row.net;
		cumulative += v;
		row.cumulative = cumulative;
		const prev = i > 0 ? (measure === 'bruto' ? out[i - 1].gross : out[i - 1].net) : 0;
		row.change = prev > 0 ? (v - prev) / prev : null;
	});
	return { measure, period, breakdown, groups, rows: out, total };
}

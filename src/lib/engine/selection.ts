/**
 * Selección mensual (RF-31 a RF-35): listas por zona y tier, inversión máxima, variación desde la última
 * revisión y línea resumen con el formato de la solapa `Selección` de la hoja antigua. Sin base de datos.
 */
import { plain } from '../format.ts';
import type { Cents } from './types.ts';

export const ZONES = ['España', 'EE. UU.', 'Resto del mundo'] as const;
export const TIERS = ['T1', 'T2', 'T3'] as const;

/** Las cuatro listas de la hoja, en su orden: tres por zona y una para los valores sin tier (especulativos). */
export const LISTS = [
	{ key: 'ES', label: 'España' },
	{ key: 'MUNDO', label: 'Resto del mundo' },
	{ key: 'US', label: 'EE. UU.' },
	{ key: 'SINTIER', label: 'Sin tier' }
] as const;
export type ListKey = (typeof LISTS)[number]['key'];

export function listOf(zone: string | null, tier: string | null): ListKey {
	if (!tier) return 'SINTIER';
	if (zone === 'España') return 'ES';
	if (zone === 'EE. UU.') return 'US';
	return 'MUNDO';
}

/** Parámetros: inversión máxima por tier en miles de euros (España aparte) y umbrales de variación mensual. */
export interface SelectionParams {
	limits: Record<'T1' | 'T2' | 'T3', { spain: number; other: number }>;
	/** Variación reseñable y grande, como fracción (0,04 = 4 %). */
	significant: number;
	high: number;
}
export const DEFAULT_PARAMS: SelectionParams = {
	limits: { T1: { spain: 6, other: 5 }, T2: { spain: 4, other: 3 }, T3: { spain: 1.5, other: 1 } },
	significant: 0.04,
	high: 0.1
};

/** Inversión máxima de un valor, en céntimos de euro; `null` sin tier. */
export function maxInvestment(params: SelectionParams, zone: string | null, tier: string | null): Cents | null {
	const limit = params.limits[tier as keyof SelectionParams['limits']];
	return limit ? Math.round((zone === 'España' ? limit.spain : limit.other) * 100_000) : null;
}

/** «cerca» a partir del 90 % del máximo; «superado» por encima de él. */
export function limitStatus(invested: Cents, max: Cents | null): 'cerca' | 'superado' | null {
	if (max == null || max <= 0) return null;
	if (invested > max) return 'superado';
	return invested >= max * 0.9 ? 'cerca' : null;
}

export interface SelectionInput {
	ticker: string;
	zone: string | null;
	tier: string | null;
	/** Precio de hoy y precio en la última revisión, en la moneda del valor. */
	price: number | null;
	lastPrice: number | null;
	target: number | null;
	/** Rentabilidad por dividendo bruta a precio de hoy. */
	rpd: number | null;
	/** Coste reducido de la posición en la cartera, en céntimos de euro (0 si no se tiene). */
	invested: Cents;
	/** Precio medio de compra en la moneda del valor; `null` si no se tiene. */
	pmc: number | null;
}

export interface SelectionRow extends SelectionInput {
	list: ListKey;
	distance: number | null;
	variation: number | null;
	tone: VariationTone | null;
	/** «sube fuerte de A a B», «baja de A a B»… o el precio solo si la variación no es reseñable. */
	description: string;
	max: Cents | null;
	status: 'cerca' | 'superado' | null;
	summary: string;
}

const signed = (fraction: number) => `${fraction > 0 ? '+' : ''}${plain(fraction * 100, 0)}%`;
const short = (n: number) => String(Math.round(n * 1e4) / 1e4);

/** Tono de una variación según los umbrales: reseñable (claro) o grande (oscuro); `null` si no es reseñable. */
export type VariationTone = 'sube' | 'sube fuerte' | 'baja' | 'baja fuerte';
export function variationTone(variation: number | null, params: SelectionParams): VariationTone | null {
	if (variation == null) return null;
	if (variation <= -params.high) return 'baja fuerte';
	if (variation <= -params.significant) return 'baja';
	if (variation >= params.high) return 'sube fuerte';
	if (variation >= params.significant) return 'sube';
	return null;
}

export function variationText(price: number, last: number | null, params: SelectionParams): string {
	if (last == null || last <= 0) return short(price);
	const verb = variationTone((price - last) / last, params);
	return verb ? `${verb} de ${short(last)} a ${short(price)}` : short(price);
}

export interface PricePoint {
	date: string;
	price: number;
	/** El precio de hoy, que aún no es de ninguna revisión. */
	today?: boolean;
}

/**
 * Evolución del precio de un valor: el de cada revisión cerrada, en orden de fecha, y al final el de hoy si es
 * posterior a la última. Se descartan las revisiones con el precio en otra moneda (un cambio de cotización).
 */
export function priceSeries(reviews: { date: string; price: number; currency: string }[], currency: string | null, today: { date: string; price: number } | null): PricePoint[] {
	const points: PricePoint[] = reviews
		.filter((r) => r.price > 0 && (currency == null || r.currency === currency))
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((r) => ({ date: r.date, price: r.price }));
	if (today && today.price > 0 && (!points.length || today.date > points[points.length - 1].date)) points.push({ date: today.date, price: today.price, today: true });
	return points;
}

/** Una compra del valor: acciones en millonésimas, coste en céntimos de euro y precio por acción en su moneda. */
export interface Purchase {
	date: string;
	shares: number;
	cost: Cents;
	price: number | null;
	currency: string | null;
}

export interface ReviewVariation {
	/** Fecha del punto al que se llega (revisión, o hoy en la última si aún no hay revisión de hoy). */
	date: string;
	today: boolean;
	/** Precio en ese punto, en la moneda del valor. */
	price: number;
	variation: number;
	tone: VariationTone | null;
}

/**
 * Variación del precio de una revisión a la siguiente (la última, hasta hoy), de las `count` más recientes y
 * en orden de fecha: lo que la hoja dejaba ver de un vistazo con sus colores.
 */
export function reviewVariations(points: PricePoint[], params: SelectionParams, count = 24): ReviewVariation[] {
	const out: ReviewVariation[] = [];
	for (let i = 1; i < points.length; i++) {
		const variation = (points[i].price - points[i - 1].price) / points[i - 1].price;
		out.push({ date: points[i].date, today: !!points[i].today, price: points[i].price, variation, tone: variationTone(variation, params) });
	}
	return out.slice(-count);
}

/** Compras dentro del periodo de una serie de precios (de su primer a su último punto). */
export function purchasesIn(buys: Purchase[], points: PricePoint[]): Purchase[] {
	if (points.length < 2) return [];
	const from = points[0].date;
	const to = points[points.length - 1].date;
	return buys.filter((b) => b.date >= from && b.date <= to);
}

/** Los puntos de los últimos `months` meses de la serie, contados hacia atrás desde su último punto. */
export function lastMonths(points: PricePoint[], months: number): PricePoint[] {
	if (!points.length) return points;
	const [y, m, d] = points[points.length - 1].date.split('-').map(Number);
	const total = y * 12 + (m - 1) - months;
	const from = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	return points.filter((p) => p.date >= from);
}

export function selectionRow(input: SelectionInput, params: SelectionParams): SelectionRow {
	const { price, lastPrice, target } = input;
	const distance = price != null && target ? (price - target) / target : null;
	const variation = price != null && lastPrice ? (price - lastPrice) / lastPrice : null;
	const description = price == null ? '' : variationText(price, lastPrice, params);
	const max = maxInvestment(params, input.zone, input.tier);
	const held = input.invested > 0;
	// Mismo formato que la hoja: «MRL +2% (11.70/9.50 +23%, RPD 3.59%, invertido 4.3K, T1, PMC 9.35)».
	const head = variation == null ? input.ticker : `${input.ticker} ${signed(variation)}`;
	const priced = price == null ? '' : `${/^(sube|baja)/.test(description) ? description : plain(price)}/${target ? plain(target) : '-'}${distance == null ? '' : ` ${signed(distance)}`}`;
	const parts = [
		priced,
		`RPD ${input.rpd == null ? '-' : `${plain(input.rpd * 100)}%`}`,
		held ? `invertido ${plain(input.invested / 100_000, 1)}K` : 'nueva',
		input.tier ?? 'sin tier',
		...(held && input.pmc != null ? [`PMC ${plain(input.pmc)}`] : [])
	].filter(Boolean);
	return { ...input, list: listOf(input.zone, input.tier), distance, variation, tone: variationTone(variation, params), description, max, status: limitStatus(input.invested, max), summary: `${head} (${parts.join(', ')})` };
}

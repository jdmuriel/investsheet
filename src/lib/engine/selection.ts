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
	/** «sube fuerte de A a B», «baja de A a B»… o el precio solo si la variación no es reseñable. */
	description: string;
	max: Cents | null;
	status: 'cerca' | 'superado' | null;
	summary: string;
}

const signed = (fraction: number) => `${fraction > 0 ? '+' : ''}${plain(fraction * 100, 0)}%`;
const short = (n: number) => String(Math.round(n * 1e4) / 1e4);

export function variationText(price: number, last: number | null, params: SelectionParams): string {
	if (last == null || last <= 0) return short(price);
	const v = (price - last) / last;
	const verb = v <= -params.high ? 'baja fuerte' : v <= -params.significant ? 'baja' : v >= params.high ? 'sube fuerte' : v >= params.significant ? 'sube' : null;
	return verb ? `${verb} de ${short(last)} a ${short(price)}` : short(price);
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
	return { ...input, list: listOf(input.zone, input.tier), distance, variation, description, max, status: limitStatus(input.invested, max), summary: `${head} (${parts.join(', ')})` };
}

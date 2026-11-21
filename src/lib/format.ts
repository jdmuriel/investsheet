// En español los números de cuatro cifras no llevan punto de millar por defecto: aquí se pone siempre.
const money = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6, useGrouping: 'always' });
const percent = new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: 'always' });
const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** Céntimos a texto con formato español; cadena vacía para cero si `blankZero`. */
export function eur(cents: number | null | undefined, blankZero = false): string {
	if (cents == null || (blankZero && cents === 0)) return '';
	return money.format(cents / 100);
}
export function num(value: number | null | undefined): string {
	return value == null ? '' : number.format(value);
}
/** Fracción a porcentaje con un decimal: 0,4375 → «43,8 %». */
export function pct(fraction: number | null | undefined): string {
	return fraction == null ? '' : percent.format(fraction);
}
/** Precio o importe por acción, con entre dos y cuatro decimales: «12,50», «0,5234». */
const unit = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: 'always' });
export function price(value: number | null | undefined, currency?: string | null): string {
	return value == null ? '' : currency ? `${unit.format(value)} ${symbol(currency)}` : unit.format(value);
}
/** AAAA-MM-DD a DD/MM/AAAA. */
export function date(iso: string): string {
	return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

const clock = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' });
/** Instante ISO a «HH:MM del DD/MM/AAAA», en hora de Madrid. */
export function dateTime(iso: string): string {
	const d = new Date(iso);
	return `${clock.format(d)} del ${date(day.format(d))}`;
}

/** Símbolo de una moneda para mostrar importes en listados; el código si no tiene uno inequívoco. */
export function symbol(currency: string | null | undefined): string {
	return SYMBOLS[currency ?? ''] ?? currency ?? '';
}
/** Importe con el símbolo de su moneda, para listados: «1.234,56 €». En pantallas de entrada se usa el código. */
export function amount(cents: number | null | undefined, currency: string | null | undefined): string {
	return cents == null ? '' : `${money.format(cents / 100)} ${symbol(currency)}`;
}
/** Importe tal como se teclea en un campo: sin separador de miles. */
export function typed(cents: number): string {
	return (cents / 100).toFixed(2).replace('.', ',');
}
/**
 * Número con punto decimal y sin separador de miles, para textos que se copian a otra herramienta
 * con el formato de la hoja antigua (la línea resumen de la selección): 11.7 → «11.70».
 */
const plainFormats = new Map<number, Intl.NumberFormat>();
export function plain(value: number, decimals = 2): string {
	let f = plainFormats.get(decimals);
	if (!f) plainFormats.set(decimals, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false })));
	return f.format(value);
}

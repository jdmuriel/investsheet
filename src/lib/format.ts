// En español los números de cuatro cifras no llevan punto de millar por defecto: aquí se pone siempre.
const money = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6, useGrouping: 'always' });
const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

/** Céntimos a texto con formato español; cadena vacía para cero si `blankZero`. */
export function eur(cents: number | null | undefined, blankZero = false): string {
	if (cents == null || (blankZero && cents === 0)) return '';
	return money.format(cents / 100);
}
export function num(value: number | null | undefined): string {
	return value == null ? '' : number.format(value);
}
/** AAAA-MM-DD a DD/MM/AAAA. */
export function date(iso: string): string {
	return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
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

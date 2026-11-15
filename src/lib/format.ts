const money = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 6 });

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

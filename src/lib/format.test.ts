import { describe, expect, it } from 'vitest';
import { amount, eur, num, pct, price, symbol, typed } from './format.ts';

describe('formato de importes', () => {
	it('pone siempre el separador de miles, también con cuatro cifras', () => {
		expect(eur(271828)).toBe('2.718,28');
		expect(eur(-1234567)).toBe('-12.345,67');
		expect(eur(99900)).toBe('999,00');
		expect(num(1200)).toBe('1.200');
		expect(num(1.122385)).toBe('1,122385');
	});

	it('da los porcentajes con un decimal', () => {
		expect(pct(0.4375).replace(/\s/g, ' ')).toBe('43,8 %');
		expect(pct(12.5).replace(/\s/g, ' ')).toBe('1.250,0 %');
		expect(pct(null)).toBe('');
	});

	it('da los precios con entre dos y cuatro decimales', () => {
		expect(price(12.5)).toBe('12,50');
		expect(price(0.52345)).toBe('0,5235');
		expect(price(1250, 'USD')).toBe('1.250,00 $');
		expect(price(null)).toBe('');
	});

	it('en listados usa el símbolo de la moneda, o el código si no lo tiene', () => {
		expect(amount(271828, 'EUR')).toBe('2.718,28 €');
		expect(amount(-500, 'USD')).toBe('-5,00 $');
		expect(symbol('GBP')).toBe('£');
		expect(symbol('CHF')).toBe('CHF');
		expect(symbol(null)).toBe('');
	});

	it('en campos de entrada va sin separador de miles', () => {
		expect(typed(271828)).toBe('2718,28');
	});

	it('deja en blanco lo que no hay', () => {
		expect(eur(null)).toBe('');
		expect(eur(0, true)).toBe('');
		expect(amount(null, 'EUR')).toBe('');
	});
});

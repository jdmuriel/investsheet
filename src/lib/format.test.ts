import { describe, expect, it } from 'vitest';
import { amount, eur, num, symbol, typed } from './format.ts';

describe('formato de importes', () => {
	it('pone siempre el separador de miles, también con cuatro cifras', () => {
		expect(eur(284259)).toBe('2.842,59');
		expect(eur(-1234567)).toBe('-12.345,67');
		expect(eur(99900)).toBe('999,00');
		expect(num(1200)).toBe('1.200');
		expect(num(1.122385)).toBe('1,122385');
	});

	it('en listados usa el símbolo de la moneda, o el código si no lo tiene', () => {
		expect(amount(284259, 'EUR')).toBe('2.842,59 €');
		expect(amount(-500, 'USD')).toBe('-5,00 $');
		expect(symbol('GBP')).toBe('£');
		expect(symbol('CHF')).toBe('CHF');
		expect(symbol(null)).toBe('');
	});

	it('en campos de entrada va sin separador de miles', () => {
		expect(typed(284259)).toBe('2842,59');
	});

	it('deja en blanco lo que no hay', () => {
		expect(eur(null)).toBe('');
		expect(eur(0, true)).toBe('');
		expect(amount(null, 'EUR')).toBe('');
	});
});

import { describe, expect, it } from 'vitest';
import type { SheetRows } from '../engine/log-export.ts';
import { openDatabase } from './db.ts';
import { currentSchedules, listChanges } from './dividends.ts';
import { loadGoals } from './goals.ts';
import { applyExtras, extrasFromSheets, parseControlCartera, parseDividendChanges } from './legacy-extras.ts';
import { latestFx, latestQuotes, savePrice } from './market.ts';

// Todos los datos de estas pruebas son inventados.
function controlCartera(): SheetRows {
	const cc: SheetRows = [];
	const put = (row: number, values: (string | number | null)[]) => (cc[row] = [null, ...values]);
	put(1, ['Ticker', 'Total', 'BME:ACME', 'USCO', 'LON:UKCO', 'AMS:DUAL', 'LON:DUAL', null, 12345.6]);
	put(3, ['Nº Acciones', null, 100, 10, 50, null, 20]);
	put(5, ['Moneda', 'EUR/USD', 'EUR', 'USD', 'GBX', 'EUR', 'GBX']);
	put(6, ['Moneda - cambio desde eur', null, 1, 1.1, 85, 1, 85]);
	put(9, ['Precio actual (Moneda local)', null, 12, 330, 1250, 40, 3400]);
	put(30, ['Dividendos futuros ordinarios', 'E', 0.2, null, null, null, null]);
	for (let m = 1; m < 12; m++) put(30 + m, [null, 'x', null, m % 3 === 2 ? 2.2 : null, m === 5 ? 30 : null, null, null]);
	return cc;
}

describe('datos de la hoja antigua', () => {
	it('lee precio, cambio y calendario de cada valor, pasando los peniques a libras', () => {
		const securities = parseControlCartera(controlCartera());
		expect(securities.map((s) => s.ticker)).toEqual(['ACME', 'USCO', 'UKCO', 'DUAL']);
		expect(securities[0]).toEqual({ ticker: 'ACME', currency: 'EUR', price: 12, fxRate: 1, months: [0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
		expect(securities[1]).toMatchObject({ currency: 'USD', price: 330, fxRate: 1.1 });
		expect(securities[1].months!.filter((m) => m > 0)).toEqual([2.2, 2.2, 2.2, 2.2]);
		expect(securities[2]).toMatchObject({ currency: 'GBP', price: 12.5, fxRate: 0.85 });
		expect(securities[2].months![5]).toBe(0.3);
		// De las dos columnas del mismo valor manda la que tiene posición.
		expect(securities[3]).toEqual({ ticker: 'DUAL', currency: 'GBP', price: 34, fxRate: 0.85, months: null });
	});

	it('lee los cambios de dividendo, con el cambio de la moneda puesto del derecho', () => {
		const sheet: SheetRows = [[], [null, 'Fecha', 'Ticker']];
		sheet[2] = [null, new Date('2030-03-10T00:00:00Z'), 'USCO', 4, 4.4, 10, 0.1, 'USD', '$', 0.8, 0.32, 3.2, 'USCO sube', 'https://ejemplo.test'];
		sheet[3] = [null, new Date('2030-04-01T00:00:00Z'), 'ACME', 0.5, 0.45, 100, -0.1, 'EUR', '€', 1, -0.05, -5, 'ACME baja'];
		sheet[4] = [null, null, 'Notas sueltas'];
		expect(parseDividendChanges(sheet)).toEqual([
			{ date: '2030-03-10', ticker: 'USCO', oldAnnual: 4, newAnnual: 4.4, currency: 'USD', fxRate: 1.25, url: 'https://ejemplo.test', note: 'USCO sube' },
			{ date: '2030-04-01', ticker: 'ACME', oldAnnual: 0.5, newAnnual: 0.45, currency: 'EUR', fxRate: 1, url: null, note: 'ACME baja' }
		]);
	});

	it('vuelca los datos sin pisar lo que ya hay, y repetirlo no cambia nada', () => {
		const db = openDatabase(':memory:');
		db.exec(`
			INSERT INTO portfolio (id, name, sort_order) VALUES (1, 'Principal', 0), (2, 'Otra', 1);
			INSERT INTO security (id, ticker, currency) VALUES (1, 'ACME', 'EUR'), (2, 'USCO', 'USD'), (3, 'UKCO', 'GBP');
			INSERT INTO goal (portfolio_id, year, metric, amount_eur) VALUES (2, 2030, 'gross', 111);
		`);
		savePrice(db, 2, '2030-06-10', 340, 'USD', 'sheet');
		const log: SheetRows = [];
		log[3] = [];
		log[3][15] = 250;
		const other: SheetRows = [];
		other[3] = [];
		other[3][12] = 90;
		const changes: SheetRows = [[], []];
		changes[2] = [null, new Date('2030-03-10T00:00:00Z'), 'USCO', 4, 4.4, 10, 0.1, 'USD', '$', 0.8];
		changes[3] = [null, new Date('2030-03-11T00:00:00Z'), 'NADA', 1, 2, 10, 1, 'EUR', '€', 1];
		const extras = extrasFromSheets(new Map([['Log', log], ['LogOtra', other], ['Control cartera', controlCartera()], ['Variación divs', changes]]));

		const summary = applyExtras(db, extras, '2030-06-01');
		expect(summary).toEqual({ prices: 2, fxRates: 2, schedules: 3, changes: 1, goals: 1, unknown: ['DUAL', 'NADA'] });
		expect(latestQuotes(db).get(1)).toMatchObject({ price: 12, source: 'legacy', date: '2030-06-01' });
		expect(latestQuotes(db).get(2)).toMatchObject({ price: 340, source: 'sheet' });
		expect(latestFx(db).get('GBP')).toEqual({ rate: 0.85, date: '2030-06-01' });
		expect(currentSchedules(db).get(3)).toMatchObject({ currency: 'GBP', validFrom: '2030-06-01' });
		expect(listChanges(db)).toHaveLength(1);
		expect(loadGoals(db, 1, 2030)).toEqual({ gross: 25000 });
		expect(loadGoals(db, 2, 2030)).toEqual({ gross: 111 });

		expect(applyExtras(db, extras, '2030-06-01')).toMatchObject({ prices: 0, fxRates: 0, schedules: 0, changes: 0, goals: 0 });
	});
});

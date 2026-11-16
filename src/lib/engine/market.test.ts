import { describe, expect, it } from 'vitest';
import { annualDividend, changeEffect, sharesAt } from './dividends.ts';
import { parseCsv, parseEcbXml, parsePriceCsv } from './market.ts';
import { MICRO, type Operation } from './types.ts';

// Todos los datos de estas pruebas son inventados.
describe('hoja de precios', () => {
	it('lee un CSV con comillas, comas dentro de un campo y líneas vacías', () => {
		expect(parseCsv('﻿a,"b, c","d ""e"""\r\n\r\n1,,3\n')).toEqual([
			['a', 'b, c', 'd "e"'],
			['1', '', '3']
		]);
	});

	it('toma ticker, precio, moneda y fecha; salta títulos y errores y pasa los peniques a libras', () => {
		const csv = ['Ticker,Precio,Moneda,Fecha', 'BME:ACME,"12,34",EUR,16/11/2030 17:35:00', 'usco,330.5,usd,2030-11-15', 'LON:UKCO,"1.250,00",GBX,', 'NYSE:ROTO,#N/A,USD,', ',5,EUR,'].join('\n');
		expect(parsePriceCsv(csv)).toEqual([
			{ ticker: 'BME:ACME', price: 12.34, currency: 'EUR', date: '2030-11-16' },
			{ ticker: 'USCO', price: 330.5, currency: 'USD', date: '2030-11-15' },
			{ ticker: 'LON:UKCO', price: 12.5, currency: 'GBP', date: null }
		]);
	});
});

describe('tipos de cambio del BCE', () => {
	const xml = `<gesmes:Envelope><Cube>
		<Cube time="2030-11-15"><Cube currency="USD" rate="1.1050"/><Cube currency="JPY" rate="160.2"/><Cube currency="GBP" rate="0.8510"/></Cube>
		<Cube time='2030-11-14'><Cube currency='USD' rate='1.1000'/></Cube>
	</Cube></gesmes:Envelope>`;
	it('lee una línea por fecha y moneda, opcionalmente solo de las monedas pedidas', () => {
		expect(parseEcbXml(xml)).toHaveLength(4);
		expect(parseEcbXml(xml, new Set(['USD']))).toEqual([
			{ currency: 'USD', date: '2030-11-15', rate: 1.105 },
			{ currency: 'USD', date: '2030-11-14', rate: 1.1 }
		]);
		expect(parseEcbXml('no es xml')).toEqual([]);
	});
});

describe('cambios de dividendo', () => {
	it('suma el calendario sin restos de coma flotante', () => {
		expect(annualDividend([0.1, 0.2, 0, 0.3])).toBe(0.6);
	});

	it('calcula la variación por acción y anual en euros', () => {
		const e = changeEffect(4, 4.4, 1.1, 50);
		expect(e.pct).toBeCloseTo(0.1);
		expect(e.perShareEur).toBeCloseTo(0.4 / 1.1);
		expect(e.annualEur).toBeCloseTo(20 / 1.1);
		expect(e.beforeEur).toBeCloseTo(200 / 1.1);
		expect(changeEffect(0, 1, 1, 10).pct).toBeNull();
	});

	it('da las acciones al cierre de cada fecha en un solo recorrido', () => {
		let id = 0;
		const op = (date: string, kind: 'buy' | 'sell', shares: number): Operation => ({ id: ++id, date, seq: id, type: 'X', grossEur: 0, taxEur: 0, feesEur: 0, capitalInEur: 0, capitalOutEur: 0, purchaseEur: 0, cash: [], positions: [{ securityId: 7, kind, shares: shares * MICRO, cost: 0, reducedCost: 0, proceeds: 0 }] });
		const operations = [op('2030-03-01', 'buy', 10), op('2030-01-01', 'buy', 5), op('2030-06-01', 'sell', 3)];
		const dates = ['2030-06-01', '2029-12-31', '2030-01-01', '2030-05-31', '2031-01-01'];
		expect(sharesAt(operations, dates.map((date) => ({ securityId: 7, date })))).toEqual([12, 0, 5, 15, 12]);
		expect(sharesAt(operations, [{ securityId: 8, date: '2030-12-31' }])).toEqual([0]);
	});
});

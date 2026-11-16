import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db.ts';
import { currentSchedules, deleteChange, listChanges, saveSchedule } from './dividends.ts';
import { fxOn, latestFx, latestQuotes, marketStatus, refreshFx, refreshPrices, saveManualPrice, savePrice } from './market.ts';

// Todos los datos de estas pruebas son inventados.
let db: DatabaseSync;
const ACME = 1;
const USCO = 2;
const UKCO = 3;

beforeEach(() => {
	db = openDatabase(':memory:');
	db.exec(`
		INSERT INTO portfolio (id, name) VALUES (1, 'Prueba');
		INSERT INTO account (id, portfolio_id, code, name, currency) VALUES (1, 1, 'BANCO', 'Banco', 'EUR');
		INSERT INTO security (id, ticker, price_ticker, currency) VALUES (1, 'ACME', 'BME:ACME', 'EUR'), (2, 'USCO', NULL, 'USD'), (3, 'UKCO', 'LON:UKCO', 'GBP');
	`);
});

const serving = (body: string, ok = true) => async () => ({ ok, status: ok ? 200 : 500, text: async () => body });
const months = (pairs: Record<number, string>) => Object.fromEntries(Object.entries(pairs).map(([m, v]) => [`m${m}`, v]));

describe('precios', () => {
	it('guarda los precios de la hoja por ticker de precios o por ticker, y avisa de los desconocidos', async () => {
		const csv = 'Ticker,Precio,Moneda,Fecha\nBME:ACME,"12,5",EUR,2030-06-03\nUSCO,330,USD,\nLON:UKCO,1250,GBX,\nNYSE:NADA,5,USD,';
		const result = await refreshPrices(db, { url: 'x', fetch: serving(csv), today: '2030-06-04' });
		expect(result).toEqual({ ok: true, updated: 3, unknown: ['NYSE:NADA'] });
		expect(latestQuotes(db)).toEqual(
			new Map([
				[ACME, { date: '2030-06-03', price: 12.5, currency: 'EUR', source: 'sheet' }],
				[USCO, { date: '2030-06-04', price: 330, currency: 'USD', source: 'sheet' }],
				[UKCO, { date: '2030-06-04', price: 12.5, currency: 'GBP', source: 'sheet' }]
			])
		);
		expect(marketStatus(db).pricesError).toBeNull();
	});

	it('si la lectura falla conserva lo último guardado y anota el error', async () => {
		savePrice(db, ACME, '2030-06-01', 11, 'EUR', 'sheet');
		const result = await refreshPrices(db, { url: 'x', fetch: serving('', false), today: '2030-06-04' });
		expect(result.ok).toBe(false);
		expect(latestQuotes(db).get(ACME)).toMatchObject({ price: 11, date: '2030-06-01' });
		expect(marketStatus(db).pricesError).toContain('500');
		expect((await refreshPrices(db, { url: 'x', fetch: serving('<html>no es la hoja</html>') })).ok).toBe(false);
	});

	it('un precio tecleado a mano no lo pisa la hoja ese mismo día, y en blanco se borra', async () => {
		expect(saveManualPrice(db, ACME, { price: '13,20', date: '2020-06-04' })).toEqual({ ok: true });
		await refreshPrices(db, { url: 'x', fetch: serving('ACME,12,EUR,'), today: '2020-06-04' });
		expect(latestQuotes(db).get(ACME)).toMatchObject({ price: 13.2, source: 'manual' });
		await refreshPrices(db, { url: 'x', fetch: serving('ACME,12,EUR,'), today: '2020-06-05' });
		expect(latestQuotes(db).get(ACME)).toMatchObject({ price: 12, source: 'sheet', date: '2020-06-05' });
		expect(saveManualPrice(db, ACME, { price: 'caro', date: '2020-06-04' }).ok).toBe(false);
		saveManualPrice(db, ACME, { price: '', date: '2020-06-04' });
		expect(db.prepare('SELECT count(*) AS n FROM price WHERE security_id = 1').get()).toEqual({ n: 1 });
	});
});

describe('tipos de cambio', () => {
	const xml = `<Cube><Cube time="2030-06-03"><Cube currency="USD" rate="1.1"/><Cube currency="GBP" rate="0.85"/><Cube currency="JPY" rate="160"/></Cube>
		<Cube time="2030-05-31"><Cube currency="USD" rate="1.08"/></Cube></Cube>`;

	it('guarda los cambios del BCE de las monedas en uso y devuelve el del último día hábil anterior', async () => {
		const result = await refreshFx(db, { fetch: serving(xml) });
		expect(result).toMatchObject({ ok: true, updated: 3 });
		expect(fxOn(db, 'USD', '2030-06-02')).toEqual({ rate: 1.08, date: '2030-05-31' });
		expect(fxOn(db, 'USD', '2030-06-10')).toEqual({ rate: 1.1, date: '2030-06-03' });
		expect(fxOn(db, 'USD', '2030-01-01')).toBeNull();
		expect(fxOn(db, 'EUR', '2030-01-01')).toEqual({ rate: 1, date: '2030-01-01' });
		expect(latestFx(db).get('GBP')).toEqual({ rate: 0.85, date: '2030-06-03' });
		expect(latestFx(db).has('JPY')).toBe(false);
	});

	it('si el BCE no responde anota el error y no borra nada', async () => {
		await refreshFx(db, { fetch: serving(xml) });
		expect((await refreshFx(db, { fetch: serving('', false) })).ok).toBe(false);
		expect(latestFx(db).size).toBe(2);
		expect(marketStatus(db).fxError).toContain('BCE');
	});
});

describe('calendario y cambios de dividendo', () => {
	it('la primera versión del calendario no es un cambio', () => {
		expect(saveSchedule(db, ACME, { date: '2030-01-01', ...months({ 1: '0,20', 7: '0,30' }) })).toEqual({ ok: true, changeId: null });
		expect(currentSchedules(db).get(ACME)).toMatchObject({ validFrom: '2030-01-01', currency: 'EUR' });
		expect(currentSchedules(db).get(ACME)!.months.slice(0, 7)).toEqual([0.2, 0, 0, 0, 0, 0, 0.3]);
		expect(listChanges(db)).toEqual([]);
	});

	it('un cambio de dividendo versiona el calendario y deja constancia en una sola acción', async () => {
		await refreshFx(db, { fetch: serving('<Cube time="2030-03-01"><Cube currency="USD" rate="1.25"/></Cube>') });
		saveSchedule(db, USCO, { date: '2030-01-01', ...months({ 3: '1', 6: '1', 9: '1', 12: '1' }) });
		const result = saveSchedule(db, USCO, { date: '2030-03-10', change: '1', url: 'https://ejemplo.test/nota', ...months({ 3: '1,1', 6: '1,1', 9: '1,1', 12: '1,1' }) });
		expect(result.ok).toBe(true);
		expect(listChanges(db)).toMatchObject([{ ticker: 'USCO', date: '2030-03-10', oldAnnual: 4, newAnnual: 4.4, currency: 'USD', fxRate: 1.25, url: 'https://ejemplo.test/nota' }]);
		// Las dos versiones se conservan: el calendario de una fecha pasada se puede reconstruir.
		expect(currentSchedules(db, '2030-02-01').get(USCO)!.months[2]).toBe(1);
		expect(currentSchedules(db).get(USCO)!.months[2]).toBe(1.1);
		expect(db.prepare(`SELECT count(*) AS n FROM audit_log WHERE entity IN ('dividend_schedule', 'dividend_change')`).get()).toEqual({ n: 3 });
		expect(deleteChange(db, listChanges(db)[0].id)).toBe(true);
		expect(listChanges(db)).toEqual([]);
	});

	it('rechaza un cambio sin variación, sin tipo de cambio o con importes no válidos', () => {
		saveSchedule(db, USCO, { date: '2030-01-01', ...months({ 3: '4' }) });
		expect(saveSchedule(db, USCO, { date: '2030-03-10', change: '1', ...months({ 3: '5' }) })).toMatchObject({ ok: false });
		expect(saveSchedule(db, USCO, { date: '2030-03-10', change: '1', fxRate: '1,2', ...months({ 3: '5' }) })).toMatchObject({ ok: true });
		expect(saveSchedule(db, ACME, { date: '2030-01-01', ...months({ 1: '1' }) }).ok).toBe(true);
		expect(saveSchedule(db, ACME, { date: '2030-02-01', change: '1', ...months({ 6: '1' }) })).toMatchObject({ ok: false });
		expect(saveSchedule(db, ACME, { date: 'ayer', ...months({ 1: '-1' }) })).toMatchObject({ ok: false });
		expect(saveSchedule(db, 99, { date: '2030-01-01' }).ok).toBe(false);
	});
});

import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { SheetRows } from '../engine/log-export.ts';
import { openDatabase } from './db.ts';
import { applyExtras, parseSeleccion } from './legacy-extras.ts';
import { savePrice } from './market.ts';
import { saveOperation } from './operations.ts';
import { addEntry, closeReview, loadParams, loadSelection, removeEntry, saveOrder, saveParams, saveReviewNotes } from './selection.ts';

// Todos los datos de estas pruebas son inventados.
let db: DatabaseSync;
beforeEach(() => {
	db = openDatabase(':memory:');
	db.exec(`
		INSERT INTO portfolio (id, name, sort_order) VALUES (1, 'Principal', 0), (2, 'Otra', 1);
		INSERT INTO account (id, portfolio_id, code, name, currency) VALUES (1, 1, 'BANCO', 'Banco', 'EUR');
		INSERT INTO security (id, ticker, currency) VALUES (1, 'ACME', 'EUR'), (2, 'USCO', 'USD'), (3, 'UKCO', 'GBP');
	`);
});

/** Solapa `Selección` con la disposición de la hoja (filas y columnas desde 1). */
function seleccion(): SheetRows {
	const s: SheetRows = [];
	const put = (row: number, values: (string | number | null)[]) => (s[row] = [null, ...values]);
	put(3, [null, null, 5, 6, 3, 4, 1, 1.5, null, 0.04, 0.1]);
	put(4, ['País', 'Ticket', 'Tier', 'Invertido', 'RPD', 'Valor actual', 'Objetivo', 'Distancia', 'Var %', 'Desc', 'Valor fecha', null, 'Valor a \n2030-02-15', 'Valor a \n2030-01-15']);
	put(5, ['ES', 'BME:ACME', 'T1', 4.3, 0.05, 12, 9.5, null, null, null, 11, null, 11, 10]);
	put(6, ['UK', 'LON:UKCO', 'T2', 2, 0.04, 1250, 1000, null, null, null, 1200, null, 1200, null]);
	put(8, ['US', 'NUEVA', 'sin tier', 0, 0.02, 50, 40, null, null, null, 45, null, 45, 44]);
	return s;
}

describe('importación de la solapa Selección', () => {
	it('lee parámetros, valores en orden y revisiones, con Londres en libras', () => {
		const sel = parseSeleccion(seleccion());
		expect(sel.params).toEqual({ limits: { T1: { other: 5, spain: 6 }, T2: { other: 3, spain: 4 }, T3: { other: 1, spain: 1.5 } }, significant: 0.04, high: 0.1 });
		expect(sel.entries.map((e) => [e.ticker, e.zone, e.tier, e.currency, e.price, e.target])).toEqual([
			['ACME', 'España', 'T1', 'EUR', 12, 9.5],
			['UKCO', 'Resto del mundo', 'T2', 'GBP', 12.5, 10],
			['NUEVA', 'EE. UU.', null, 'USD', 50, 40]
		]);
		expect(sel.entries[0].dividendEstimate).toBe(0.6);
		expect(sel.reviews.map((r) => [r.date, [...r.prices]])).toEqual([
			['2030-02-15', [['ACME', 11], ['UKCO', 12], ['NUEVA', 45]]],
			['2030-01-15', [['ACME', 10], ['NUEVA', 44]]]
		]);
	});

	it('vuelca la selección sin pisar nada y da de alta los candidatos', () => {
		db.exec("UPDATE security SET tier = 'T3' WHERE id = 1");
		const extras = { securities: [], changes: [], goals: [], selection: parseSeleccion(seleccion()) };
		expect(applyExtras(db, extras, '2030-02-20')).toMatchObject({ selection: 3, reviews: 2, created: ['NUEVA'] });
		expect(db.prepare('SELECT tier, zone, target_price AS t FROM security WHERE id = 1').get()).toMatchObject({ tier: 'T3', zone: 'España', t: 9.5 });
		expect(applyExtras(db, extras, '2030-02-20')).toMatchObject({ selection: 0, reviews: 0, created: [] });
		const data = loadSelection(db, 1, '2030-02-20');
		expect(data.lists.map((l) => [l.key, l.rows.map((r) => r.ticker)])).toEqual([['ES', ['ACME']], ['MUNDO', ['UKCO']], ['US', []], ['SINTIER', ['NUEVA']]]);
		expect(data.lastReview?.date).toBe('2030-02-15');
		expect(loadParams(db).limits.T1.spain).toBe(6);
	});

	it('el orden de Control cartera va a cada cartera que aún no tiene uno', () => {
		const securities = ['USCO', 'ACME'].map((ticker) => ({ ticker, currency: null, price: null, fxRate: null, months: null }));
		expect(applyExtras(db, { securities, changes: [], goals: [], selection: null }, '2030-02-20').orders).toBe(2);
		expect(db.prepare('SELECT security_id AS id FROM portfolio_security WHERE portfolio_id = 2 ORDER BY sort_order').all()).toEqual([{ id: 2 }, { id: 1 }]);
		expect(applyExtras(db, { securities, changes: [], goals: [], selection: null }, '2030-02-20').orders).toBe(0);
	});
});

describe('selección y revisiones', () => {
	beforeEach(() => {
		db.exec("UPDATE security SET zone = 'España', tier = 'T1', target_price = 10 WHERE id = 1; UPDATE security SET zone = 'España', tier = 'T2' WHERE id = 3");
		for (const id of [1, 3, 2]) addEntry(db, 1, id);
		saveOperation(db, 1, null, { type: 'APORTACION', date: '2030-01-01', account: '1', amount: '10000' });
		saveOperation(db, 1, null, { type: 'COMPRA', date: '2030-01-02', account: '1', security: '1', quantity: '100', price: '10' });
		savePrice(db, 1, '2030-02-01', 11, 'EUR', 'manual');
		db.exec("INSERT INTO dividend_schedule (security_id, valid_from, currency, months_json) VALUES (1, '2030-01-01', 'EUR', '[0,0,0,0,0,0.3,0,0,0,0,0,0.25]')");
	});

	it('calcula invertido, RPD, distancia y aviso de máximo', () => {
		const es = loadSelection(db, 1).lists[0].rows;
		expect(es.map((r) => r.ticker)).toEqual(['ACME', 'UKCO']);
		expect(es[0]).toMatchObject({ invested: 100_000, price: 11, max: 600_000, status: null, pmc: 10, variation: null });
		expect(es[0].rpd).toBeCloseTo(0.05);
		expect(es[0].distance).toBeCloseTo(0.1);
		expect(es[0].summary).toBe('ACME (11.00/10.00 +10%, RPD 5.00%, invertido 1.0K, T1, PMC 10.00)');
	});

	it('cierra la revisión con el precio del día y mide desde ella la variación siguiente', () => {
		expect(closeReview(db, 1, '2030-02-02', 'ACME o UKCO', 'ACME')).toMatchObject({ ok: true, items: 1 });
		savePrice(db, 1, '2030-03-01', 12.1, 'EUR', 'manual');
		const later = loadSelection(db, 1, '2030-03-01');
		expect(later.lastReview).toMatchObject({ date: '2030-02-02', proposals: 'ACME o UKCO', choice: 'ACME', items: 1 });
		expect(later.lists[0].rows[0].variation).toBeCloseTo(0.1);
		expect(later.lists[0].rows[0].description).toBe('sube de 11 a 12.1');
		expect(later.lists[0].rows[0].tone).toBe('sube');
		expect(later.lists[0].rows[0].history).toEqual([
			{ date: '2030-02-02', price: 11 },
			{ date: '2030-03-01', price: 12.1, today: true }
		]);
		// Cerrar la de hoy no deja a cero las variaciones del día.
		closeReview(db, 1, '2030-03-01', '', '');
		expect(loadSelection(db, 1, '2030-03-01').lists[0].rows[0].variation).toBeCloseTo(0.1);
		expect(closeReview(db, 1, '2030-03-01', 'otra vez', '')).toMatchObject({ ok: true });
		expect(loadSelection(db, 1).reviews.map((r) => r.date)).toEqual(['2030-03-01', '2030-02-02']);
		expect(saveReviewNotes(db, 1, later.lastReview!.id, 'p', 'c')).toBe(true);
		expect(saveReviewNotes(db, 2, later.lastReview!.id, 'p', 'c')).toBe(false);
	});

	it('reordena una lista sin mover las demás, y añade y quita valores', () => {
		saveOrder(db, 1, [3, 1]);
		const data = loadSelection(db, 1);
		expect(data.lists[0].rows.map((r) => r.ticker)).toEqual(['UKCO', 'ACME']);
		expect(data.lists[3].rows.map((r) => r.ticker)).toEqual(['USCO']);
		removeEntry(db, 1, 2);
		expect(loadSelection(db, 1).candidates.map((c) => c.ticker)).toEqual(['USCO']);
		expect(addEntry(db, 1, 99)).toBe(false);
	});

	it('parámetros tecleados en miles y porcentaje', () => {
		expect(saveParams(db, { T1: '5', T1E: '6,5', T2: '3', T2E: '4', T3: '1', T3E: '1,5', significant: '5', high: '12' })).toEqual({ ok: true });
		expect(loadParams(db)).toMatchObject({ limits: { T1: { spain: 6.5 } }, significant: 0.05, high: 0.12 });
		expect(saveParams(db, { T1: 'x', T1E: '6', T2: '3', T2E: '4', T3: '1', T3E: '1', significant: '10', high: '5' })).toMatchObject({ ok: false });
	});
});

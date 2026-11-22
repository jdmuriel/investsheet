import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/db.ts';
import { mcpPost } from '../server/mcp.ts';
import { dividendReport, periodRange, type DividendRow } from './dividends.ts';

// Todos los datos de estas pruebas son inventados.
const row = (date: string, security: string, gross: number, tax = 0): DividendRow => ({ date, type: 'DIVIDENDOS', security, account: 'BANCO', grossEur: gross, taxEur: tax, feesEur: 0 });

describe('dividendReport', () => {
	const rows = [row('2022-03-01', 'ACME', 10, 1.5), row('2024-06-15', 'ACME', 20, 3), row('2024-07-01', 'FOO', 5.1, 0.3), row('2024-11-30', 'BAR', 0.3)];

	it('suma por año, rellena los huecos y calcula variación y acumulado', () => {
		const r = dividendReport(rows);
		expect(r.rows.map((p) => p.period)).toEqual(['2022', '2023', '2024']);
		expect(r.rows[1]).toMatchObject({ count: 0, net: 0, change: -1 });
		expect(r.rows[2]).toMatchObject({ count: 3, gross: 2540, tax: 330, net: 2210, change: null, cumulative: 3060 });
		expect(r.total).toEqual({ count: 4, gross: 3540, tax: 480, fees: 0, net: 3060 });
	});

	it('agrupa por mes y trimestre', () => {
		expect(dividendReport(rows, { period: 'trimestre' }).rows.map((p) => p.period).slice(0, 2)).toEqual(['2022-T1', '2022-T2']);
		expect(dividendReport(rows, { period: 'mes' }).rows).toHaveLength(33);
		expect(periodRange('2023-11', '2024-02', 'mes')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
	});

	it('desglosa y junta en «Otros» los que no caben', () => {
		const r = dividendReport(rows, { breakdown: 'valor', maxGroups: 2 });
		expect(r.groups).toEqual(['ACME', 'Otros']);
		expect(r.rows[2].parts).toEqual({ ACME: 1700, Otros: 510 });
	});
});

function seeded(): DatabaseSync {
	const db = openDatabase(':memory:');
	db.exec(`
		INSERT INTO portfolio (id, name) VALUES (1, 'Prueba'), (2, 'Otra');
		INSERT INTO account (id, portfolio_id, code, name, currency) VALUES (1, 1, 'BANCO', 'Banco', 'EUR'), (2, 2, 'OTRO', 'Otro', 'EUR');
		INSERT INTO security (id, ticker, currency) VALUES (1, 'ACME', 'EUR');
	`);
	return db;
}

type Rpc = { result: { content: { text: string }[]; isError?: boolean; tools?: { name: string }[]; protocolVersion?: string }; error?: { code: number } };
const call = (db: DatabaseSync, name: string, args: object) => {
	const r = mcpPost(db, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, null).body as Rpc;
	return { isError: r.result.isError === true, data: JSON.parse(r.result.content[0].text) };
};

describe('servidor MCP sobre la API', () => {
	it('protocolo: initialize, lista, notificaciones, lotes y versiones', () => {
		const db = seeded();
		const init = mcpPost(db, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, null).body as Rpc;
		expect(init.result.protocolVersion).toBe('2025-06-18');
		expect(mcpPost(db, { jsonrpc: '2.0', method: 'notifications/initialized' }, null)).toEqual({ status: 202 });
		const list = mcpPost(db, [{ jsonrpc: '2.0', id: 2, method: 'tools/list' }], '2025-06-18').body as Rpc[];
		expect(list[0].result.tools!.map((t) => t.name)).toEqual(['get_guide', 'list_securities', 'get_portfolio_state', 'search_operations', 'get_operation', 'add_operation', 'update_operation', 'delete_operation', 'get_dividends']);
		expect(mcpPost(db, { jsonrpc: '2.0', id: 3, method: 'x' }, null).body).toMatchObject({ error: { code: -32601 } });
		expect(mcpPost(db, {}, '1999-01-01').status).toBe(400);
		expect(mcpPost(db, undefined, null).status).toBe(400);
	});

	it('add_operation valida sin guardar y guarda con save', () => {
		const db = seeded();
		const count = () => (db.prepare('SELECT count(*) AS n FROM operation').get() as { n: number }).n;
		const op = { type: 'APORTACION', date: '2024-01-01', account: 'BANCO', amount: 1000 };
		expect(call(db, 'add_operation', { operation: op }).data).toMatchObject({ saved: false, dryRun: true });
		expect(count()).toBe(0);
		const saved = call(db, 'add_operation', { operation: op, save: true }).data;
		expect(saved).toMatchObject({ saved: true });
		expect(count()).toBe(1);
		expect(call(db, 'add_operation', { portfolio: 'Otra', operation: op }).isError).toBe(true);
		expect(call(db, 'get_operation', { id: saved.id }).data).toMatchObject({ type: 'APORTACION' });
		const update = call(db, 'update_operation', { id: saved.id, fields: { ...op, amount: 1500 }, save: true });
		expect(update.data).toMatchObject({ saved: true });
		expect(call(db, 'delete_operation', { id: saved.id }).isError).toBe(true);
		expect(call(db, 'delete_operation', { id: saved.id, confirm: true }).data).toMatchObject({ deleted: true });
		expect(count()).toBe(0);
	});

	it('get_dividends agrega todas las carteras sin el límite de 500', () => {
		const db = seeded();
		call(db, 'add_operation', { operation: { type: 'APORTACION', date: '2023-01-01', account: 'BANCO', amount: 10000 }, save: true });
		call(db, 'add_operation', { operation: { type: 'COMPRA', date: '2023-01-02', account: 'BANCO', security: 'ACME', quantity: 100, price: 10 }, save: true });
		for (const date of ['2023-06-01', '2024-06-01']) call(db, 'add_operation', { operation: { type: 'DIVIDENDOS', date, account: 'BANCO', security: 'ACME', quantity: 100, price: 0.5 }, save: true });
		const r = call(db, 'get_dividends', { portfolio: 'all', breakdown: 'portfolio', measure: 'gross' }).data;
		expect(r.periods.map((p: { period: string; gross: number }) => [p.period, p.gross])).toEqual([['2023', 50], ['2024', 50]]);
		expect(r.groups).toEqual(['Prueba']);
		expect(call(db, 'get_dividends', { portfolio: 'nada' }).isError).toBe(true);
	});
});

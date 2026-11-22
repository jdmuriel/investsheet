import { describe, expect, it } from 'vitest';
import { formatValue, niceStep, renderChart, validateChart } from './chart.ts';
import { dividendReport, periodRange, type DividendRow } from './dividends.ts';
import { handleMessage } from './protocol.ts';
import { fetchOperations, type ToolContext } from './tools.ts';

const row = (date: string, security: string, gross: number, tax = 0, extra: Partial<DividendRow> = {}): DividendRow => ({ date, type: 'DIVIDENDOS', security, account: 'BANCO', grossEur: gross, taxEur: tax, feesEur: 0, ...extra });

describe('dividendReport', () => {
	const rows = [row('2022-03-01', 'ACME', 10, 1.5), row('2024-06-15', 'ACME', 20, 3), row('2024-07-01', 'FOO', 5.1, 0.3), row('2024-11-30', 'BAR', 0.3)];

	it('suma por año, rellena los huecos y calcula variación y acumulado', () => {
		const r = dividendReport(rows);
		expect(r.rows.map((p) => p.period)).toEqual(['2022', '2023', '2024']);
		expect(r.rows[1]).toMatchObject({ count: 0, net: 0, change: -1 });
		expect(r.rows[2]).toMatchObject({ count: 3, gross: 2540, tax: 330, net: 2210, change: null, cumulative: 3060 });
		expect(r.total).toEqual({ count: 4, gross: 3540, tax: 480, fees: 0, net: 3060 });
	});

	it('variación con base positiva y medida bruta', () => {
		const r = dividendReport([row('2023-01-01', 'A', 10), row('2024-01-01', 'A', 15)], { measure: 'bruto' });
		expect(r.rows[1].change).toBeCloseTo(0.5);
	});

	it('agrupa por mes y trimestre', () => {
		expect(dividendReport(rows, { period: 'trimestre' }).rows.map((p) => p.period).slice(0, 3)).toEqual(['2022-T1', '2022-T2', '2022-T3']);
		expect(dividendReport(rows, { period: 'mes' }).rows).toHaveLength(33);
		expect(periodRange('2023-11', '2024-02', 'mes')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
		expect(periodRange('2023-T4', '2024-T1', 'trimestre')).toEqual(['2023-T4', '2024-T1']);
	});

	it('desglosa por valor y junta en «Otros» los que no caben', () => {
		const r = dividendReport(rows, { breakdown: 'valor', maxGroups: 2 });
		expect(r.groups).toEqual(['ACME', 'Otros']);
		expect(r.rows[2].parts).toEqual({ ACME: 1700, Otros: 510 });
		const all = dividendReport(rows, { breakdown: 'valor' });
		expect(all.groups).toEqual(['ACME', 'FOO', 'BAR']);
	});

	it('sin cobros devuelve un informe vacío', () => {
		expect(dividendReport([]).rows).toEqual([]);
	});
});

describe('renderChart', () => {
	const spec = { title: 'Dividendos <netos>', kind: 'barras' as const, labels: ['2023', '2024'], series: [{ name: 'Neto', values: [1234.5, 2000] }], unit: '€' };

	it('pinta barras con el valor en el aviso y escapa los textos', () => {
		const svg = renderChart(spec);
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg).toContain('Dividendos &lt;netos&gt;');
		expect(svg).toContain('<title>2023: 1.235 €</title>');
		expect(svg.match(/class="m"/g)).toHaveLength(2);
		expect(svg).toContain('prefers-color-scheme: dark');
	});

	it('pinta barras apiladas y líneas con leyenda', () => {
		const two = { ...spec, series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, null] }] };
		const stacked = renderChart({ ...two, kind: 'barras_apiladas' });
		expect(stacked).toContain('>A</text>');
		expect(stacked).toContain('<title>2023 · B: 3,00 €</title>');
		const lines = renderChart({ ...two, kind: 'lineas' });
		expect(lines.match(/<circle/g)).toHaveLength(3);
	});

	it('valida la especificación', () => {
		expect(validateChart({ ...spec, series: [{ name: 'X', values: [1] }] })[0]).toContain('1 valores y hay 2 etiquetas');
		expect(() => renderChart({ ...spec, labels: [] })).toThrow();
	});

	it('formatea con separador de miles y elige pasos redondos', () => {
		expect(formatValue(1234)).toBe('1.234');
		expect(formatValue(12.5, '€')).toBe('12,50 €');
		expect(niceStep(2300)).toBe(500);
		expect(niceStep(9)).toBe(2);
	});
});

/** API falsa: responde a las rutas que usan las herramientas con datos inventados. */
function fakeContext(operations: { id: number; date: string; type: string; security: string; grossEur: number }[]) {
	const calls: { method: string; path: string; body?: unknown }[] = [];
	const charts: string[] = [];
	const ctx: ToolContext = {
		async api(method, path, body) {
			calls.push({ method, path, body });
			if (path === '') return { status: 200, body: { portfolios: [{ id: 1, name: 'Prueba' }] } };
			if (path.endsWith('/estado')) return { status: 200, body: { years: [{ year: 2023 }, { year: 2024 }] } };
			const m = path.match(/operaciones\?desde=([\d-]+)&hasta=([\d-]+)/);
			if (method === 'GET' && m) {
				const found = operations.filter((o) => o.date >= m[1] && o.date <= m[2]).map((o) => ({ ...o, account: 'BANCO', taxEur: 0, feesEur: 0 }));
				// Como la API real: como mucho 2 en esta prueba, las más recientes.
				return { status: 200, body: { total: found.length, returned: Math.min(found.length, 2), operations: found.slice(-2) } };
			}
			return { status: 201, body: { saved: true, echo: body } };
		},
		async saveChart(svg, name) {
			charts.push(svg);
			return `/tmp/${name}.svg`;
		}
	};
	return { ctx, calls, charts };
}

const call = (ctx: ToolContext, name: string, args: object) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);

describe('servidor MCP', () => {
	it('responde a initialize y lista las herramientas; ignora notificaciones', async () => {
		const { ctx } = fakeContext([]);
		const init = (await handleMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, ctx)) as { result: { protocolVersion: string } };
		expect(init.result.protocolVersion).toBe('2025-03-26');
		expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx)).toBeNull();
		const list = (await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx)) as { result: { tools: { name: string }[] } };
		expect(list.result.tools.map((t) => t.name)).toContain('anotar_operacion');
		const unknown = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'x' }, ctx)) as { error: { code: number } };
		expect(unknown.error.code).toBe(-32601);
	});

	it('anotar_operacion valida sin guardar salvo que se pida', async () => {
		const { ctx, calls } = fakeContext([]);
		await call(ctx, 'anotar_operacion', { operacion: { type: 'APORTACION', date: '2024-01-01', account: 'BANCO', amount: 100 } });
		expect(calls[0]).toMatchObject({ method: 'POST', path: '/carteras/1/operaciones', body: { dryRun: true } });
		await call(ctx, 'anotar_operacion', { cartera: '2', guardar: true, operacion: { type: 'APORTACION', date: '2024-01-01' } });
		expect(calls[1]).toMatchObject({ path: '/carteras/2/operaciones', body: { dryRun: false } });
	});

	it('borrar_operacion exige confirmar', async () => {
		const { ctx, calls } = fakeContext([]);
		const r = (await call(ctx, 'borrar_operacion', { id: 5 })) as { result: { isError: boolean } };
		expect(r.result.isError).toBe(true);
		expect(calls).toHaveLength(0);
	});

	it('fetchOperations parte por meses un año que no cabe', async () => {
		const ops = ['2024-01-05', '2024-02-05', '2024-02-20', '2024-03-01'].map((date, i) => ({ id: i, date, type: 'DIVIDENDOS', security: 'ACME', grossEur: 1 }));
		const { ctx } = fakeContext(ops);
		expect((await fetchOperations(ctx, 1, '2024-01-01', '2024-12-31')).map((o) => o.date)).toEqual(ops.map((o) => o.date));
	});

	it('dividendos agrega lo leído y dibuja el gráfico', async () => {
		const ops = [
			{ id: 1, date: '2023-05-01', type: 'DIVIDENDOS', security: 'ACME', grossEur: 10 },
			{ id: 2, date: '2024-05-01', type: 'DIVIDENDOS', security: 'ACME', grossEur: 12 },
			{ id: 3, date: '2024-06-01', type: 'COMPRA', security: 'ACME', grossEur: 0 }
		];
		const { ctx, charts } = fakeContext(ops);
		const r = (await call(ctx, 'dividendos', { grafico: 'barras' })) as { result: { content: { text: string }[] } };
		const out = JSON.parse(r.result.content[0].text);
		expect(out.periodos.map((p: { periodo: string; neto: number }) => [p.periodo, p.neto])).toEqual([['2023', 10], ['2024', 12]]);
		expect(out.grafico).toBe('/tmp/dividendos-año.svg');
		expect(charts[0]).toContain('Dividendos netos por año');
	});
});

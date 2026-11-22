/**
 * Herramientas del servidor MCP de investsheet (`/mcp`). Llaman a la lógica de la API para asistentes
 * a través de un `Backend` inyectado: en el servidor, las funciones de `api.ts` sobre la base de datos;
 * en las pruebas, uno falso. La agregación de dividendos está en `dividends.ts`.
 */
import { DIVIDEND_TYPES, RETURN_TYPES, dividendReport, type Breakdown, type DividendRow, type Measure, type Period } from './dividends.ts';

/** Respuesta de la API: código HTTP y cuerpo JSON. */
export interface Reply {
	status: number;
	body: unknown;
}

/** Lo que las herramientas necesitan de la aplicación. Carteras por id o nombre; importes en unidades. */
export interface Backend {
	guide(): Reply;
	securities(): Reply;
	state(portfolio: string, date: string | null): Reply;
	/** Filtros como los de la API (`desde`, `hasta`, `tipo`, `valor`, `cuenta`, `texto`, `limite`). */
	operations(portfolio: string, filters: Record<string, string>): Reply;
	/** Todas las operaciones de una cartera entre dos fechas, sin límite. */
	allOperations(portfolio: string, from: string, to: string): Reply;
	operation(id: number): Reply;
	/** Alta (`id` nulo, en `portfolio`) o sustitución de una operación; el cuerpo es el de la API. */
	save(portfolio: string | null, id: number | null, body: Record<string, unknown>): Reply;
	remove(id: number): Reply;
}

export interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

type Args = Record<string, unknown>;

export interface Tool {
	name: string;
	title: string;
	description: string;
	inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
	annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
	run(args: Args, backend: Backend): ToolResult;
}

const json = (value: unknown, isError = false): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError } : {}) });
/** Respuesta de la API tal cual, marcada como error si no es 2xx. */
const reply = (r: Reply): ToolResult => json(r.status < 300 ? r.body : { status: r.status, ...(r.body as object) }, r.status >= 300);
const fail = (message: string): ToolResult => json({ error: message }, true);

const text = (a: Args, key: string) => (typeof a[key] === 'string' && a[key] !== '' ? (a[key] as string) : undefined);
const portfolioOf = (a: Args) => text(a, 'portfolio') ?? (typeof a.portfolio === 'number' ? String(a.portfolio) : '1');
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v);

const portfolio = { type: 'string', description: 'Id o nombre de la cartera. Si el usuario no la dice, la 1 (principal).' };
const id = { type: 'integer', description: 'Id de la operación.' };
const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

const euros = (c: number) => c / 100;

export const TOOLS: Tool[] = [
	{
		name: 'get_guide',
		title: 'Guía de la API',
		description: 'Carteras con sus cuentas (códigos y moneda), tipos de operación con los campos de cada uno y normas de escritura. Consúltala antes de anotar un tipo de operación poco habitual o si no sabes qué cuentas tiene una cartera.',
		inputSchema: { type: 'object', properties: {} },
		annotations: readOnly,
		run: (_, b) => reply(b.guide())
	},
	{
		name: 'list_securities',
		title: 'Valores',
		description: 'Valores conocidos: ticker, nombre, moneda, retenciones en %, zona, tier, precio objetivo, si están activos y cuántas operaciones los usan.',
		inputSchema: { type: 'object', properties: {} },
		annotations: readOnly,
		run: (_, b) => reply(b.securities())
	},
	{
		name: 'get_portfolio_state',
		title: 'Estado de la cartera',
		description: 'Estado de una cartera a una fecha: saldo de cada cuenta, capital aportado e invertido, resultado del año, posiciones (acciones, coste, coste reducido, precio medio, dividendos brutos y plusvalías realizadas) y métricas por año (capital, bruto, impuestos, gastos, neto, compras). Importes en euros.',
		inputSchema: { type: 'object', properties: { portfolio, date: { type: 'string', description: 'AAAA-MM-DD (inclusive). Por defecto, al final del registro.' } } },
		annotations: readOnly,
		run: (a, b) => {
			const date = text(a, 'date');
			if (date && !DATE.test(date)) return fail('«date» debe ser AAAA-MM-DD.');
			return reply(b.state(portfolioOf(a), date ?? null));
		}
	},
	{
		name: 'search_operations',
		title: 'Buscar operaciones',
		description: 'Operaciones de una cartera que cumplen los filtros, con sus importes en euros (bruto, impuestos, gastos, neto) y movimientos de efectivo. Si hay más que «limit», devuelve las más recientes; «total» dice cuántas cumplen los filtros. Sirve de plantilla: la última operación del mismo tipo y valor da cantidad, precio, moneda y cambio habituales.',
		inputSchema: {
			type: 'object',
			properties: {
				portfolio,
				from: { type: 'string', description: 'AAAA-MM-DD' },
				to: { type: 'string', description: 'AAAA-MM-DD' },
				type: { type: 'string', description: 'Código del tipo: DIVIDENDOS, COMPRA, VENTA, APORTACION…' },
				security: { type: 'string', description: 'Ticker.' },
				account: { type: 'string', description: 'Código de la cuenta.' },
				text: { type: 'string', description: 'Texto que debe contener la descripción.' },
				limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Por defecto 50.' }
			}
		},
		annotations: readOnly,
		run: (a, b) => {
			const filters: Record<string, string> = {};
			const map: [string, string][] = [['from', 'desde'], ['to', 'hasta'], ['type', 'tipo'], ['security', 'valor'], ['account', 'cuenta'], ['text', 'texto']];
			for (const [key, apiKey] of map) if (text(a, key)) filters[apiKey] = text(a, key)!;
			if (typeof a.limit === 'number') filters.limite = String(a.limit);
			return reply(b.operations(portfolioOf(a), filters));
		}
	},
	{
		name: 'get_operation',
		title: 'Ver una operación',
		description: 'Una operación con sus campos tal como se teclearon («fields», listos para reenviarlos a update_operation), sus efectos en efectivo y en posiciones, notas y origen.',
		inputSchema: { type: 'object', properties: { id }, required: ['id'] },
		annotations: readOnly,
		run: (a, b) => reply(b.operation(Number(a.id)))
	},
	{
		name: 'add_operation',
		title: 'Anotar una operación',
		description: [
			'Da de alta una operación (dividendo, compra, venta, aportación, intereses, traspaso, cambio de divisa…).',
			'Sin "save": true solo la valida y devuelve descripción, efectivo, saldos resultantes e importes en euros, SIN GUARDAR: hazlo siempre primero, comprueba que cuadra con lo que dictó el usuario y repite con "save": true.',
			'«operation» lleva «type», «date» (AAAA-MM-DD) y los campos del tipo (ver get_guide): «account» es el código de la cuenta, «security» el ticker; importes en unidades de su moneda («amount» y retenciones en la de «currency»; «fees» y «cashTotal» en la de la cuenta); «fxRate» son unidades de la moneda por euro y no se inventa (el del broker difiere del BCE).',
			'Retenciones: en DEGIRO, DEGIRO2, IBUSD e IBEUR, siempre en origen («whtSource»); en ING y MYINV puede haber también la española en «whtDest».'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				portfolio,
				operation: {
					type: 'object',
					description: 'Campos de la operación. Ejemplo (inventado): {"type":"DIVIDENDOS","date":"2026-03-10","account":"DEGIRO","security":"ACME","quantity":10,"price":0.5,"currency":"USD","fxRate":1.08,"amount":5,"whtSource":0.75}',
					properties: { type: { type: 'string' }, date: { type: 'string' } },
					required: ['type', 'date']
				},
				save: { type: 'boolean', description: 'true para guardarla de verdad; por defecto solo se valida.' },
				confirm: { type: 'boolean', description: 'Acepta los avisos (por ejemplo, saldo negativo). Solo si el usuario los ha aceptado.' },
				createSecurity: { type: 'boolean', description: 'Da de alta el ticker si no existe. Pregunta antes: puede ser una errata.' }
			},
			required: ['operation']
		},
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
		run: (a, b) => {
			if (!isObject(a.operation)) return fail('«operation» debe ser un objeto con los campos de la operación.');
			return reply(b.save(portfolioOf(a), null, { ...a.operation, dryRun: a.save !== true, confirm: a.confirm === true, createSecurity: a.createSecurity === true }));
		}
	},
	{
		name: 'update_operation',
		title: 'Modificar una operación',
		description: 'Sustituye una operación existente. «fields» debe llevar TODOS sus campos: parte de los «fields» de get_operation y cambia lo necesario. Sin "save": true solo valida y enseña el resultado. Las importadas de la hoja antigua solo admiten cambiar fecha, descripción, notas, valor y moneda, con "keepEffects": true.',
		inputSchema: {
			type: 'object',
			properties: {
				id,
				fields: { type: 'object', description: 'Todos los campos de la operación, como en add_operation.' },
				save: { type: 'boolean' },
				confirm: { type: 'boolean' },
				keepEffects: { type: 'boolean', description: 'Para operaciones importadas: cambia solo fecha, descripción, notas, valor y moneda, sin recalcular importes.' }
			},
			required: ['id', 'fields']
		},
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		run: (a, b) => {
			if (!isObject(a.fields)) return fail('«fields» debe ser un objeto.');
			return reply(b.save(null, Number(a.id), { ...a.fields, dryRun: a.save !== true, confirm: a.confirm === true, keepEffects: a.keepEffects === true }));
		}
	},
	{
		name: 'delete_operation',
		title: 'Borrar una operación',
		description: 'Borra una operación. No se puede deshacer: úsala solo si el usuario lo pide expresamente, y enséñale antes la operación con get_operation.',
		inputSchema: { type: 'object', properties: { id, confirm: { type: 'boolean', description: 'Debe ser true.' } }, required: ['id', 'confirm'] },
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		run: (a, b) => (a.confirm === true ? reply(b.remove(Number(a.id))) : fail('Para borrar hay que pasar "confirm": true.'))
	},
	{
		name: 'get_dividends',
		title: 'Dividendos cobrados',
		description: [
			'Dividendos cobrados por año, trimestre o mes (los periodos sin cobros salen a cero), en euros: número de cobros, bruto, retenciones, gastos y neto, con la variación sobre el periodo anterior (en %) y el acumulado de la medida elegida.',
			'Puede desglosarse por valor, cuenta, cartera o tipo (como mucho «maxGroups» grupos; el resto, en «Otros»). Sirve para dibujar la evolución de los dividendos.',
			'El último periodo puede estar incompleto (el año o el mes en curso).'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				portfolio: { type: 'string', description: 'Id o nombre de la cartera, o «all» para todas. Por defecto, la 1.' },
				from: { type: 'string', description: 'AAAA-MM-DD. Por defecto, desde el principio.' },
				to: { type: 'string', description: 'AAAA-MM-DD. Por defecto, hasta hoy.' },
				period: { type: 'string', enum: ['year', 'quarter', 'month'], description: 'Por defecto, year.' },
				measure: { type: 'string', enum: ['net', 'gross'], description: 'La que se usa en variación, acumulado y desglose. Por defecto, net.' },
				breakdown: { type: 'string', enum: ['security', 'account', 'portfolio', 'type'] },
				security: { type: 'string', description: 'Solo los cobros de este ticker.' },
				includeReturns: { type: 'boolean', description: 'Suma también devoluciones de prima y ventas de derechos, como «Cobrado» en el cuadro de cartera.' },
				maxGroups: { type: 'integer', minimum: 1, maximum: 50, description: 'Grupos del desglose (por defecto 8).' }
			}
		},
		annotations: readOnly,
		run: (a, b) => {
			const from = text(a, 'from') ?? '1900-01-01';
			const to = text(a, 'to') ?? new Date().toISOString().slice(0, 10);
			if (!DATE.test(from) || !DATE.test(to)) return fail('«from» y «to» deben ser AAAA-MM-DD.');
			const guide = b.guide();
			const all = (guide.body as { portfolios: { id: number; name: string }[] }).portfolios;
			const key = portfolioOf(a);
			const chosen = key.toLowerCase() === 'all' ? all : all.filter((p) => String(p.id) === key || p.name.toLowerCase() === key.toLowerCase());
			if (!chosen.length) return fail(`No existe la cartera «${key}». Carteras: ${all.map((p) => `${p.id} (${p.name})`).join(', ')}.`);
			const types = new Set([...DIVIDEND_TYPES, ...(a.includeReturns === true ? RETURN_TYPES : [])]);
			const ticker = text(a, 'security')?.toUpperCase();
			const rows: DividendRow[] = [];
			for (const p of chosen) {
				const r = b.allOperations(String(p.id), from, to);
				if (r.status !== 200) return reply(r);
				for (const op of (r.body as { operations: DividendRow[] }).operations) {
					if (types.has(op.type) && (!ticker || op.security?.toUpperCase() === ticker)) rows.push({ ...op, portfolio: p.name });
				}
			}
			const periods: Record<string, Period> = { year: 'año', quarter: 'trimestre', month: 'mes' };
			const breakdowns: Record<string, Breakdown> = { security: 'valor', account: 'cuenta', portfolio: 'cartera', type: 'tipo' };
			const report = dividendReport(rows, {
				period: periods[text(a, 'period') ?? 'year'] ?? 'año',
				measure: (text(a, 'measure') === 'gross' ? 'bruto' : 'neto') as Measure,
				breakdown: breakdowns[text(a, 'breakdown') ?? ''] ?? null,
				maxGroups: typeof a.maxGroups === 'number' ? a.maxGroups : 8
			});
			return json({
				portfolios: chosen.map((p) => p.name),
				measure: report.measure === 'bruto' ? 'gross' : 'net',
				period: text(a, 'period') ?? 'year',
				breakdown: text(a, 'breakdown') ?? null,
				groups: report.groups,
				total: { count: report.total.count, gross: euros(report.total.gross), tax: euros(report.total.tax), fees: euros(report.total.fees), net: euros(report.total.net) },
				periods: report.rows.map((r) => ({
					period: r.period,
					count: r.count,
					gross: euros(r.gross),
					tax: euros(r.tax),
					fees: euros(r.fees),
					net: euros(r.net),
					changePct: r.change == null ? null : Math.round(r.change * 1000) / 10,
					cumulative: euros(r.cumulative),
					...(r.parts ? { breakdown: Object.fromEntries(Object.entries(r.parts).map(([g, v]) => [g, euros(v)])) } : {})
				}))
			});
		}
	}
];

export const INSTRUCTIONS = [
	'Servidor de investsheet, la aplicación de cartera de acciones de dividendos del usuario. Trabaja contra sus datos reales.',
	'Para anotar: reúne tipo, fecha, cuenta, ticker, acciones, importe o precio, retención y cambio (si la moneda no es EUR); lo que falte y sea imprescindible, pregúntalo todo junto. Fecha sin año: el año en curso (o el anterior si quedaría en el futuro). Sin cartera: la 1.',
	'Llama a add_operation sin "save" para validarla, comprueba que bruto, retención y neto cuadran con lo dictado (y con la última operación del mismo valor, vía search_operations), y repite con "save": true. Si responde con avisos, enséñalos y confirma solo si el usuario los acepta.',
	'Para gráficos de dividendos, usa get_dividends y dibuja tú los datos.'
].join('\n');

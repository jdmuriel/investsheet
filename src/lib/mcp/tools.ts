/**
 * Herramientas del servidor MCP de investsheet. Cada una llama a la API (`/api/v1`) a través de un
 * cliente inyectado, de modo que el mismo código sirve para el servidor local (stdio, contra la API de
 * producción) y para probarlo con un cliente falso. Lo que no es la API (agregar dividendos, dibujar)
 * está en `dividends.ts` y `chart.ts`.
 */
import { renderChart, validateChart, type ChartKind, type ChartSpec } from './chart.ts';
import { DIVIDEND_TYPES, RETURN_TYPES, dividendReport, type Breakdown, type DividendRow, type Measure, type Period } from './dividends.ts';

export interface ApiReply {
	status: number;
	body: unknown;
}

/** Acceso a la API y al disco que necesitan las herramientas. */
export interface ToolContext {
	/** `path` relativo a `/api/v1`, con su consulta: `/carteras/1/estado?fecha=2025-12-31`. */
	api(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<ApiReply>;
	/** Guarda un gráfico y devuelve la ruta absoluta donde ha quedado. */
	saveChart(svg: string, name: string, path?: string): Promise<string>;
}

export interface ToolResult {
	content: { type: 'text'; text: string }[];
	isError?: boolean;
}

type Args = Record<string, unknown>;

export interface Tool {
	name: string;
	description: string;
	inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
	run(args: Args, ctx: ToolContext): Promise<ToolResult>;
}

const json = (value: unknown, isError = false): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 1) }], ...(isError ? { isError } : {}) });
/** Respuesta de la API tal cual, marcada como error si no es 2xx. */
const reply = (r: ApiReply): ToolResult => json(r.status < 300 ? r.body : { status: r.status, ...(r.body as object) }, r.status >= 300);
const fail = (message: string): ToolResult => json({ error: message }, true);

const text = (a: Args, key: string) => (typeof a[key] === 'string' && a[key] !== '' ? (a[key] as string) : undefined);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const enc = encodeURIComponent;

function query(params: Record<string, string | number | undefined>): string {
	const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${enc(String(v))}`);
	return parts.length ? `?${parts.join('&')}` : '';
}

const cartera = { type: 'string', description: 'Id o nombre de la cartera. Si el usuario no la dice, la 1 (principal).' };
const id = { type: 'integer', description: 'Id de la operación.' };

/** Las carteras de la guía, con sus ids. */
async function portfolios(ctx: ToolContext): Promise<{ id: number; name: string }[]> {
	const r = await ctx.api('GET', '');
	if (r.status !== 200) throw new Error(`La API respondió ${r.status} al pedir la guía.`);
	return (r.body as { portfolios: { id: number; name: string }[] }).portfolios;
}

interface ApiOperation extends DividendRow {
	id: number;
}

/**
 * Todas las operaciones de una cartera entre dos fechas. La API devuelve como mucho 500 por consulta,
 * así que se piden por años y, si un año no cabe, por meses.
 */
export async function fetchOperations(ctx: ToolContext, portfolio: string | number, from: string, to: string): Promise<ApiOperation[]> {
	const get = async (desde: string, hasta: string) => {
		const r = await ctx.api('GET', `/carteras/${enc(String(portfolio))}/operaciones${query({ desde, hasta, limite: 500 })}`);
		if (r.status !== 200) throw new Error(`La API respondió ${r.status}: ${JSON.stringify(r.body)}`);
		return r.body as { total: number; returned: number; operations: ApiOperation[] };
	};
	const out: ApiOperation[] = [];
	for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
		const start = year === Number(from.slice(0, 4)) ? from : `${year}-01-01`;
		const end = year === Number(to.slice(0, 4)) ? to : `${year}-12-31`;
		const page = await get(start, end);
		if (page.total <= page.returned) {
			out.push(...page.operations);
			continue;
		}
		for (let m = Number(start.slice(5, 7)); m <= Number(end.slice(5, 7)); m++) {
			const mm = String(m).padStart(2, '0');
			const monthStart = `${year}-${mm}-01` < start ? start : `${year}-${mm}-01`;
			const monthEnd = `${year}-${mm}-31` > end ? end : `${year}-${mm}-31`;
			const month = await get(monthStart, monthEnd);
			if (month.total > month.returned) throw new Error(`Más de 500 operaciones en ${year}-${mm}: no se pueden leer todas.`);
			out.push(...month.operations);
		}
	}
	return out;
}

const euros = (c: number) => c / 100;

export const TOOLS: Tool[] = [
	{
		name: 'guia',
		description: 'Guía de la API de investsheet: carteras con sus cuentas (códigos), tipos de operación con los campos de cada uno y normas de escritura. Consúltala antes de anotar un tipo de operación poco habitual.',
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
		run: async (_, ctx) => reply(await ctx.api('GET', ''))
	},
	{
		name: 'valores',
		description: 'Valores conocidos (ticker, nombre, moneda, retenciones en %, zona, tier, precio objetivo, si están activos y cuántas operaciones los usan).',
		inputSchema: { type: 'object', properties: {} },
		annotations: { readOnlyHint: true },
		run: async (_, ctx) => reply(await ctx.api('GET', '/valores'))
	},
	{
		name: 'estado_cartera',
		description: 'Estado de una cartera a una fecha: saldo de cada cuenta, capital aportado e invertido, resultado del año, posiciones (acciones, coste, coste reducido, precio medio, dividendos brutos y plusvalías realizadas) y métricas por año (capital, bruto, impuestos, gastos, neto, compras). Importes en euros.',
		inputSchema: { type: 'object', properties: { cartera, fecha: { type: 'string', description: 'AAAA-MM-DD (inclusive). Por defecto, al final del registro.' } } },
		annotations: { readOnlyHint: true },
		run: async (a, ctx) => {
			const fecha = text(a, 'fecha');
			if (fecha && !DATE.test(fecha)) return fail('«fecha» debe ser AAAA-MM-DD.');
			return reply(await ctx.api('GET', `/carteras/${enc(text(a, 'cartera') ?? '1')}/estado${query({ fecha })}`));
		}
	},
	{
		name: 'buscar_operaciones',
		description: 'Operaciones de una cartera que cumplen los filtros, con sus importes en euros (bruto, impuestos, gastos, neto) y movimientos de efectivo. Si hay más que «limite», devuelve las más recientes; «total» dice cuántas cumplen los filtros. Sirve también de plantilla: la última operación del mismo tipo y valor da cantidad, precio, moneda y cambio habituales.',
		inputSchema: {
			type: 'object',
			properties: {
				cartera,
				desde: { type: 'string', description: 'AAAA-MM-DD' },
				hasta: { type: 'string', description: 'AAAA-MM-DD' },
				tipo: { type: 'string', description: 'Código del tipo: DIVIDENDOS, COMPRA, VENTA, APORTACION…' },
				valor: { type: 'string', description: 'Ticker.' },
				cuenta: { type: 'string', description: 'Código de la cuenta.' },
				texto: { type: 'string', description: 'Texto que debe contener la descripción.' },
				limite: { type: 'integer', minimum: 1, maximum: 500, description: 'Por defecto 50.' }
			}
		},
		annotations: { readOnlyHint: true },
		run: async (a, ctx) => {
			const q = query({ desde: text(a, 'desde'), hasta: text(a, 'hasta'), tipo: text(a, 'tipo'), valor: text(a, 'valor'), cuenta: text(a, 'cuenta'), texto: text(a, 'texto'), limite: typeof a.limite === 'number' ? a.limite : undefined });
			return reply(await ctx.api('GET', `/carteras/${enc(text(a, 'cartera') ?? '1')}/operaciones${q}`));
		}
	},
	{
		name: 'ver_operacion',
		description: 'Una operación con sus campos tal como se teclearon («fields», listos para reenviarlos al modificarla), sus efectos en efectivo y en posiciones, notas y origen.',
		inputSchema: { type: 'object', properties: { id }, required: ['id'] },
		annotations: { readOnlyHint: true },
		run: async (a, ctx) => reply(await ctx.api('GET', `/operaciones/${Number(a.id)}`))
	},
	{
		name: 'anotar_operacion',
		description: [
			'Da de alta una operación (dividendo, compra, venta, aportación, intereses, traspaso, cambio de divisa…).',
			'Sin «guardar» solo la valida y devuelve descripción, efectivo, saldos resultantes e importes en euros, SIN GUARDAR: hazlo siempre primero, comprueba que cuadra con lo que dictó el usuario y repite con "guardar": true.',
			'«operacion» lleva «type», «date» (AAAA-MM-DD) y los campos del tipo (ver la herramienta «guia»): «account» es el código de la cuenta, «security» el ticker; importes en unidades de su moneda («amount» y retenciones en la de «currency»; «fees» y «cashTotal» en la de la cuenta); «fxRate» son unidades de la moneda por euro y no se inventa (el del broker difiere del BCE).',
			'Retenciones: en DEGIRO, DEGIRO2, IBUSD e IBEUR, siempre en origen («whtSource»); en ING y MYINV puede haber también la española en «whtDest».'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				cartera,
				operacion: {
					type: 'object',
					description: 'Campos de la operación. Ejemplo (inventado): {"type":"DIVIDENDOS","date":"2026-03-10","account":"DEGIRO","security":"ACME","quantity":10,"price":0.5,"currency":"USD","fxRate":1.08,"amount":5,"whtSource":0.75}',
					properties: { type: { type: 'string' }, date: { type: 'string' } },
					required: ['type', 'date']
				},
				guardar: { type: 'boolean', description: 'true para guardarla de verdad; por defecto solo se valida.' },
				confirmar: { type: 'boolean', description: 'Acepta los avisos (por ejemplo, saldo negativo). Solo si el usuario los ha aceptado.' },
				crearValor: { type: 'boolean', description: 'Da de alta el ticker si no existe. Pregunta antes: puede ser una errata.' }
			},
			required: ['operacion']
		},
		annotations: { readOnlyHint: false, destructiveHint: false },
		run: async (a, ctx) => {
			if (a.operacion == null || typeof a.operacion !== 'object' || Array.isArray(a.operacion)) return fail('«operacion» debe ser un objeto con los campos de la operación.');
			const body = { ...(a.operacion as object), dryRun: a.guardar !== true, confirm: a.confirmar === true || undefined, createSecurity: a.crearValor === true || undefined };
			return reply(await ctx.api('POST', `/carteras/${enc(text(a, 'cartera') ?? '1')}/operaciones`, body));
		}
	},
	{
		name: 'modificar_operacion',
		description: 'Sustituye una operación existente. «campos» debe llevar TODOS sus campos: parte de los «fields» de «ver_operacion» y cambia lo necesario. Sin «guardar» solo valida y enseña el resultado. Las importadas de la hoja antigua solo admiten cambiar fecha, descripción, notas, valor y moneda, con «mantenerEfectos».',
		inputSchema: {
			type: 'object',
			properties: {
				id,
				campos: { type: 'object', description: 'Todos los campos de la operación, como en «anotar_operacion».' },
				guardar: { type: 'boolean' },
				confirmar: { type: 'boolean' },
				mantenerEfectos: { type: 'boolean', description: 'Para operaciones importadas: cambia solo fecha, descripción, notas, valor y moneda, sin recalcular importes.' }
			},
			required: ['id', 'campos']
		},
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
		run: async (a, ctx) => {
			if (a.campos == null || typeof a.campos !== 'object' || Array.isArray(a.campos)) return fail('«campos» debe ser un objeto.');
			const body = { ...(a.campos as object), dryRun: a.guardar !== true, confirm: a.confirmar === true || undefined, keepEffects: a.mantenerEfectos === true || undefined };
			return reply(await ctx.api('PUT', `/operaciones/${Number(a.id)}`, body));
		}
	},
	{
		name: 'borrar_operacion',
		description: 'Borra una operación. No se puede deshacer: úsala solo si el usuario lo pide expresamente, y enséñale antes la operación con «ver_operacion».',
		inputSchema: { type: 'object', properties: { id, confirmar: { type: 'boolean', description: 'Debe ser true.' } }, required: ['id', 'confirmar'] },
		annotations: { readOnlyHint: false, destructiveHint: true },
		run: async (a, ctx) => {
			if (a.confirmar !== true) return fail('Para borrar hay que pasar "confirmar": true.');
			return reply(await ctx.api('DELETE', `/operaciones/${Number(a.id)}?confirm=1`, {}));
		}
	},
	{
		name: 'dividendos',
		description: [
			'Dividendos cobrados por año, trimestre o mes (los periodos sin cobros salen a cero), en euros: número de cobros, bruto, retenciones, gastos y neto, con la variación sobre el periodo anterior y el acumulado de la medida elegida.',
			'Puede desglosarse por valor, cuenta, cartera o tipo (como mucho «maxGrupos» grupos; el resto, en «Otros») y dibujar el gráfico de una vez.',
			'El último periodo puede estar incompleto (el año o el mes en curso).'
		].join(' '),
		inputSchema: {
			type: 'object',
			properties: {
				cartera: { type: 'string', description: 'Id o nombre de la cartera, o «todas». Por defecto, la 1.' },
				desde: { type: 'string', description: 'AAAA-MM-DD. Por defecto, desde el principio.' },
				hasta: { type: 'string', description: 'AAAA-MM-DD. Por defecto, hasta hoy.' },
				agrupar: { type: 'string', enum: ['año', 'trimestre', 'mes'], description: 'Por defecto, año.' },
				medida: { type: 'string', enum: ['neto', 'bruto'], description: 'La que se usa en variación, acumulado, desglose y gráfico. Por defecto, neto.' },
				desglose: { type: 'string', enum: ['valor', 'cuenta', 'cartera', 'tipo'] },
				valor: { type: 'string', description: 'Solo los cobros de este ticker.' },
				incluirDevoluciones: { type: 'boolean', description: 'Suma también devoluciones de prima y ventas de derechos, como «Cobrado» en el cuadro de cartera.' },
				maxGrupos: { type: 'integer', minimum: 1, maximum: 8, description: 'Grupos del desglose (por defecto 8).' },
				grafico: { type: 'string', enum: ['barras', 'barras_apiladas', 'lineas', 'acumulado'], description: 'Dibuja además el gráfico en SVG y devuelve su ruta. «acumulado» es la línea del acumulado.' },
				ruta: { type: 'string', description: 'Dónde guardar el gráfico (.svg). Por defecto, en data/graficos/.' }
			}
		},
		annotations: { readOnlyHint: true },
		run: async (a, ctx) => {
			const desde = text(a, 'desde') ?? '2000-01-01';
			const hasta = text(a, 'hasta') ?? new Date().toISOString().slice(0, 10);
			if (!DATE.test(desde) || !DATE.test(hasta)) return fail('«desde» y «hasta» deben ser AAAA-MM-DD.');
			const all = await portfolios(ctx);
			const key = text(a, 'cartera') ?? '1';
			const chosen = key.toLowerCase() === 'todas' ? all : all.filter((p) => String(p.id) === key || p.name.toLowerCase() === key.toLowerCase());
			if (!chosen.length) return fail(`No existe la cartera «${key}». Carteras: ${all.map((p) => `${p.id} (${p.name})`).join(', ')}.`);
			// Sin «desde», se empieza en el primer año con actividad de cada cartera.
			const types = new Set([...DIVIDEND_TYPES, ...(a.incluirDevoluciones === true ? RETURN_TYPES : [])]);
			const ticker = text(a, 'valor')?.toUpperCase();
			const rows: DividendRow[] = [];
			for (const p of chosen) {
				let from = desde;
				if (!text(a, 'desde')) {
					const state = await ctx.api('GET', `/carteras/${p.id}/estado`);
					const years = (state.body as { years?: { year: number }[] }).years ?? [];
					if (years.length) from = `${Math.min(...years.map((y) => y.year))}-01-01`;
				}
				if (from > hasta) continue;
				for (const op of await fetchOperations(ctx, p.id, from, hasta)) {
					if (types.has(op.type) && (!ticker || op.security?.toUpperCase() === ticker)) rows.push({ ...op, portfolio: p.name });
				}
			}
			const report = dividendReport(rows, {
				period: (text(a, 'agrupar') as Period) ?? 'año',
				measure: (text(a, 'medida') as Measure) ?? 'neto',
				breakdown: (text(a, 'desglose') as Breakdown) ?? null,
				maxGroups: typeof a.maxGrupos === 'number' ? a.maxGrupos : 8
			});
			const result: Record<string, unknown> = {
				carteras: chosen.map((p) => p.name),
				medida: report.measure,
				agrupar: report.period,
				desglose: report.breakdown,
				grupos: report.groups,
				total: { cobros: report.total.count, bruto: euros(report.total.gross), retenciones: euros(report.total.tax), gastos: euros(report.total.fees), neto: euros(report.total.net) },
				periodos: report.rows.map((r) => ({
					periodo: r.period,
					cobros: r.count,
					bruto: euros(r.gross),
					retenciones: euros(r.tax),
					gastos: euros(r.fees),
					neto: euros(r.net),
					variacion: r.change == null ? null : Math.round(r.change * 1000) / 10,
					acumulado: euros(r.cumulative),
					...(r.parts ? { desglose: Object.fromEntries(Object.entries(r.parts).map(([g, v]) => [g, euros(v)])) } : {})
				}))
			};
			const kind = text(a, 'grafico');
			if (kind && report.rows.length) {
				const measureName = report.measure === 'bruto' ? 'brutos' : 'netos';
				const scope = chosen.length > 1 ? 'todas las carteras' : `cartera ${chosen[0].name}`;
				const periodName = { año: 'año', trimestre: 'trimestre', mes: 'mes' }[report.period];
				const labels = report.rows.map((r) => r.period);
				const spec: ChartSpec =
					kind === 'acumulado'
						? { title: `Dividendos ${measureName} acumulados`, kind: 'lineas', labels, series: [{ name: 'Acumulado', values: report.rows.map((r) => euros(r.cumulative)) }], unit: '€' }
						: {
								title: `Dividendos ${measureName} por ${periodName}${ticker ? ` · ${ticker}` : ''}`,
								kind: (report.breakdown && kind === 'barras' ? 'barras_apiladas' : kind) as ChartKind,
								labels,
								series: report.breakdown
									? report.groups.map((g) => ({ name: g, values: report.rows.map((r) => euros(r.parts![g])) }))
									: [{ name: 'Dividendos', values: report.rows.map((r) => euros(report.measure === 'bruto' ? r.gross : r.net)) }],
								unit: '€'
							};
				spec.subtitle = `En euros · ${scope}${a.incluirDevoluciones === true ? ' · con devoluciones de prima y venta de derechos' : ''} · ${labels[0]} a ${labels.at(-1)}`;
				result.grafico = await ctx.saveChart(renderChart(spec), `dividendos-${report.period}${report.breakdown ? `-${report.breakdown}` : ''}`, text(a, 'ruta'));
			}
			return json(result);
		}
	},
	{
		name: 'grafico',
		description: 'Dibuja un gráfico en SVG (barras, barras apiladas o líneas, con modo claro y oscuro y el valor de cada punto al pasar el ratón) con los datos que se le den, y devuelve la ruta del fichero. Para dividendos es más directo «dividendos» con «grafico». Una sola escala: no mezcles medidas de distinta magnitud; como mucho 8 series.',
		inputSchema: {
			type: 'object',
			properties: {
				titulo: { type: 'string' },
				subtitulo: { type: 'string' },
				tipo: { type: 'string', enum: ['barras', 'barras_apiladas', 'lineas'] },
				etiquetas: { type: 'array', items: { type: 'string' }, description: 'Eje horizontal (periodos, tickers…).' },
				series: {
					type: 'array',
					items: { type: 'object', properties: { nombre: { type: 'string' }, valores: { type: 'array', items: { type: ['number', 'null'] } } }, required: ['nombre', 'valores'] }
				},
				unidad: { type: 'string', description: '«€», «%»… Se añade a los valores.' },
				ruta: { type: 'string', description: 'Dónde guardarlo (.svg). Por defecto, en data/graficos/.' }
			},
			required: ['titulo', 'tipo', 'etiquetas', 'series']
		},
		annotations: { readOnlyHint: true },
		run: async (a, ctx) => {
			const series = Array.isArray(a.series) ? (a.series as { nombre?: unknown; valores?: unknown }[]) : [];
			const spec: ChartSpec = {
				title: String(a.titulo ?? ''),
				subtitle: text(a, 'subtitulo'),
				kind: a.tipo as ChartKind,
				labels: Array.isArray(a.etiquetas) ? a.etiquetas.map(String) : [],
				series: series.map((s) => ({ name: String(s.nombre ?? ''), values: Array.isArray(s.valores) ? (s.valores as (number | null)[]) : [] })),
				unit: text(a, 'unidad')
			};
			const errors = validateChart(spec);
			if (errors.length) return fail(errors.join(' '));
			return json({ grafico: await ctx.saveChart(renderChart(spec), spec.title, text(a, 'ruta')) });
		}
	}
];

export const INSTRUCTIONS = [
	'Servidor de investsheet, la aplicación de cartera de acciones de dividendos del usuario. Trabaja contra los datos reales de producción.',
	'Para anotar: reúne tipo, fecha, cuenta, ticker, acciones, importe o precio, retención y cambio (si la moneda no es EUR); lo que falte y sea imprescindible, pregúntalo todo junto. Fecha sin año: el año en curso (o el anterior si quedaría en el futuro).',
	'Llama a «anotar_operacion» sin «guardar» para validarla, comprueba que bruto, retención y neto cuadran con lo dictado (y con la última operación del mismo valor, vía «buscar_operaciones»), y repite con "guardar": true. Si responde con avisos, enséñalos y confirma solo si el usuario los acepta.',
	'Para gráficos de dividendos usa «dividendos» con «grafico»; para otros, «grafico» con los datos. Devuelven la ruta de un SVG: enséñaselo al usuario.',
	'Los importes reales no se escriben en el repositorio (código, documentación ni commits): el repositorio es público.'
].join('\n');

/**
 * Servidor MCP local de investsheet (transporte stdio) contra la API de producción.
 * Lo arranca Claude Code según `.mcp.json`; uso y configuración en `docs/mcp.md`.
 *
 * Variables:
 * - INVESTSHEET_URL: base de la API (por defecto, la de producción).
 * - INVESTSHEET_TOKEN: token de la API. En la nube de Claude Code no hace falta: el proxy lo inyecta.
 * - NODE_USE_ENV_PROXY=1: para que `fetch` use el proxy de la sesión (lo pone `.mcp.json`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { handleMessage } from '../src/lib/mcp/protocol.ts';
import type { ToolContext } from '../src/lib/mcp/tools.ts';

const BASE = (process.env.INVESTSHEET_URL ?? 'https://invest.jdmuriel.com/api/v1').replace(/\/$/, '');
const TOKEN = process.env.INVESTSHEET_TOKEN;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `data/` está fuera del repositorio: los gráficos llevan importes reales.
const CHART_DIR = join(ROOT, 'data', 'graficos');

const slug = (s: string) =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '') || 'grafico';

const ctx: ToolContext = {
	async api(method, path, body) {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
		if (method !== 'GET') headers['Content-Type'] = 'application/json';
		const res = await fetch(BASE + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30_000) });
		const textBody = await res.text();
		let parsed: unknown;
		try {
			parsed = JSON.parse(textBody);
		} catch {
			parsed = { error: textBody.slice(0, 500) };
		}
		if (res.status === 401) parsed = { ...(parsed as object), ayuda: 'Sin token válido: en la nube, falta el secreto de red del entorno para el host de la aplicación; en local, la variable INVESTSHEET_TOKEN.' };
		return { status: res.status, body: parsed };
	},
	async saveChart(svg, name, path) {
		const file = path ? (isAbsolute(path) ? path : resolve(process.cwd(), path)) : join(CHART_DIR, `${slug(name)}.svg`);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, svg);
		return file;
	}
};

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', async (line) => {
	if (!line.trim()) return;
	let message: unknown;
	try {
		message = JSON.parse(line);
	} catch {
		send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido.' } });
		return;
	}
	// Un lote (array) se responde con un array.
	if (Array.isArray(message)) {
		const replies = (await Promise.all(message.map((m) => handleMessage(m, ctx)))).filter((r) => r != null);
		if (replies.length) send(replies);
		return;
	}
	const reply = await handleMessage(message, ctx);
	if (reply) send(reply);
});

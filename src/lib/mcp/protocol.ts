/**
 * Protocolo MCP (JSON-RPC 2.0) reducido a lo que usa un servidor de herramientas: `initialize`,
 * `tools/list`, `tools/call` y `ping`. Independiente del transporte (la ruta `/mcp` lo sirve por
 * Streamable HTTP sin sesiones): recibe un mensaje ya interpretado y devuelve la respuesta, o `null`
 * para las notificaciones.
 */
import { INSTRUCTIONS, TOOLS, type Backend, type Tool } from './tools.ts';

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const SERVER_INFO = { name: 'investsheet', version: '1.0.0' };

interface Request {
	jsonrpc: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

export type Response = { jsonrpc: '2.0'; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string } });

const describe = (t: Tool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations });

export function handleMessage(message: unknown, backend: Backend, tools: Tool[] = TOOLS): Response | null {
	const req = message as Request;
	if (req == null || typeof req !== 'object' || typeof req.method !== 'string') {
		return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Petición no válida.' } };
	}
	// Las notificaciones (sin id) no llevan respuesta.
	if (req.id === undefined) return null;
	const id = req.id;
	const result = (value: unknown): Response => ({ jsonrpc: '2.0', id, result: value });
	const error = (code: number, text: string): Response => ({ jsonrpc: '2.0', id, error: { code, message: text } });

	switch (req.method) {
		case 'initialize': {
			const asked = String(req.params?.protocolVersion ?? '');
			return result({
				protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER_INFO,
				instructions: INSTRUCTIONS
			});
		}
		case 'ping':
			return result({});
		case 'tools/list':
			return result({ tools: tools.map(describe) });
		case 'tools/call': {
			const name = req.params?.name;
			const tool = tools.find((t) => t.name === name);
			if (!tool) return error(-32602, `Herramienta desconocida: ${String(name)}.`);
			const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
			try {
				return result(tool.run(args, backend));
			} catch (e) {
				// Un fallo de la herramienta se devuelve como resultado con error, para que el modelo lo vea.
				return result({ content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
			}
		}
		default:
			return error(-32601, `Método no admitido: ${req.method}.`);
	}
}

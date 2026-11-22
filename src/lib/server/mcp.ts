/**
 * Servidor MCP en `/mcp`: las herramientas de `src/lib/mcp/` sobre la lógica de la API (`api.ts`),
 * dentro del mismo proceso. El acceso (OAuth o `API_TOKEN`) lo comprueba `hooks.server.ts`.
 */
import type { DatabaseSync } from 'node:sqlite';
import { handleMessage, SUPPORTED_VERSIONS, type Response as RpcResponse } from '../mcp/protocol.ts';
import type { Backend, Reply } from '../mcp/tools.ts';
import { apiDelete, apiIndex, apiOperation, apiOperations, apiSave, apiSecurities, apiState, findPortfolio } from './api.ts';
import { getOperation } from './operations.ts';

export function serverBackend(db: DatabaseSync): Backend {
	const withPortfolio = (key: string, work: (id: number) => Reply): Reply => {
		const p = findPortfolio(db, key);
		return p ? work(p.id) : { status: 404, body: { error: `No existe la cartera «${key}».` } };
	};
	return {
		guide: () => apiIndex(db),
		securities: () => apiSecurities(db),
		state: (portfolio, date) => withPortfolio(portfolio, (id) => apiState(db, id, date)),
		operations: (portfolio, filters) => withPortfolio(portfolio, (id) => apiOperations(db, id, new URLSearchParams(filters))),
		allOperations: (portfolio, from, to) =>
			withPortfolio(portfolio, (id) => apiOperations(db, id, new URLSearchParams({ desde: from, hasta: to, limite: String(Number.MAX_SAFE_INTEGER) }), Number.MAX_SAFE_INTEGER)),
		operation: (id) => apiOperation(db, id),
		save: (portfolio, id, body) => {
			if (id == null) return withPortfolio(portfolio ?? '1', (p) => apiSave(db, p, null, body));
			const record = getOperation(db, id);
			return record ? apiSave(db, record.portfolioId, id, body) : { status: 404, body: { error: 'Operación no encontrada.' } };
		},
		remove: (id) => apiDelete(db, id, true)
	};
}

/**
 * Transporte Streamable HTTP sin sesiones: cada `POST` lleva un mensaje JSON-RPC (o un lote) y se
 * responde con JSON; si solo había notificaciones, 202 sin cuerpo. No hay flujo SSE (`GET` da 405).
 */
export function mcpPost(db: DatabaseSync, body: unknown, protocolVersion: string | null): { status: number; body?: unknown } {
	if (protocolVersion && !SUPPORTED_VERSIONS.includes(protocolVersion)) {
		return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Versión del protocolo no admitida: ${protocolVersion}.` } } };
	}
	if (body === undefined) return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido.' } } };
	const backend = serverBackend(db);
	if (Array.isArray(body)) {
		const replies = body.map((m) => handleMessage(m, backend)).filter((r): r is RpcResponse => r != null);
		return replies.length ? { status: 200, body: replies } : { status: 202 };
	}
	const reply = handleMessage(body, backend);
	return reply ? { status: 200, body: reply } : { status: 202 };
}

import { mcpPost } from '#lib/server/mcp.ts';
import { readBody } from '#lib/server/api-http.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

// El acceso (token OAuth o API_TOKEN) se comprueba en hooks.server.ts.
export const POST: RequestHandler = async ({ request }) => {
	const result = mcpPost(getDb(), await readBody(request), request.headers.get('mcp-protocol-version'));
	if (result.body === undefined) return new Response(null, { status: result.status });
	return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json' } });
};

// Sin flujo de eventos del servidor ni sesiones que cerrar.
const notAllowed: RequestHandler = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = notAllowed;
export const DELETE = notAllowed;

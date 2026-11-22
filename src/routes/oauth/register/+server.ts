import { readBody } from '#lib/server/api-http.ts';
import { registerClient } from '#lib/server/oauth.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };

/** Registro dinámico de clientes (RFC 7591). Público: el acceso lo da después el propietario. */
export const POST: RequestHandler = async ({ request }) => {
	const result = registerClient(getDb(), await readBody(request));
	return Response.json(result.body, { status: result.status, headers: cors });
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: { ...cors, 'access-control-allow-methods': 'POST' } });

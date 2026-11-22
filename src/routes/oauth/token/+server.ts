import { tokenRequest } from '#lib/server/oauth.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };

/** Punto de canje de tokens (RFC 6749 §3.2): formulario `application/x-www-form-urlencoded`. */
export const POST: RequestHandler = async ({ request, url }) => {
	let form: URLSearchParams;
	try {
		form = new URLSearchParams(await request.text());
	} catch {
		form = new URLSearchParams();
	}
	const result = tokenRequest(getDb(), form, url.origin);
	return Response.json(result.body, { status: result.status, headers });
};

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST' } });

import { apiPatchDividendChange } from '#lib/server/api.ts';
import { operationId, readBody, send } from '#lib/server/api-http.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = operationId(params.id);
	return send(id == null ? { status: 404, body: { error: 'Ese cambio de dividendo no existe.' } } : apiPatchDividendChange(getDb(), id, await readBody(request)));
};

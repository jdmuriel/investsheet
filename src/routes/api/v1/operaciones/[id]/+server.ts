import { apiDelete, apiOperation, apiSave } from '#lib/server/api.ts';
import { operationId, readBody, send } from '#lib/server/api-http.ts';
import { getOperation } from '#lib/server/operations.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

const notFound = { status: 404, body: { error: 'Operación no encontrada.' } };

export const GET: RequestHandler = ({ params }) => {
	const id = operationId(params.id);
	return send(id == null ? notFound : apiOperation(getDb(), id));
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const id = operationId(params.id);
	const record = id == null ? null : getOperation(getDb(), id);
	if (!record) return send(notFound);
	return send(apiSave(getDb(), record.portfolioId, record.id, await readBody(request)));
};

export const DELETE: RequestHandler = ({ params, url }) => {
	const id = operationId(params.id);
	return send(id == null ? notFound : apiDelete(getDb(), id, url.searchParams.get('confirm') === '1'));
};

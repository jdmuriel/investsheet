import { apiOperations, apiSave } from '#lib/server/api.ts';
import { readBody, withPortfolio } from '#lib/server/api-http.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => withPortfolio(params.cartera, (id) => apiOperations(getDb(), id, url.searchParams));

export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readBody(request);
	return withPortfolio(params.cartera, (id) => apiSave(getDb(), id, null, body));
};

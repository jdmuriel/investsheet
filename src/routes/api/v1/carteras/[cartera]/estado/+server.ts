import { apiState } from '#lib/server/api.ts';
import { withPortfolio } from '#lib/server/api-http.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url }) => withPortfolio(params.cartera, (id) => apiState(getDb(), id, url.searchParams.get('fecha')));

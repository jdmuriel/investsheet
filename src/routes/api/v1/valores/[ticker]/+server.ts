import { apiDeleteSecurity, apiPatchSecurity } from '#lib/server/api.ts';
import { readBody, send } from '#lib/server/api-http.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => send(apiPatchSecurity(getDb(), params.ticker, await readBody(request)));

export const DELETE: RequestHandler = ({ params, url }) => send(apiDeleteSecurity(getDb(), params.ticker, url.searchParams.get('confirm') === '1'));

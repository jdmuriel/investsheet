import { apiDividendChanges } from '#lib/server/api.ts';
import { send } from '#lib/server/api-http.ts';
import { getDb } from '#lib/server/store.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => send(apiDividendChanges(getDb(), url.searchParams.get('valor')));

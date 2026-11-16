import { listSecurityRecords } from '#lib/server/masters.ts';
import { getDb } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({ securities: listSecurityRecords(getDb()), savedId: Number(url.searchParams.get('guardado')) || null });

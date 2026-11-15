import { fail } from '@sveltejs/kit';
import { getDb, restoreDatabase } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const db = getDb();
	const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
	return { portfolios: count('portfolio'), operations: count('operation'), securities: count('security') };
};

export const actions: Actions = {
	restaurar: async ({ request }) => {
		const file = (await request.formData()).get('fichero');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Elige un fichero de copia (.db).' });
		try {
			return { restored: restoreDatabase(new Uint8Array(await file.arrayBuffer())) };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'No se pudo restaurar.' });
		}
	}
};

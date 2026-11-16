import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail } from '@sveltejs/kit';
import { applyExtras, readExtras } from '#lib/server/legacy-extras.ts';
import { getDb, restoreDatabase } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const db = getDb();
	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
	const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
	return { today, portfolios: count('portfolio'), operations: count('operation'), securities: count('security') };
};

const todayInMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

export const actions: Actions = {
	/** Completa la base con los datos de la hoja antigua que no son operaciones, sin pisar nada. */
	hoja: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('hoja');
		const date = String(form.get('fecha') || todayInMadrid());
		if (!(file instanceof File) || file.size === 0) return fail(400, { sheetError: 'Elige la copia de la hoja (.xlsx).' });
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date > todayInMadrid()) return fail(400, { sheetError: 'La fecha de los precios no es válida.' });
		// El lector trabaja sobre un fichero: se guarda en una carpeta temporal mientras se lee.
		const dir = join(tmpdir(), 'investsheet');
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `hoja-${Date.now()}.xlsx`);
		writeFileSync(path, new Uint8Array(await file.arrayBuffer()));
		try {
			const extras = await readExtras(path);
			if (extras.securities.length === 0 && extras.changes.length === 0 && extras.goals.length === 0) return fail(400, { sheetError: 'El libro no tiene las solapas «Log», «Control cartera» ni «Variación divs».' });
			return { sheet: applyExtras(getDb(), extras, date), sheetDate: date };
		} catch {
			return fail(400, { sheetError: 'No se ha podido leer la hoja: debe ser un libro .xlsx.' });
		} finally {
			rmSync(path, { force: true });
		}
	},
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

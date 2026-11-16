import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/store.ts';
import { exportValidation, readReference } from '#lib/server/validation.ts';
import type { RequestHandler } from './$types';

const todayInMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

async function respond(reference?: Awaited<ReturnType<typeof readReference>>, from?: string): Promise<Response> {
	const today = todayInMadrid();
	const { data } = await exportValidation(getDb(), { reference, from, today });
	return new Response(data as BodyInit, {
		headers: {
			'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'content-disposition': `attachment; filename="validacion-${today}.xlsx"`,
			'cache-control': 'no-store'
		}
	});
}

/** Solo el registro con el formato de la hoja. */
export const GET: RequestHandler = () => respond();

/** Con una copia de la hoja como referencia: añade la solapa de diferencias. */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const file = form.get('referencia');
	const from = String(form.get('desde') ?? '');
	if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) error(400, 'La fecha «desde» no es válida.');
	if (!(file instanceof File) || file.size === 0) return respond(undefined, from || undefined);

	// El lector trabaja sobre un fichero: se guarda en una carpeta temporal mientras se lee.
	const dir = join(tmpdir(), 'investsheet');
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `referencia-${Date.now()}.xlsx`);
	writeFileSync(path, new Uint8Array(await file.arrayBuffer()));
	let reference: Awaited<ReturnType<typeof readReference>>;
	try {
		reference = await readReference(path);
	} catch {
		error(400, 'No se ha podido leer la hoja de referencia: debe ser un libro .xlsx.');
	} finally {
		rmSync(path, { force: true });
	}
	if (reference.size === 0) error(400, 'La hoja de referencia no tiene ninguna solapa «Log».');
	return respond(reference, from || undefined);
};

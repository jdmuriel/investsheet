import { error, fail, redirect } from '@sveltejs/kit';
import { CURRENCIES, getSecurityRecord, saveSecurity } from '#lib/server/masters.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

function recordFrom(param: string) {
	if (param === 'nuevo') return null;
	const record = /^\d+$/.test(param) ? getSecurityRecord(getDb(), Number(param)) : null;
	if (!record) error(404, 'Valor no encontrado');
	return record;
}

export const load: PageServerLoad = ({ params }) => ({ security: recordFrom(params.id), currencies: CURRENCIES });

export const actions: Actions = {
	default: async ({ request, params }) => {
		const record = recordFrom(params.id);
		const raw = rawFromForm(await request.formData());
		const result = saveSecurity(getDb(), record?.id ?? null, raw);
		if (!result.ok) return fail(400, { errors: result.errors, raw });
		redirect(303, `/ajustes/valores?guardado=${result.id}`);
	}
};

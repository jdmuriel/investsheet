import { error, fail, redirect } from '@sveltejs/kit';
import { isOperationType } from '#lib/engine/operations.ts';
import { deleteOperation, formContext, getOperation, listDay, moveOperation, rawFromForm, saveOperation } from '#lib/server/operations.ts';
import { getDb, listPortfolios } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

function recordFrom(id: string) {
	const record = /^\d+$/.test(id) ? getOperation(getDb(), Number(id)) : null;
	if (!record) error(404, 'Operación no encontrada');
	return record;
}

export const load: PageServerLoad = ({ params, locals }) => {
	const record = recordFrom(params.id);
	// Una operación de otra cartera cambia la cartera en uso, para que la barra superior diga dónde se está.
	if (record.portfolioId !== locals.portfolioId) redirect(303, `/movimientos/${record.id}?cartera=${record.portfolioId}`);
	const db = getDb();
	const portfolio = listPortfolios().find((p) => p.id === record.portfolioId)!;
	return {
		portfolio,
		portfolioId: record.portfolioId,
		...formContext(db, record.portfolioId, record.id),
		record: { id: record.id, date: record.date, type: record.type, description: record.description, imported: record.imported, supported: isOperationType(record.type) },
		initial: record.raw,
		day: listDay(db, record.portfolioId, record.date)
	};
};

/** Vuelta al listado: resaltando la operación o, si se ha borrado, en el año en que estaba. */
const back = (portfolioId: number, date: string, id?: number) => `/movimientos?cartera=${portfolioId}${id ? `&op=${id}` : `&periodo=${date.slice(0, 4)}`}`;

export const actions: Actions = {
	guardar: async ({ request, params }) => {
		const record = recordFrom(params.id);
		const raw = rawFromForm(await request.formData());
		const result = saveOperation(getDb(), record.portfolioId, record.id, raw, raw.confirm === '1');
		if (!result.ok) return fail(400, { errors: result.errors, warnings: result.warnings, raw });
		redirect(303, back(record.portfolioId, raw.date ?? record.date, record.id));
	},
	borrar: async ({ request, params }) => {
		const record = recordFrom(params.id);
		const raw = rawFromForm(await request.formData());
		const result = deleteOperation(getDb(), record.portfolioId, record.id, raw.confirm === '1');
		if (!result.ok) return fail(400, { deleting: true, errors: result.errors, warnings: result.warnings });
		redirect(303, back(record.portfolioId, record.date));
	},
	mover: async ({ request, params }) => {
		const record = recordFrom(params.id);
		const direction = (await request.formData()).get('direction') === 'up' ? -1 : 1;
		const result = moveOperation(getDb(), record.portfolioId, record.id, direction);
		if (!result.ok) return fail(400, { moving: true, errors: result.errors, warnings: result.warnings });
		return { moved: true };
	}
};

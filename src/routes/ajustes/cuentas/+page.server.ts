import { error, fail } from '@sveltejs/kit';
import { CURRENCIES, listAccountRecords, saveAccount } from '#lib/server/masters.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

function portfolioFrom(locals: App.Locals) {
	if (locals.portfolioId == null) error(404, 'No hay ninguna cartera');
	return locals.portfolioId;
}

export const load: PageServerLoad = ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = portfolioFrom(locals);
	return { portfolioId, accounts: listAccountRecords(getDb(), portfolioId), currencies: CURRENCIES };
};

export const actions: Actions = {
	guardar: async ({ request, locals }) => {
		const portfolioId = portfolioFrom(locals);
		const raw = rawFromForm(await request.formData());
		const id = raw.id ? Number(raw.id) : null;
		const result = saveAccount(getDb(), portfolioId, id, raw);
		if (!result.ok) return fail(400, { id, errors: result.errors, raw });
		return { savedId: result.id };
	}
};

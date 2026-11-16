import { error, fail } from '@sveltejs/kit';
import { CURRENCIES, listAccountRecords, saveAccount } from '#lib/server/masters.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb, listPortfolios } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

function portfolioFrom(url: URL) {
	const portfolios = listPortfolios();
	const portfolioId = Number(url.searchParams.get('cartera')) || portfolios[0]?.id;
	if (!portfolios.some((p) => p.id === portfolioId)) error(404, 'Cartera no encontrada');
	return { portfolios, portfolioId };
}

export const load: PageServerLoad = ({ url }) => {
	const { portfolios, portfolioId } = portfolioFrom(url);
	return { portfolios, portfolioId, accounts: listAccountRecords(getDb(), portfolioId), currencies: CURRENCIES };
};

export const actions: Actions = {
	guardar: async ({ request, url }) => {
		const { portfolioId } = portfolioFrom(url);
		const raw = rawFromForm(await request.formData());
		const id = raw.id ? Number(raw.id) : null;
		const result = saveAccount(getDb(), portfolioId, id, raw);
		if (!result.ok) return fail(400, { id, errors: result.errors, raw });
		return { savedId: result.id };
	}
};

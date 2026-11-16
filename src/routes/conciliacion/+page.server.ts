import { error, fail } from '@sveltejs/kit';
import { rawFromForm } from '#lib/server/operations.ts';
import { accountBalances, deleteReconciliation, listReconciliations, saveReconciliation } from '#lib/server/reconciliation.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

const todayInMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

function portfolioFrom(locals: App.Locals) {
	if (locals.portfolioId == null) error(404, 'No hay ninguna cartera');
	return locals.portfolioId;
}

export const load: PageServerLoad = ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = portfolioFrom(locals);
	const today = todayInMadrid();
	const asked = url.searchParams.get('fecha') ?? '';
	const date = /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(asked)) ? asked : today;
	const db = getDb();
	const accounts = accountBalances(db, portfolioId, date);
	const names = new Map(accounts.map((a) => [a.id, a]));
	const history = listReconciliations(db, portfolioId).map((r) => ({ ...r, account: names.get(r.accountId)?.name ?? '', currency: names.get(r.accountId)?.currency ?? '' }));
	return { portfolioId, date, today, accounts: accounts.filter((a) => !a.closed || a.computed !== 0), history };
};

export const actions: Actions = {
	guardar: async ({ request, locals }) => {
		const portfolioId = portfolioFrom(locals);
		const raw = rawFromForm(await request.formData());
		const real = Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith('real-')).map(([key, value]) => [key.slice(5), value]));
		const result = saveReconciliation(getDb(), portfolioId, raw.date ?? '', real, raw.notes);
		if (!result.ok) return fail(400, { errors: result.errors, raw });
		return { saved: result.saved };
	},
	borrar: async ({ request, locals }) => {
		const portfolioId = portfolioFrom(locals);
		deleteReconciliation(getDb(), portfolioId, Number((await request.formData()).get('id')));
		return { deleted: true };
	}
};

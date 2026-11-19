import { fail, redirect } from '@sveltejs/kit';
import { addEntry, closeReview, loadSelection, removeEntry, saveOrder, saveParams, saveReviewNotes } from '#lib/server/selection.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

const todayInMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

export const load: PageServerLoad = ({ url, locals }) => {
	void url.searchParams.get('cartera');
	if (locals.portfolioId == null) redirect(303, '/ajustes');
	const today = todayInMadrid();
	return { today, ...loadSelection(getDb(), locals.portfolioId, today) };
};

function portfolio(locals: App.Locals): number {
	if (locals.portfolioId == null) redirect(303, '/ajustes');
	return locals.portfolioId;
}

export const actions: Actions = {
	orden: async ({ request, locals }) => {
		const ids = String((await request.formData()).get('ids') ?? '')
			.split(',')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0);
		saveOrder(getDb(), portfolio(locals), ids);
		return { saved: 'orden' };
	},
	anadir: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('security'));
		if (!addEntry(getDb(), portfolio(locals), id)) return fail(400, { errors: ['Elige un valor.'] });
		return { saved: 'anadir' };
	},
	quitar: async ({ request, locals }) => {
		removeEntry(getDb(), portfolio(locals), Number((await request.formData()).get('security')));
		return { saved: 'quitar' };
	},
	cerrar: async ({ request, locals }) => {
		const f = rawFromForm(await request.formData());
		const result = closeReview(getDb(), portfolio(locals), f.date || todayInMadrid(), f.proposals ?? '', f.choice ?? '');
		if (!result.ok) return fail(400, { errors: result.errors });
		return { saved: 'cerrar', items: result.items };
	},
	notas: async ({ request, locals }) => {
		const f = rawFromForm(await request.formData());
		if (!saveReviewNotes(getDb(), portfolio(locals), Number(f.review), f.proposals ?? '', f.choice ?? '')) return fail(404, { errors: ['Esa revisión ya no existe.'] });
		return { saved: 'notas' };
	},
	parametros: async ({ request }) => {
		const result = saveParams(getDb(), rawFromForm(await request.formData()));
		if (!result.ok) return fail(400, { errors: result.errors });
		return { saved: 'parametros' };
	}
};

import { error, fail, redirect } from '@sveltejs/kit';
import { isOperationType } from '#lib/engine/operations.ts';
import { formContext, getOperation, rawFromForm, saveOperation } from '#lib/server/operations.ts';
import { getDb, listPortfolios } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

function portfolioFrom(url: URL) {
	const portfolios = listPortfolios();
	if (portfolios.length === 0) redirect(303, '/ajustes');
	const portfolioId = Number(url.searchParams.get('cartera')) || portfolios[0].id;
	if (!portfolios.some((p) => p.id === portfolioId)) error(404, 'Cartera no encontrada');
	return { portfolios, portfolioId };
}

export const load: PageServerLoad = ({ url }) => {
	const { portfolios, portfolioId } = portfolioFrom(url);
	const db = getDb();
	const context = formContext(db, portfolioId);
	const previous = getOperation(db, Number(url.searchParams.get('guardado')));
	let initial: Record<string, string> = {
		type: url.searchParams.get('tipo') ?? 'DIVIDENDOS',
		date: url.searchParams.get('fecha') ?? context.today,
		account: url.searchParams.get('cuenta') ?? ''
	};
	// Duplicar: los campos de otra operación de la cartera, con la fecha de hoy.
	const source = getOperation(db, Number(url.searchParams.get('copiar')));
	const copied = source?.portfolioId === portfolioId && isOperationType(source.type) ? source : null;
	if (copied) {
		// Una descripción importada con cifras (acciones, precios) quedaría desfasada: se deja que se genere de nuevo.
		const description = copied.imported && /\d/.test(copied.raw.description ?? '') ? '' : (copied.raw.description ?? '');
		initial = { ...copied.raw, date: context.today, notes: '', description };
	}
	return { portfolios, portfolioId, ...context, initial, copied: copied ? { id: copied.id, description: copied.description, date: copied.date } : null, saved: previous?.portfolioId === portfolioId ? { id: previous.id, description: previous.description, accountIds: previous.cash.map((c) => c.accountId) } : null };
};

export const actions: Actions = {
	default: async ({ request, url }) => {
		const { portfolioId } = portfolioFrom(url);
		const raw = rawFromForm(await request.formData());
		const result = saveOperation(getDb(), portfolioId, null, raw, raw.confirm === '1');
		if (!result.ok) return fail(400, { errors: result.errors, warnings: result.warnings, raw });
		if (raw.next === 'otra') redirect(303, `/movimientos/nuevo?${new URLSearchParams({ cartera: String(portfolioId), tipo: raw.type ?? '', cuenta: raw.account ?? '', fecha: raw.date ?? '', guardado: String(result.id) })}`);
		redirect(303, `/movimientos?cartera=${portfolioId}&anio=${(raw.date ?? '').slice(0, 4)}&op=${result.id}`);
	}
};

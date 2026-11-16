import { fail, redirect } from '@sveltejs/kit';
import { isOperationType } from '#lib/engine/operations.ts';
import { formContext, getOperation, rawFromForm, saveOperation } from '#lib/server/operations.ts';
import { getDb } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

function portfolioFrom(locals: App.Locals) {
	if (locals.portfolioId == null) redirect(303, '/ajustes');
	return locals.portfolioId;
}

export const load: PageServerLoad = ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = portfolioFrom(locals);
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
	return { portfolioId, ...context, initial, copied: copied ? { id: copied.id, description: copied.description, date: copied.date } : null, saved: previous?.portfolioId === portfolioId ? { id: previous.id, description: previous.description, accountIds: previous.cash.map((c) => c.accountId) } : null };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const portfolioId = portfolioFrom(locals);
		const raw = rawFromForm(await request.formData());
		const result = saveOperation(getDb(), portfolioId, null, raw, raw.confirm === '1');
		if (!result.ok) return fail(400, { errors: result.errors, warnings: result.warnings, raw });
		if (raw.next === 'otra') redirect(303, `/movimientos/nuevo?${new URLSearchParams({ cartera: String(portfolioId), tipo: raw.type ?? '', cuenta: raw.account ?? '', fecha: raw.date ?? '', guardado: String(result.id) })}`);
		redirect(303, `/movimientos?cartera=${portfolioId}&op=${result.id}`);
	}
};

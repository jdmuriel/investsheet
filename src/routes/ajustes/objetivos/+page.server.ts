import { error, fail } from '@sveltejs/kit';
import { run } from '#lib/engine/engine.ts';
import { GOAL_METRICS } from '#lib/engine/goals.ts';
import { goalYears, loadGoals, saveGoals } from '#lib/server/goals.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb, loadOperations } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

const currentYearInMadrid = () => Number(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date()).slice(0, 4));

function portfolioFrom(locals: App.Locals) {
	if (locals.portfolioId == null) error(404, 'No hay ninguna cartera');
	return locals.portfolioId;
}

export const load: PageServerLoad = ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = portfolioFrom(locals);
	const currentYear = currentYearInMadrid();
	const asked = Number(url.searchParams.get('anio'));
	const year = Number.isInteger(asked) && asked >= 1990 && asked <= currentYear + 1 ? asked : currentYear;
	const db = getDb();
	const goals = loadGoals(db, portfolioId, year);
	// Como referencia al fijar el objetivo: lo conseguido ese año y el anterior.
	const { years } = run(loadOperations(portfolioId, db)).state;
	const reached = (y: number) => years.get(y);
	const metrics = GOAL_METRICS.map((m) => ({ key: m.key, label: m.label, goal: goals[m.key] ?? null, actual: reached(year) ? m.value(reached(year)!) : 0, previous: reached(year - 1) ? m.value(reached(year - 1)!) : null }));
	// Años que se ofrecen: el siguiente, el actual, y los que ya tienen objetivos o movimientos.
	const offered = [...new Set([currentYear + 1, currentYear, year, ...goalYears(db, portfolioId), ...years.keys()])].sort((a, b) => b - a);
	return { portfolioId, year, years: offered, metrics };
};

export const actions: Actions = {
	guardar: async ({ request, locals }) => {
		const portfolioId = portfolioFrom(locals);
		const raw = rawFromForm(await request.formData());
		const result = saveGoals(getDb(), portfolioId, Number(raw.year), raw);
		if (!result.ok) return fail(400, { errors: result.errors, raw });
		return { saved: true };
	}
};

import { error, fail, redirect } from '@sveltejs/kit';
import { run, totalShares } from '#lib/engine/engine.ts';
import { MICRO } from '#lib/engine/types.ts';
import { currentSchedules, deleteScheduleVersion, listChanges, saveSchedule } from '#lib/server/dividends.ts';
import { CURRENCIES } from '#lib/server/masters.ts';
import { rawFromForm } from '#lib/server/operations.ts';
import { getDb, listSecurities, loadOperations } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

const todayInMadrid = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

function securityFrom(param: string) {
	const security = /^\d+$/.test(param) ? listSecurities(getDb()).find((s) => s.id === Number(param)) : null;
	if (!security) error(404, 'Valor no encontrado');
	return security;
}

export const load: PageServerLoad = ({ params, url, locals }) => {
	void url.searchParams.get('cartera');
	const security = securityFrom(params.id);
	const db = getDb();
	const today = todayInMadrid();
	const schedule = currentSchedules(db).get(security.id) ?? null;
	const currency = schedule?.currency ?? security.currency ?? 'EUR';
	const versions = (db.prepare('SELECT valid_from AS validFrom, currency, months_json AS json FROM dividend_schedule WHERE security_id = ? ORDER BY valid_from DESC').all(security.id) as { validFrom: string; currency: string; json: string }[]).map((v) => ({ validFrom: v.validFrom, currency: v.currency, months: JSON.parse(v.json) as number[] }));
	const shares = locals.portfolioId == null ? 0 : totalShares(run(loadOperations(locals.portfolioId, db)).state.positions.get(security.id)) / MICRO;
	return { security, today, schedule, currency, currencies: CURRENCIES, versions, shares, changes: listChanges(db).filter((c) => c.securityId === security.id) };
};

export const actions: Actions = {
	guardar: async ({ request, params }) => {
		const security = securityFrom(params.id);
		const raw = rawFromForm(await request.formData());
		const result = saveSchedule(getDb(), security.id, raw);
		if (!result.ok) return fail(400, { errors: result.errors, raw });
		redirect(303, `/dividendos?anio=${(raw.date ?? '').slice(0, 4)}`);
	},
	borrarVersion: async ({ request, params }) => {
		const security = securityFrom(params.id);
		const validFrom = String((await request.formData()).get('validFrom') ?? '');
		if (!deleteScheduleVersion(getDb(), security.id, validFrom)) return fail(404, { errors: ['Esa versión del calendario ya no existe.'], raw: null });
		return { deleted: validFrom };
	}
};

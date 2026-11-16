import { error, redirect } from '@sveltejs/kit';
import { annualDividend, changeEffect, sharesAt } from '#lib/engine/dividends.ts';
import { deleteChange, listChanges } from '#lib/server/dividends.ts';
import { loadPortfolio } from '#lib/server/portfolio.ts';
import { getDb, listSecurities, loadOperations } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = locals.portfolioId;
	if (portfolioId == null) redirect(303, '/ajustes');
	const db = getDb();
	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
	const { rows, totals } = loadPortfolio(db, portfolioId, today);

	// Calendario vigente de los valores con posición (RF-16).
	const calendar = rows.map((r) => ({ id: r.id, ticker: r.ticker, name: r.name, shares: r.shares, currency: r.dpaCurrency, dpa: r.dpa, monthly: r.monthly, gross: r.dividendGross, net: r.dividendNet }));
	const held = new Set(rows.map((r) => r.id));
	const others = listSecurities(db).filter((s) => s.active && !held.has(s.id)).map((s) => ({ id: s.id, ticker: s.ticker }));

	// Cambios de dividendo con su efecto en esta cartera: las acciones son las que había en la fecha (RF-17, RF-18).
	const changes = listChanges(db);
	const shares = sharesAt(loadOperations(portfolioId, db), changes.map((c) => ({ securityId: c.securityId, date: c.date })));
	const all = changes.map((c, i) => ({ ...c, shares: shares[i], ...changeEffect(c.oldAnnual, c.newAnnual, c.fxRate, shares[i]) }));
	const currentYear = Number(today.slice(0, 4));
	const years = [...new Set([currentYear, ...all.map((c) => Number(c.date.slice(0, 4)))])].sort((a, b) => b - a);
	const asked = Number(url.searchParams.get('anio'));
	const year = years.includes(asked) ? asked : currentYear;
	const byYear = years.map((y) => {
		const own = all.filter((c) => Number(c.date.slice(0, 4)) === y && c.shares > 0);
		return { year: y, count: own.length, annualEur: Math.round(own.reduce((a, c) => a + c.annualEur, 0) * 100) };
	});
	return { portfolioId, calendar, others, padiGross: totals.padiGross, padiNet: totals.padiNet, unscheduled: totals.unscheduled, year, years: byYear, changes: all.filter((c) => Number(c.date.slice(0, 4)) === year).map((c) => ({ ...c, annualEur: Math.round(c.annualEur * 100), beforeEur: Math.round(c.beforeEur * 100), afterEur: Math.round(c.afterEur * 100), oldAnnual: annualDividend([c.oldAnnual]), newAnnual: annualDividend([c.newAnnual]) })) };
};

export const actions: Actions = {
	borrar: async ({ request }) => {
		if (!deleteChange(getDb(), Number((await request.formData()).get('id')))) error(404, 'Ese cambio ya no existe');
		return { deleted: true };
	}
};

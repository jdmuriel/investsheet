import { error, redirect } from '@sveltejs/kit';
import { annualDividend, changeEffect, sharesAt } from '#lib/engine/dividends.ts';
import { compareMonth, comparisonText, evolution, monthOf, securityHistory, yearTotals, type Measure } from '#lib/engine/history.ts';
import { deleteChange, listChanges } from '#lib/server/dividends.ts';
import { loadHistory } from '#lib/server/history.ts';
import { loadPortfolio } from '#lib/server/portfolio.ts';
import { getDb, listSecurities, loadOperations } from '#lib/server/store.ts';
import type { Actions, PageServerLoad } from './$types';

/** Solapas de la página y vistas del historial. La última elegida se recuerda en las cookies `dividendos` e `historial`. */
const TABS = ['cambios', 'calendario', 'historial'] as const;
const VIEWS = ['evolucion', 'mes', 'valor', 'tabla'] as const;
export type Tab = (typeof TABS)[number];
export type View = (typeof VIEWS)[number];
/** Medida del historial (cookie `medida`): bruto, neto o lo cobrado por acción (`dpa`, solo en las vistas por valor). */
const MEASURES = ['bruto', 'neto', 'dpa'] as const;
export type HistoryMeasure = (typeof MEASURES)[number];
const YEAR = 60 * 60 * 24 * 365;

function pick<T extends string>(list: readonly T[], ...values: (string | null | undefined)[]): T {
	return (values.find((v) => v && (list as readonly string[]).includes(v)) as T | undefined) ?? list[0];
}

export const load: PageServerLoad = ({ url, locals, cookies }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = locals.portfolioId;
	if (portfolioId == null) redirect(303, '/ajustes');
	const db = getDb();
	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
	const currentYear = Number(today.slice(0, 4));
	const { rows, totals } = loadPortfolio(db, portfolioId, today);

	const remember = (name: string, value: string | null) => {
		if (value) cookies.set(name, value, { path: '/', maxAge: YEAR, httpOnly: false, sameSite: 'lax' });
	};
	const tab = pick(TABS, url.searchParams.get('vista'), cookies.get('dividendos'));
	remember('dividendos', url.searchParams.get('vista') && tab);
	const base = { portfolioId, tab, padiGross: totals.padiGross, padiNet: totals.padiNet };

	if (tab === 'calendario') {
		// Calendario vigente de los valores con posición (RF-16).
		const calendar = rows.map((r) => ({ id: r.id, ticker: r.ticker, name: r.name, shares: r.shares, currency: r.dpaCurrency, dpa: r.dpa, monthly: r.monthly, gross: r.dividendGross, net: r.dividendNet }));
		const held = new Set(rows.map((r) => r.id));
		const others = listSecurities(db).filter((s) => s.active && !held.has(s.id)).map((s) => ({ id: s.id, ticker: s.ticker }));
		return { ...base, tab, calendar, others, unscheduled: totals.unscheduled };
	}

	if (tab === 'cambios') {
		// Cambios de dividendo con su efecto en esta cartera: las acciones son las que había en la fecha (RF-17, RF-18).
		const changes = listChanges(db);
		const shares = sharesAt(loadOperations(portfolioId, db), changes.map((c) => ({ securityId: c.securityId, date: c.date })));
		const all = changes.map((c, i) => ({ ...c, shares: shares[i], ...changeEffect(c.oldAnnual, c.newAnnual, c.fxRate, shares[i]) }));
		const years = [...new Set([currentYear, ...all.map((c) => Number(c.date.slice(0, 4)))])].sort((a, b) => b - a);
		const asked = Number(url.searchParams.get('anio'));
		const year = years.includes(asked) ? asked : currentYear;
		const byYear = years.map((y) => {
			const own = all.filter((c) => Number(c.date.slice(0, 4)) === y && c.shares > 0);
			return { year: y, count: own.length, annualEur: Math.round(own.reduce((a, c) => a + c.annualEur, 0) * 100) };
		});
		return {
			...base,
			tab,
			year,
			years: byYear,
			changes: all.filter((c) => Number(c.date.slice(0, 4)) === year).map((c) => ({ ...c, annualEur: Math.round(c.annualEur * 100), beforeEur: Math.round(c.beforeEur * 100), afterEur: Math.round(c.afterEur * 100), oldAnnual: annualDividend([c.oldAnnual]), newAnnual: annualDividend([c.newAnnual]) }))
		};
	}

	// Historial de cobros (RF-38, RF-40).
	const view = pick(VIEWS, url.searchParams.get('ver'), cookies.get('historial'));
	remember('historial', url.searchParams.get('ver') && view);
	const measureAsked = pick(MEASURES, url.searchParams.get('medida'), cookies.get('medida'));
	remember('medida', url.searchParams.get('medida') && measureAsked);
	// Lo cobrado por acción solo tiene sentido valor a valor: en las vistas de totales se muestra el bruto.
	const measure: HistoryMeasure = measureAsked === 'dpa' && (view === 'evolucion' || view === 'mes') ? 'bruto' : measureAsked;
	const money: Measure = measure === 'neto' ? 'neto' : 'bruto';
	const { history, splits, heldAt } = loadHistory(db, portfolioId);
	const months = [...history.months.keys()].sort();
	const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => b - a);
	const common = { ...base, tab, view, measure, measureAsked, firstMonth: months[0] ?? null, lastMonth: months.at(-1) ?? null };

	if (view === 'evolucion') {
		const asked = Number(url.searchParams.get('anio'));
		const year = years.includes(asked) ? asked : (years[0] ?? currentYear);
		// Previsión de lo que queda del año con el calendario vigente y las acciones de hoy.
		const keep = totals.padiGross ? totals.padiNet / totals.padiGross : 1;
		const forecast = Array.from({ length: 12 }, (_, i) => rows.reduce((a, r) => a + r.monthly[i], 0)).map((v) => (money === 'neto' ? Math.round(v * keep) : v));
		const allYears = yearTotals(history, money);
		// Acumulado mes a mes de cada año, para el gráfico.
		const lines = allYears.map((y) => ({ year: y.year, points: evolution(history, y.year, money, today).months.filter((m) => !m.future).map((m) => m.cumulative) }));
		return { ...common, view, year, years, evolution: evolution(history, year, money, today, forecast), yearTotals: [...allYears].reverse(), lines };
	}

	if (view === 'mes') {
		const asked = url.searchParams.get('mes') ?? '';
		const now = monthOf(today);
		const fallback = months.filter((m) => m <= now).at(-1) ?? now;
		const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : fallback;
		const held = heldAt(month);
		const annual = compareMonth(history, month, 'anual', money, { today, splits, held });
		const quarter = compareMonth(history, month, 'trimestral', money, { today, splits, held });
		return { ...common, view, month, annual, quarter, annualText: comparisonText(annual, money), quarterText: comparisonText(quarter, money) };
	}

	// Valores con cobros: los de la cartera en su orden y después el resto por ticker.
	const order = new Map(rows.map((r, i) => [r.id, i]));
	const securities = [...history.tickers.entries()].map(([id, ticker]) => ({ id, ticker, held: order.has(id) })).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.ticker.localeCompare(b.ticker));

	if (view === 'valor') {
		const asked = Number(url.searchParams.get('valor'));
		const securityId = history.tickers.has(asked) ? asked : (securities[0]?.id ?? null);
		return { ...common, view, securities, securityId, rows: securityId == null ? [] : securityHistory(history, securityId) };
	}

	// Tabla completa: un mes por fila (del más reciente al más antiguo) y un valor por columna.
	const table = [...months].reverse().map((m) => {
		const row = history.months.get(m)!;
		return { month: m, cells: securities.map((s) => row.get(s.id) ?? null) };
	});
	return { ...common, view: 'tabla' as const, securities, table };
};

export const actions: Actions = {
	borrar: async ({ request }) => {
		if (!deleteChange(getDb(), Number((await request.formData()).get('id')))) error(404, 'Ese cambio ya no existe');
		return { deleted: true };
	}
};

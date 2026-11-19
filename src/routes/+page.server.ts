import { redirect } from '@sveltejs/kit';
import { distribution } from '#lib/engine/portfolio.ts';
import { marketStatus, refreshMarketIfStale } from '#lib/server/market.ts';
import { loadPortfolio } from '#lib/server/portfolio.ts';
import { getDb } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const load: PageServerLoad = async ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = locals.portfolioId;
	if (portfolioId == null) redirect(303, '/ajustes');
	const db = getDb();
	// Precios con más de una hora: se leen antes de pintar, pero sin hacer esperar más de unos segundos (RF-43, RF-46).
	await Promise.race([refreshMarketIfStale(db), wait(4000)]);

	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
	const portfolio = loadPortfolio(db, portfolioId, today);
	const by = (group: (r: (typeof portfolio.rows)[number]) => string | null) => ({ value: distribution(portfolio.rows, group, (r) => r.value), dividend: distribution(portfolio.rows, group, (r) => r.dividendGross) });
	return {
		portfolioId,
		today,
		rows: portfolio.rows,
		order: portfolio.order,
		totals: portfolio.totals,
		forecast: portfolio.forecast,
		oldestQuote: portfolio.oldestQuote,
		newestQuote: portfolio.newestQuote,
		distributions: { Valor: by((r) => r.ticker), Sector: by((r) => r.sector), Supersector: by((r) => r.supersector), País: by((r) => r.country) },
		status: marketStatus(db)
	};
};

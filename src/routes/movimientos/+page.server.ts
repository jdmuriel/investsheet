import { error, redirect } from '@sveltejs/kit';
import { investedCapital, run } from '#lib/engine/engine.ts';
import type { YearMetrics } from '#lib/engine/types.ts';
import { listAccounts, listPortfolios, loadOperations } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const portfolios = listPortfolios();
	if (portfolios.length === 0) redirect(303, '/ajustes');
	const portfolioId = Number(url.searchParams.get('cartera')) || portfolios[0].id;
	if (!portfolios.some((p) => p.id === portfolioId)) error(404, 'Cartera no encontrada');

	const accounts = listAccounts(portfolioId);
	const operations = loadOperations(portfolioId);

	// Los acumulados se calculan siempre sobre todas las operaciones; el filtro de año solo recorta lo que se muestra.
	const balances = new Map<number, { cash: number[]; invested: number; capital: number; yearResult: number }>();
	const { state, warnings } = run(operations, {
		onRow: (op, s) =>
			balances.set(op.id, {
				cash: accounts.map((a) => s.cash.get(a.id) ?? 0),
				invested: investedCapital(s),
				capital: s.capital,
				yearResult: s.yearResult
			})
	});

	const years = [...state.years.values()].sort((a, b) => b.year - a.year) as YearMetrics[];
	const param = url.searchParams.get('anio');
	const year = param === 'todos' ? null : Number(param) || years[0]?.year || null;

	const rows = operations
		.filter((op) => year == null || op.date.startsWith(String(year)))
		.map((op) => ({
			id: op.id,
			date: op.date,
			type: op.type,
			description: op.description,
			ticker: op.ticker,
			account: op.accountCode,
			quantity: op.quantity,
			price: op.price,
			currency: op.currency,
			fxRate: op.fxRate,
			grossEur: op.grossEur,
			taxEur: op.taxEur,
			feesEur: op.feesEur,
			netEur: op.grossEur - op.taxEur - op.feesEur,
			capitalEur: op.capitalInEur - op.capitalOutEur,
			purchaseEur: op.purchaseEur,
			...balances.get(op.id)!
		}));

	return { portfolios, portfolioId, accounts, years, year, rows, warnings: warnings.length };
};

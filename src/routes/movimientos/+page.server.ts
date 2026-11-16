import { error, redirect } from '@sveltejs/kit';
import { investedCapital, run } from '#lib/engine/engine.ts';
import { isOperationType } from '#lib/engine/operations.ts';
import { inPeriod, resolvePeriod } from '#lib/period.ts';
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

	// Los acumulados se calculan siempre sobre todas las operaciones; el periodo solo recorta lo que se muestra.
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
	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());

	// Operación recién guardada: se resalta y se muestra el saldo en que deja sus cuentas (RF-05).
	const savedOp = operations.find((op) => op.id === Number(url.searchParams.get('op')));
	const savedBalances = savedOp && balances.get(savedOp.id);
	const saved = savedOp && savedBalances ? { id: savedOp.id, description: savedOp.description, balances: accounts.map((a, i) => ({ name: a.name, currency: a.currency, amount: savedBalances.cash[i], touched: savedOp.cash.some((c) => c.accountId === a.id) })).filter((b) => b.touched) } : null;

	// Sin periodo pedido se muestran los últimos movimientos; tras guardar, el periodo que contenga la operación.
	let period = resolvePeriod(url.searchParams.get('periodo'), today);
	if (savedOp && !url.searchParams.has('periodo') && !inPeriod(savedOp.date, period)) period = resolvePeriod(savedOp.date.slice(0, 4), today);
	const currentYear = Number(today.slice(0, 4));
	const pastYears = years.map((y) => y.year).filter((y) => y !== currentYear);

	const rows = operations
		.filter((op) => inPeriod(op.date, period))
		.map((op) => ({
			id: op.id,
			canCopy: isOperationType(op.type),
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

	return { portfolios, portfolioId, accounts, years, year: period.year, period: period.key, pastYears, rows, warnings: warnings.length, saved };
};

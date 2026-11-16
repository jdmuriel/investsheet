import { redirect } from '@sveltejs/kit';
import { investedCapital, run } from '#lib/engine/engine.ts';
import { goalProgress, yearFraction } from '#lib/engine/goals.ts';
import { isOperationType } from '#lib/engine/operations.ts';
import { inPeriod, resolvePeriod } from '#lib/period.ts';
import type { YearMetrics } from '#lib/engine/types.ts';
import { loadGoals } from '#lib/server/goals.ts';
import { getDb, listAccounts, loadOperations } from '#lib/server/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => {
	// La cartera llega por `locals`, pero depende del parámetro: leerlo hace que la carga se repita al cambiarla desde la barra.
	void url.searchParams.get('cartera');
	const portfolioId = locals.portfolioId;
	if (portfolioId == null) redirect(303, '/ajustes');

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

	const index = new Map(accounts.map((a, i) => [a.id, i]));
	const allRows = operations
		.filter((op) => inPeriod(op.date, period))
		.map((op) => {
			const after = balances.get(op.id)!;
			// Efectivo que mueve la operación en cada cuenta y saldo en que la deja, para la vista de móvil.
			const moved = new Map<number, number>();
			for (const leg of op.cash) moved.set(leg.accountId, (moved.get(leg.accountId) ?? 0) + leg.amount);
			return {
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
				moves: [...moved].filter(([id]) => index.has(id)).map(([id, amount]) => ({ account: accounts[index.get(id)!].name, currency: accounts[index.get(id)!].currency, amount, balance: after.cash[index.get(id)!] })),
				...after
			};
		});

	// Las cuentas cerradas solo ocupan columna si tienen saldo en alguna fila del periodo.
	const shown = accounts.map((a, i) => i).filter((i) => !accounts[i].closed || allRows.some((r) => r.cash[i] !== 0));
	const rows = allRows.map((r) => ({ ...r, cash: shown.map((i) => r.cash[i]) }));
	const columns = shown.map((i) => accounts[i]);

	// Situación actual, para la cabecera de la vista de móvil.
	const summary = {
		invested: investedCapital(state),
		yearResult: state.year === currentYear ? state.yearResult : 0,
		cash: accounts.filter((a) => !a.closed || (state.cash.get(a.id) ?? 0) !== 0).map((a) => ({ name: a.name, currency: a.currency, amount: state.cash.get(a.id) ?? 0 }))
	};

	// Objetivos del año en curso (RF-26), frente a la parte del año ya transcurrida.
	const goals = { year: currentYear, elapsed: yearFraction(currentYear, today), rows: goalProgress(state.years.get(currentYear), loadGoals(getDb(), portfolioId, currentYear)) };

	return { portfolioId, accounts: columns, summary, goals, currentYear, years, year: period.year, period: period.key, pastYears, rows, warnings: warnings.length, saved };
};

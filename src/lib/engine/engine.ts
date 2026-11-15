import type { Cents, Lot, Micro, Operation, Position, PositionLeg, State, Warning, YearMetrics } from './types.ts';

/** Tipos de operación cuyo bruto cuenta como dividendo cobrado del valor. */
export const DIVIDEND_TYPES = new Set(['DIVIDENDOS']);

export function emptyState(): State {
	return { cash: new Map(), capital: 0, closedYearsResult: 0, yearResult: 0, year: null, positions: new Map(), years: new Map() };
}

export function compareOperations(a: Operation, b: Operation): number {
	return a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq || a.id - b.id;
}

/** «Capital invertido» de la hoja: capital aportado más el resultado de los años cerrados. */
export function investedCapital(state: State): Cents {
	return state.capital + state.closedYearsResult;
}

export function totalShares(p: Position | undefined): Micro {
	return p ? p.lots.reduce((s, l) => s + l.shares, 0) : 0;
}
export function totalCost(p: Position | undefined): Cents {
	return p ? p.lots.reduce((s, l) => s + l.cost, 0) : 0;
}
export function totalReducedCost(p: Position | undefined): Cents {
	return p ? p.lots.reduce((s, l) => s + l.reducedCost, 0) : 0;
}

function position(state: State, securityId: number): Position {
	let p = state.positions.get(securityId);
	if (!p) {
		p = { lots: [], dividendsGross: 0, dividendsSinceLastBuy: 0, realizedGain: 0 };
		state.positions.set(securityId, p);
	}
	return p;
}

function yearMetrics(state: State, year: number): YearMetrics {
	let y = state.years.get(year);
	if (!y) {
		y = { year, capital: 0, gross: 0, tax: 0, fees: 0, purchases: 0, realizedGain: 0 };
		state.years.set(year, y);
	}
	return y;
}

/**
 * Reparte un total entero entre partes proporcionales a `weights`, sin perder unidades:
 * la suma del resultado es exactamente `total`.
 */
export function allocate(total: number, weights: number[]): number[] {
	const sum = weights.reduce((s, w) => s + w, 0);
	if (weights.length === 0) return [];
	if (sum === 0) {
		const out = weights.map(() => 0);
		out[0] = total;
		return out;
	}
	const sign = total < 0 ? -1 : 1;
	const abs = Math.abs(total);
	const exact = weights.map((w) => (abs * w) / sum);
	const out = exact.map((x) => Math.floor(x));
	let rest = abs - out.reduce((s, x) => s + x, 0);
	const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
	for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
	return out.map((x) => sign * x);
}

function applyLeg(state: State, op: Operation, leg: PositionLeg, warnings: Warning[]): Cents {
	const pos = position(state, leg.securityId);
	let realized = 0;
	switch (leg.kind) {
		case 'buy': {
			pos.lots.push({ date: op.date, shares: leg.shares, cost: leg.cost, reducedCost: leg.reducedCost });
			pos.dividendsSinceLastBuy = 0;
			break;
		}
		case 'sell': {
			let pending = leg.shares;
			let costOut = 0;
			while (pending > 0 && pos.lots.length > 0) {
				const lot = pos.lots[0];
				if (lot.shares <= pending) {
					pending -= lot.shares;
					costOut += lot.cost;
					pos.lots.shift();
				} else {
					const cost = Math.round((lot.cost * pending) / lot.shares);
					const reduced = Math.round((lot.reducedCost * pending) / lot.shares);
					lot.shares -= pending;
					lot.cost -= cost;
					lot.reducedCost -= reduced;
					costOut += cost;
					pending = 0;
				}
			}
			if (pending > 0) warnings.push({ operationId: op.id, message: `Venta de más acciones de las que hay (faltan ${pending / 1e6})` });
			realized = (leg.proceeds ?? 0) - costOut;
			pos.realizedGain += realized;
			break;
		}
		case 'adjust': {
			if (pos.lots.length === 0) pos.lots.push({ date: op.date, shares: 0, cost: 0, reducedCost: 0 });
			const weights = pos.lots.map((l) => l.shares);
			const useCost = weights.every((w) => w === 0);
			const w = useCost ? pos.lots.map((l) => Math.abs(l.cost)) : weights;
			const shares = allocate(leg.shares, w);
			const cost = allocate(leg.cost, w);
			const reduced = allocate(leg.reducedCost, w);
			pos.lots.forEach((l, i) => {
				l.shares += shares[i];
				l.cost += cost[i];
				l.reducedCost += reduced[i];
			});
			if (pos.lots.some((l) => l.shares < 0)) warnings.push({ operationId: op.id, message: 'Ajuste que deja un lote con acciones negativas' });
			pos.lots = pos.lots.filter((l) => l.shares !== 0 || l.cost !== 0 || l.reducedCost !== 0);
			break;
		}
		case 'convert': {
			if (leg.toSecurityId == null) {
				warnings.push({ operationId: op.id, message: 'Conversión sin valor de destino' });
				break;
			}
			const lots: Lot[] = pos.lots;
			pos.lots = [];
			if (leg.shares > 0 && lots.length > 0) {
				const scaled = allocate(leg.shares, lots.map((l) => l.shares));
				lots.forEach((l, i) => (l.shares = scaled[i]));
			}
			const target = position(state, leg.toSecurityId);
			target.lots.push(...lots);
			target.lots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
			break;
		}
	}
	return realized;
}

/** Aplica una operación al estado. Las operaciones deben llegar ordenadas por fecha y `seq`. */
export function applyOperation(state: State, op: Operation, warnings: Warning[] = []): void {
	const year = Number(op.date.slice(0, 4));
	if (state.year !== year) {
		state.closedYearsResult += state.yearResult;
		state.year = year;
		state.yearResult = 0;
	}
	for (const leg of op.cash) state.cash.set(leg.accountId, (state.cash.get(leg.accountId) ?? 0) + leg.amount);

	state.capital += op.capitalInEur - op.capitalOutEur;
	state.yearResult += op.grossEur - op.taxEur - op.feesEur;

	const y = yearMetrics(state, year);
	y.capital += op.capitalInEur - op.capitalOutEur;
	y.gross += op.grossEur;
	y.tax += op.taxEur;
	y.fees += op.feesEur;
	y.purchases += op.purchaseEur;

	for (const leg of op.positions) y.realizedGain += applyLeg(state, op, leg, warnings);

	if (op.securityId != null && DIVIDEND_TYPES.has(op.type)) {
		const pos = position(state, op.securityId);
		pos.dividendsGross += op.grossEur;
		pos.dividendsSinceLastBuy += op.grossEur;
	}
}

export interface RunResult {
	state: State;
	warnings: Warning[];
}

/**
 * Recorre las operaciones en orden y devuelve el estado final. `onRow` recibe el estado vivo
 * tras cada operación; `until` (AAAA-MM-DD, inclusive) permite obtener el estado a una fecha.
 */
export function run(operations: Operation[], options: { until?: string; onRow?: (op: Operation, state: State) => void } = {}): RunResult {
	const state = emptyState();
	const warnings: Warning[] = [];
	const sorted = [...operations].sort(compareOperations);
	for (const op of sorted) {
		if (options.until && op.date > options.until) break;
		applyOperation(state, op, warnings);
		options.onRow?.(op, state);
	}
	return { state, warnings };
}

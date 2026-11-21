/**
 * Cuadro de cartera (RF-19 a RF-22): combina las posiciones del motor con el último precio,
 * el tipo de cambio y el calendario de dividendos vigente. No guarda nada.
 */
import { investedCapital, totalCost, totalReducedCost, totalShares } from './engine.ts';
import { MICRO, type Cents, type State } from './types.ts';

export interface SecurityInfo {
	id: number;
	ticker: string;
	name: string | null;
	country: string | null;
	sector: string | null;
	supersector: string | null;
	zone: string | null;
	tier: string | null;
	/** Retenciones en origen y en destino, como fracción (0,15 = 15 %). */
	whtSourcePct: number | null;
	whtDestPct: number | null;
	reinvest: boolean;
}

/** Último precio conocido, en unidades de `currency`. */
export interface Quote {
	price: number;
	currency: string;
	date: string;
}

/** Dividendo por acción previsto en cada mes, de enero a diciembre, en `currency`. */
export interface Schedule {
	currency: string;
	months: number[];
}

export interface PortfolioInputs {
	state: State;
	securities: SecurityInfo[];
	quotes: Map<number, Quote>;
	schedules: Map<number, Schedule>;
	/** Unidades de cada moneda por euro. El euro no hace falta. */
	fx: Map<string, number>;
	/** Saldo de cada cuenta, en céntimos de su moneda. */
	cash: { currency: string; amount: Cents }[];
	/** Mes en curso (1 a 12): la previsión mensual empieza en él. */
	month: number;
}

export interface HoldingRow extends SecurityInfo {
	shares: number;
	cost: Cents;
	reducedCost: Cents;
	/** Coste reducido por acción, en euros. */
	averagePrice: number;
	quote: Quote | null;
	/** Precio actual en euros; `null` si falta el precio o el cambio de su moneda. */
	priceEur: number | null;
	value: Cents | null;
	gain: Cents | null;
	gainPct: number | null;
	/** Peso sobre el valor de mercado de la cartera. */
	weight: number | null;
	/** Dividendo anual por acción, en la moneda del calendario y en euros. */
	dpa: number | null;
	dpaCurrency: string | null;
	dpaEur: number | null;
	dividendGross: Cents | null;
	dividendNet: Cents | null;
	yocNet: number | null;
	yieldGross: number | null;
	yieldNet: number | null;
	/** Peso sobre el dividendo bruto previsto de la cartera. */
	dividendWeight: number | null;
	/** Cobrado desde siempre, bruto: dividendos, devoluciones de prima y ventas de derechos; y qué parte del coste supone. */
	received: Cents;
	recovered: number | null;
	/** Cobrado desde la última compra: lo pendiente de reinvertir en el valor, si se reinvierte. */
	sinceLastBuy: Cents;
	/** Bruto previsto de cada mes, de enero a diciembre, en céntimos de euro. */
	monthly: Cents[];
	/** Dividendo por acción previsto de cada mes, de enero a diciembre, en `dpaCurrency`; `null` sin calendario. */
	months: number[] | null;
}

export interface PortfolioTotals {
	count: number;
	cost: Cents;
	reducedCost: Cents;
	/** Valor de mercado de los valores con precio. */
	value: Cents;
	/** Valores con posición a los que les falta precio o tipo de cambio, o calendario de dividendos. */
	unpriced: string[];
	unscheduled: string[];
	gain: Cents;
	gainPct: number | null;
	liquidity: Cents;
	liquidityPct: number | null;
	/** Capital aportado (aportaciones menos retiradas) y resultado total: valor + liquidez − capital. */
	capital: Cents;
	totalGain: Cents;
	/** Capital invertido: lo aportado más el resultado de los años cerrados, que se considera reinvertido. */
	invested: Cents;
	padiGross: Cents;
	padiNet: Cents;
	monthlyGross: Cents;
	monthlyNet: Cents;
	/** Parte del dividendo bruto que se va en retenciones. */
	taxRate: number | null;
	yocNet: number | null;
	yieldGross: number | null;
	yieldNet: number | null;
	/** Peso de referencia si todos los valores pesaran lo mismo. */
	equalWeight: number | null;
	received: Cents;
}

export interface PortfolioView {
	rows: HoldingRow[];
	totals: PortfolioTotals;
	/** Dividendo previsto de los próximos 12 meses, empezando por el mes en curso. */
	forecast: { month: number; gross: Cents; net: Cents }[];
}

const ratio = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);

export function portfolioView(inputs: PortfolioInputs): PortfolioView {
	const rate = (currency: string | null | undefined) => (!currency || currency === 'EUR' ? 1 : (inputs.fx.get(currency) ?? null));
	const rows: HoldingRow[] = [];
	for (const security of inputs.securities) {
		const position = inputs.state.positions.get(security.id);
		const micro = totalShares(position);
		if (micro <= 0) continue;
		const shares = micro / MICRO;
		const cost = totalCost(position);
		const reducedCost = totalReducedCost(position);

		const quote = inputs.quotes.get(security.id) ?? null;
		const quoteRate = quote ? rate(quote.currency) : null;
		const priceEur = quote && quoteRate ? quote.price / quoteRate : null;
		const value = priceEur == null ? null : Math.round(priceEur * shares * 100);
		const gain = value == null ? null : value - reducedCost;

		const schedule = inputs.schedules.get(security.id) ?? null;
		const scheduleRate = schedule ? rate(schedule.currency) : null;
		const months = schedule ? Array.from({ length: 12 }, (_, i) => schedule.months[i] ?? 0) : null;
		const dpa = months ? months.reduce((a, b) => a + b, 0) : null;
		const dpaEur = dpa != null && scheduleRate ? dpa / scheduleRate : null;
		const monthly = months && scheduleRate ? months.map((m) => Math.round((m / scheduleRate) * shares * 100)) : new Array<number>(12).fill(0);
		const dividendGross = dpaEur == null ? null : monthly.reduce((a, b) => a + b, 0);
		const keep = (1 - (security.whtSourcePct ?? 0)) * (1 - (security.whtDestPct ?? 0));
		const dividendNet = dividendGross == null ? null : Math.round(dividendGross * keep);

		rows.push({
			...security,
			shares,
			cost,
			reducedCost,
			averagePrice: reducedCost / 100 / shares,
			quote,
			priceEur,
			value,
			gain,
			gainPct: ratio(gain, reducedCost),
			weight: null,
			dpa,
			dpaCurrency: schedule?.currency ?? null,
			dpaEur,
			dividendGross,
			dividendNet,
			yocNet: ratio(dividendNet, reducedCost),
			yieldGross: ratio(dividendGross, value),
			yieldNet: ratio(dividendNet, value),
			dividendWeight: null,
			received: (position?.dividendsGross ?? 0) + (position?.returnsGross ?? 0),
			recovered: ratio((position?.dividendsGross ?? 0) + (position?.returnsGross ?? 0), cost),
			sinceLastBuy: position?.dividendsSinceLastBuy ?? 0,
			monthly,
			months
		});
	}

	const sum = (pick: (r: HoldingRow) => number | null) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0);
	const value = sum((r) => r.value);
	const padiGross = sum((r) => r.dividendGross);
	const padiNet = sum((r) => r.dividendNet);
	for (const r of rows) {
		r.weight = ratio(r.value, value);
		r.dividendWeight = ratio(r.dividendGross, padiGross);
	}
	// El resultado solo compara valor y coste de los valores que tienen precio.
	const pricedCost = rows.reduce((a, r) => a + (r.value == null ? 0 : r.reducedCost), 0);
	const reducedCost = sum((r) => r.reducedCost);
	const liquidity = inputs.cash.reduce((a, c) => {
		const r = rate(c.currency);
		return a + (r ? Math.round(c.amount / r) : 0);
	}, 0);
	const capital = inputs.state.capital;

	const totals: PortfolioTotals = {
		count: rows.length,
		cost: sum((r) => r.cost),
		reducedCost,
		value,
		unpriced: rows.filter((r) => r.value == null).map((r) => r.ticker),
		unscheduled: rows.filter((r) => r.dividendGross == null).map((r) => r.ticker),
		gain: value - pricedCost,
		gainPct: ratio(value - pricedCost, pricedCost),
		liquidity,
		liquidityPct: ratio(liquidity, value + liquidity),
		capital,
		totalGain: value + liquidity - capital,
		invested: investedCapital(inputs.state),
		padiGross,
		padiNet,
		monthlyGross: Math.round(padiGross / 12),
		monthlyNet: Math.round(padiNet / 12),
		taxRate: padiGross === 0 ? null : 1 - padiNet / padiGross,
		yocNet: ratio(padiNet, reducedCost),
		yieldGross: ratio(padiGross, value),
		yieldNet: ratio(padiNet, value),
		equalWeight: rows.length ? 1 / rows.length : null,
		received: sum((r) => r.received)
	};

	const forecast = Array.from({ length: 12 }, (_, i) => {
		const month = ((inputs.month - 1 + i) % 12) + 1;
		let gross = 0;
		let net = 0;
		for (const r of rows) {
			gross += r.monthly[month - 1];
			net += Math.round(r.monthly[month - 1] * (1 - (r.whtSourcePct ?? 0)) * (1 - (r.whtDestPct ?? 0)));
		}
		return { month, gross, net };
	});

	return { rows, totals, forecast };
}

/** Reparto de una magnitud por grupo (sector, país…), de mayor a menor, con su peso. */
export function distribution(rows: HoldingRow[], group: (r: HoldingRow) => string | null, amount: (r: HoldingRow) => number | null): { label: string; amount: number; share: number }[] {
	const totals = new Map<string, number>();
	for (const r of rows) {
		const a = amount(r);
		if (a == null || a === 0) continue;
		const label = group(r) || 'Sin clasificar';
		totals.set(label, (totals.get(label) ?? 0) + a);
	}
	const total = [...totals.values()].reduce((a, b) => a + b, 0);
	return [...totals].map(([label, a]) => ({ label, amount: a, share: total ? a / total : 0 })).sort((a, b) => b.amount - a.amount);
}

/**
 * Orden completo de una cartera tras reordenar los valores que se ven (`shown`, ya en el orden nuevo).
 * `current` es el orden guardado, que incluye valores sin posición: esos no se mueven, y los que se ven
 * ocupan, en el orden nuevo, los huecos que ya ocupaban. Los que aún no tenían sitio entran al final.
 */
export function reorder(current: number[], shown: number[]): number[] {
	const full = [...current, ...shown.filter((id) => !current.includes(id))];
	const wanted = new Set(shown);
	const next = shown[Symbol.iterator]();
	return full.map((id) => (wanted.has(id) ? next.next().value! : id));
}

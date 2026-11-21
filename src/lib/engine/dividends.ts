/** Dividendos previstos y cambios de dividendo (RF-16 a RF-18). */
import { applyOperation, compareOperations, emptyState, totalShares } from './engine.ts';
import { MICRO, type Operation } from './types.ts';

export const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Dividendo anual por acción de un calendario; redondeado para que no asomen los errores de la coma flotante. */
export function annualDividend(months: number[]): number {
	return Math.round(months.reduce((a, b) => a + (b || 0), 0) * 1e6) / 1e6;
}

export interface ChangeEffect {
	/** Variación relativa del dividendo; `null` si antes no pagaba. */
	pct: number | null;
	/** Variación por acción y del ingreso anual, en euros. */
	perShareEur: number;
	annualEur: number;
	/** Ingreso anual antes y después con las acciones de la fecha, en euros. */
	beforeEur: number;
	afterEur: number;
}

/** Efecto de un cambio de dividendo con `shares` acciones; `fxRate` son unidades de la moneda por euro. */
export function changeEffect(oldAnnual: number, newAnnual: number, fxRate: number, shares: number): ChangeEffect {
	const perShareEur = (newAnnual - oldAnnual) / fxRate;
	return { pct: oldAnnual > 0 ? newAnnual / oldAnnual - 1 : null, perShareEur, annualEur: perShareEur * shares, beforeEur: (oldAnnual / fxRate) * shares, afterEur: (newAnnual / fxRate) * shares };
}

/**
 * Nº de acciones de cada valor al cierre de cada fecha pedida, en un solo recorrido del registro.
 * Devuelve las acciones en el mismo orden que `queries`.
 */
export function sharesAt(operations: Operation[], queries: { securityId: number; date: string }[]): number[] {
	const order = queries.map((q, i) => ({ ...q, i })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const out = new Array<number>(queries.length).fill(0);
	const state = emptyState();
	let next = 0;
	const flush = (before: string | null) => {
		for (; next < order.length && (before == null || order[next].date < before); next++) out[order[next].i] = totalShares(state.positions.get(order[next].securityId)) / MICRO;
	};
	for (const op of [...operations].sort(compareOperations)) {
		flush(op.date);
		applyOperation(state, op);
	}
	flush(null);
	return out;
}

/**
 * Calendario que había antes de uno nuevo fechado en `date`: el vigente en esa fecha o, si la fecha es anterior a
 * todas las versiones, la primera. Así se tratan los calendarios importados de la hoja, que llevan la fecha de la
 * importación aunque ya regían antes.
 */
export function scheduleBefore<T extends { validFrom: string }>(versions: T[], date: string): T | null {
	const sorted = [...versions].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
	return sorted.filter((v) => v.validFrom <= date).at(-1) ?? sorted.find((v) => v.validFrom > date) ?? null;
}

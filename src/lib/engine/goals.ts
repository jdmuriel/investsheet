/** Objetivos anuales (RF-26): métricas a las que se les puede poner objetivo y grado de consecución. */
import type { Cents, YearMetrics } from './types.ts';

/** Métricas de la cabecera del registro, en el orden de la hoja. `ceiling` marca las que son un tope y no una meta. */
export const GOAL_METRICS = [
	{ key: 'capital', label: 'Aumento de capital', value: (y: YearMetrics) => y.capital },
	{ key: 'gross', label: 'Ingresos brutos', value: (y: YearMetrics) => y.gross },
	{ key: 'fees', label: 'Gastos', value: (y: YearMetrics) => y.fees, ceiling: true },
	{ key: 'grossYield', label: 'Rendimiento bruto', value: (y: YearMetrics) => y.gross - y.fees },
	{ key: 'netYield', label: 'Rendimiento neto', value: (y: YearMetrics) => y.gross - y.tax - y.fees },
	{ key: 'purchases', label: 'Compras netas', value: (y: YearMetrics) => y.purchases }
] as const;

export type GoalMetric = (typeof GOAL_METRICS)[number]['key'];
/** Objetivo de cada métrica, en céntimos de euro; las métricas sin objetivo no aparecen. */
export type Goals = Partial<Record<GoalMetric, Cents>>;

export const isGoalMetric = (key: string): key is GoalMetric => GOAL_METRICS.some((m) => m.key === key);

export interface GoalRow {
	key: GoalMetric;
	label: string;
	goal: Cents;
	actual: Cents;
	/** Fracción del objetivo ya alcanzada (1 = cumplido); `null` si el objetivo es cero. */
	achieved: number | null;
	/** El objetivo es un máximo que no conviene superar (gastos), no una cifra a alcanzar. */
	ceiling: boolean;
}

/**
 * Fracción transcurrida del año `year` al cierre del día `date` (AAAA-MM-DD):
 * 0 antes de empezar, 1 una vez terminado.
 */
export function yearFraction(year: number, date: string): number {
	const start = Date.UTC(year, 0, 1);
	const end = Date.UTC(year + 1, 0, 1);
	const day = Date.parse(`${date}T00:00:00Z`) + 86400000;
	return Math.min(1, Math.max(0, (day - start) / (end - start)));
}

/** Consecución de cada métrica con objetivo, en el orden de `GOAL_METRICS`. */
export function goalProgress(metrics: YearMetrics | undefined, goals: Goals): GoalRow[] {
	const rows: GoalRow[] = [];
	for (const m of GOAL_METRICS) {
		const goal = goals[m.key];
		if (goal == null) continue;
		const actual = metrics ? m.value(metrics) : 0;
		rows.push({ key: m.key, label: m.label, goal, actual, achieved: goal === 0 ? null : actual / goal, ceiling: 'ceiling' in m });
	}
	return rows;
}

/** Objetivos anuales de cada cartera (RF-26). Cada cambio deja rastro en `audit_log`. */
import type { DatabaseSync } from 'node:sqlite';
import { parseDecimal } from '../engine/form.ts';
import { GOAL_METRICS, isGoalMetric, type Goals } from '../engine/goals.ts';

export function loadGoals(db: DatabaseSync, portfolioId: number, year: number): Goals {
	const goals: Goals = {};
	const rows = db.prepare('SELECT metric, amount_eur AS amount FROM goal WHERE portfolio_id = ? AND year = ?').all(portfolioId, year) as { metric: string; amount: number }[];
	for (const r of rows) if (isGoalMetric(r.metric)) goals[r.metric] = r.amount;
	return goals;
}

/** Años con algún objetivo anotado, del más reciente al más antiguo. */
export function goalYears(db: DatabaseSync, portfolioId: number): number[] {
	return (db.prepare('SELECT DISTINCT year FROM goal WHERE portfolio_id = ? ORDER BY year DESC').all(portfolioId) as { year: number }[]).map((r) => r.year);
}

export type GoalsResult = { ok: true; goals: Goals } | { ok: false; errors: string[] };

/**
 * Sustituye los objetivos de un año por los tecleados (`fields`, un importe en euros por clave de métrica).
 * Una métrica en blanco se queda sin objetivo.
 */
export function saveGoals(db: DatabaseSync, portfolioId: number, year: number, fields: Record<string, string>): GoalsResult {
	if (!Number.isInteger(year) || year < 1990 || year > 2200) return { ok: false, errors: ['El año no es válido.'] };
	if (!db.prepare('SELECT 1 FROM portfolio WHERE id = ?').get(portfolioId)) return { ok: false, errors: ['La cartera no existe.'] };
	const errors: string[] = [];
	const goals: Goals = {};
	for (const m of GOAL_METRICS) {
		const amount = parseDecimal(fields[m.key]);
		if (amount == null) continue;
		if (!Number.isFinite(amount) || amount < 0) errors.push(`El objetivo de «${m.label}» no es un importe válido.`);
		else goals[m.key] = Math.round(amount * 100);
	}
	if (errors.length) return { ok: false, errors };

	const before = loadGoals(db, portfolioId, year);
	if (JSON.stringify(before) === JSON.stringify(goals)) return { ok: true, goals };
	db.exec('BEGIN IMMEDIATE');
	try {
		db.prepare('DELETE FROM goal WHERE portfolio_id = ? AND year = ?').run(portfolioId, year);
		const insert = db.prepare('INSERT INTO goal (portfolio_id, year, metric, amount_eur) VALUES (?,?,?,?)');
		for (const [metric, amount] of Object.entries(goals)) insert.run(portfolioId, year, metric, amount);
		const had = Object.keys(before).length > 0;
		db.prepare('INSERT INTO audit_log (entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?)').run('goal', portfolioId, had ? 'update' : 'create', had ? JSON.stringify({ year, ...before }) : null, JSON.stringify({ year, ...goals }));
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
	return { ok: true, goals };
}

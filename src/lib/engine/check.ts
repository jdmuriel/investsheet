/** Validación de un cambio en el registro: se recalcula todo con y sin él y se comparan los resultados. */
import { run, totalShares } from './engine.ts';
import type { Cents, Micro, Operation } from './types.ts';

/** Acciones de un valor justo antes de la posición `(date, seq)`, sin contar la operación `excludeId`. */
export function sharesBefore(operations: Operation[], at: { date: string; seq: number; excludeId?: number }, securityId: number): Micro {
	const previous = operations.filter((o) => o.id !== at.excludeId && (o.date < at.date || (o.date === at.date && o.seq < at.seq)));
	return totalShares(run(previous).state.positions.get(securityId));
}

export interface ChangeCheck {
	/** Impiden guardar: el cambio vende acciones que no hay o deja un ajuste imposible. */
	errors: string[];
	/** Piden confirmación: alguna cuenta pasa a tener saldo negativo. */
	warnings: string[];
}

interface Scan {
	problems: Set<string>;
	/** Saldos negativos tras cada operación: `idOperación:idCuenta` → fecha e importe. */
	negatives: Map<string, { accountId: number; date: string; amount: Cents; own: boolean }>;
	ids: Set<number>;
}

function scan(operations: Operation[]): Scan {
	const negatives: Scan['negatives'] = new Map();
	const dates = new Map<number, string>();
	const { warnings } = run(operations, {
		onRow: (op, state) => {
			dates.set(op.id, op.date);
			for (const [accountId, amount] of state.cash)
				if (amount < 0) negatives.set(`${op.id}:${accountId}`, { accountId, date: op.date, amount, own: op.cash.some((c) => c.accountId === accountId && c.amount < 0) });
		}
	});
	return { problems: new Set(warnings.map((w) => `${dates.get(w.operationId) ?? ''}: ${w.message}`)), negatives, ids: new Set(dates.keys()) };
}

const esDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Compara el registro antes y después de un alta, edición o borrado. Solo cuenta lo que el
 * cambio empeora: los avisos y saldos negativos que ya existían no bloquean.
 */
export function checkChange(before: Operation[], after: Operation[], accountNames: Map<number, string>): ChangeCheck {
	const a = scan(before);
	const b = scan(after);
	const errors = [...b.problems].filter((p) => !a.problems.has(p)).map((p) => `${esDate(p.slice(0, 10))}${p.slice(10)}.`);
	const warned = new Set<number>();
	const warnings: string[] = [];
	for (const [key, n] of b.negatives) {
		const opId = Number(key.split(':')[0]);
		// Una operación nueva solo cuenta si es ella la que saca dinero de la cuenta.
		const isNew = a.ids.has(opId) ? !a.negatives.has(key) : n.own;
		if (!isNew || warned.has(n.accountId)) continue;
		warned.add(n.accountId);
		warnings.push(`La cuenta ${accountNames.get(n.accountId) ?? n.accountId} queda en negativo (${(n.amount / 100).toFixed(2)}) el ${esDate(n.date)}.`);
	}
	return { errors, warnings };
}

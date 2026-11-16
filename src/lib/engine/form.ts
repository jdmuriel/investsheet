/** Interpretación de los campos de texto del formulario de operaciones. */
import { emptyInput, isOperationType, type OperationInput } from './operations.ts';
import { MICRO } from './types.ts';

/** Campos del formulario tal como se teclean; se guardan con la operación para poder reeditarla. */
export type RawInput = Record<string, string>;

/**
 * Número tecleado, con coma o punto decimal («1.234,56», «1234.56», «0,5»).
 * Devuelve `null` si está vacío y `NaN` si no se entiende.
 */
export function parseDecimal(text: string | undefined): number | null {
	const t = (text ?? '').replace(/[\s€$£]/g, '');
	if (!t) return null;
	const normalized = t.includes(',') ? t.replaceAll('.', '').replace(',', '.') : t;
	return /^-?\d*\.?\d+$/.test(normalized) || /^-?\d+\.$/.test(normalized) ? Number(normalized) : NaN;
}

export function parseInput(raw: RawInput): { input: OperationInput | null; errors: string[] } {
	const errors: string[] = [];
	const type = raw.type ?? '';
	if (!isOperationType(type)) return { input: null, errors: ['Tipo de operación desconocido.'] };
	const number = (key: string, label: string): number | null => {
		const n = parseDecimal(raw[key]);
		if (Number.isNaN(n)) errors.push(`«${raw[key]}» no es un número válido (${label}).`);
		return Number.isNaN(n) ? null : n;
	};
	const cents = (key: string, label: string) => Math.round((number(key, label) ?? 0) * 100);
	const id = (key: string) => (/^\d+$/.test(raw[key] ?? '') ? Number(raw[key]) : null);

	const input = emptyInput(type, raw.date ?? '');
	input.accountId = id('account');
	input.toAccountId = id('toAccount');
	input.securityId = id('security');
	input.toSecurityId = id('toSecurity');
	input.quantity = Math.round((number('quantity', 'cantidad') ?? 0) * MICRO);
	input.price = number('price', 'precio') ?? 0;
	input.currency = (raw.currency ?? '').trim().toUpperCase();
	input.fxRate = number('fxRate', 'tipo de cambio') ?? 0;
	input.amount = cents('amount', 'importe');
	input.amountTo = cents('amountTo', 'importe que entra');
	input.whtSource = cents('whtSource', 'retención en origen');
	input.whtDest = cents('whtDest', 'retención');
	input.fees = cents('fees', 'gastos');
	const total = number('cashTotal', 'total en cuenta');
	input.cashTotal = total == null ? null : Math.round(total * 100);
	input.ratioNew = number('ratioNew', 'proporción') ?? 0;
	input.ratioOld = number('ratioOld', 'proporción') ?? 0;
	const after = number('sharesAfter', 'acciones resultantes');
	input.sharesAfter = after == null ? null : Math.round(after * MICRO);
	input.costMoved = cents('costMoved', 'coste');
	input.description = (raw.description ?? '').trim();
	return { input: errors.length ? null : input, errors };
}

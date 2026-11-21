/** Alta, edición, borrado y reordenación de operaciones. Cada cambio va en una transacción y deja rastro en `audit_log`. */
import type { DatabaseSync } from 'node:sqlite';
import { checkChange, sharesBefore } from '../engine/check.ts';
import { run, totalShares } from '../engine/engine.ts';
import { parseInput, type RawInput } from '../engine/form.ts';
import { buildOperation, type BuildContext, type BuiltOperation } from '../engine/operations.ts';
import type { Operation } from '../engine/types.ts';
import { listAccounts, listSecurities, loadOperations } from './store.ts';

/** Saldo en que queda una cuenta tocada por la operación, justo tras ella. */
export interface ResultingBalance {
	accountId: number;
	amount: number;
}
export type SubmitResult = { ok: true; id: number; description?: string; balances?: ResultingBalance[]; operation?: BuiltOperation } | { ok: false; errors: string[]; warnings: string[] };

export interface SaveOptions {
	/** Acepta los avisos (saldo negativo). */
	confirmed?: boolean;
	/** Valida y calcula, pero no guarda nada. */
	dryRun?: boolean;
	/** Origen que se anota en la operación: `manual` (formulario) o `api`. */
	source?: 'manual' | 'api';
}

/** Operación guardada, con lo necesario para rellenar el formulario de edición. */
export interface OperationRecord {
	id: number;
	portfolioId: number;
	date: string;
	seq: number;
	type: string;
	source: string;
	description: string;
	notes: string;
	/** Campos del formulario: los guardados o, en las operaciones importadas, los deducidos de la cabecera. */
	raw: RawInput;
	/** Las operaciones importadas conservan sus efectos salvo que se pida recalcularlos. */
	imported: boolean;
	cash: { accountId: number; amount: number }[];
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
	db.exec('BEGIN IMMEDIATE');
	try {
		const result = work();
		db.exec('COMMIT');
		return result;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}

/** Fila completa con sus efectos, para el registro de auditoría. */
function snapshot(db: DatabaseSync, id: number): string | null {
	const operation = db.prepare('SELECT * FROM operation WHERE id = ?').get(id);
	if (!operation) return null;
	const cash = db.prepare('SELECT account_id, amount FROM cash_leg WHERE operation_id = ? ORDER BY id').all(id);
	const positions = db.prepare('SELECT security_id, kind, shares, cost_eur, reduced_cost_eur, proceeds_eur, to_security_id FROM position_leg WHERE operation_id = ? ORDER BY id').all(id);
	return JSON.stringify({ ...operation, cash, positions });
}

function audit(db: DatabaseSync, id: number, action: 'create' | 'update' | 'delete' | 'move', before: string | null, after: string | null): void {
	db.prepare('INSERT INTO audit_log (entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?)').run('operation', id, action, before, after);
}

const decimal = (n: number | null | undefined, digits = 6) => (n == null ? '' : String(Math.round(n * 10 ** digits) / 10 ** digits));
const money = (cents: number | null | undefined) => (cents == null || cents === 0 ? '' : (Math.abs(cents) / 100).toFixed(2));

export function getOperation(db: DatabaseSync, id: number): OperationRecord | null {
	const r = db.prepare('SELECT * FROM operation WHERE id = ?').get(id) as Record<string, string | number | null> | undefined;
	if (!r) return null;
	const cash = db.prepare('SELECT account_id AS accountId, amount FROM cash_leg WHERE operation_id = ? ORDER BY id').all(id) as unknown as OperationRecord['cash'];
	let raw: RawInput;
	if (r.input_json) raw = JSON.parse(String(r.input_json)) as RawInput;
	else {
		// Operación importada: se propone lo que se deduce de la cabecera, para revisarlo antes de recalcular.
		const local = (value: unknown, eur: unknown) => money((value as number | null) ?? (eur as number));
		const other = cash.find((c) => c.accountId !== r.account_id);
		const tax = r.wht_source_local == null ? local(r.tax_local, r.tax_eur) : money(r.wht_dest_local as number | null);
		// La hoja solo guarda la retención total: en un broker extranjero es toda en origen; en uno español, en destino.
		const foreign = r.wht_source_local == null && r.account_id != null && Boolean((db.prepare('SELECT foreign_broker FROM account WHERE id = ?').get(r.account_id) as { foreign_broker: number } | undefined)?.foreign_broker);
		raw = {
			account: r.account_id == null ? '' : String(r.account_id),
			toAccount: other ? String(other.accountId) : '',
			security: r.security_id == null ? '' : String(r.security_id),
			quantity: decimal(r.quantity as number | null),
			price: decimal(r.price as number | null),
			currency: String(r.currency ?? ''),
			fxRate: decimal(r.fx_rate as number | null, 9),
			amount: local(r.amount_local, (r.gross_eur as number) || (r.purchase_eur as number) || (r.capital_in_eur as number) || (r.capital_out_eur as number)),
			whtSource: foreign ? tax : money(r.wht_source_local as number | null),
			whtDest: foreign ? '' : tax,
			fees: local(r.fees_local, r.fees_eur)
		};
	}
	return {
		id,
		portfolioId: Number(r.portfolio_id),
		date: String(r.date),
		seq: Number(r.seq),
		type: String(r.type),
		source: String(r.source),
		description: String(r.description ?? ''),
		notes: String(r.notes ?? ''),
		raw: { ...raw, type: String(r.type), date: String(r.date), notes: String(r.notes ?? ''), description: r.input_json ? (raw.description ?? '') : String(r.description ?? '') },
		imported: !r.input_json,
		cash
	};
}

function endOfDay(db: DatabaseSync, portfolioId: number, date: string): number {
	return (db.prepare('SELECT coalesce(max(seq), 0) + 1 AS seq FROM operation WHERE portfolio_id = ? AND date = ?').get(portfolioId, date) as { seq: number }).seq;
}

/** Valor elegido en el formulario; «nuevo» da de alta el ticker tecleado (o reutiliza el que ya exista). */
function resolveSecurity(db: DatabaseSync, raw: RawInput, field: 'security' | 'toSecurity', tickerField: string, errors: string[]): void {
	if (raw[field] !== 'nuevo') return;
	const ticker = (raw[tickerField] ?? '').trim().toUpperCase();
	if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) {
		errors.push('El ticker del valor nuevo debe tener entre 1 y 12 letras, cifras o puntos.');
		return;
	}
	const existing = db.prepare('SELECT id FROM security WHERE ticker = ?').get(ticker) as { id: number } | undefined;
	const id = existing?.id ?? Number(db.prepare('INSERT INTO security (ticker, currency) VALUES (?, ?)').run(ticker, (raw.currency ?? '').trim().toUpperCase() || null).lastInsertRowid);
	raw[field] = String(id);
	delete raw[tickerField];
}

/**
 * Valor de una operación que conserva sus efectos: el que tiene, o el pedido en `wanted` (identificador).
 * Sirve para corregir el ticker mal anotado de un dividendo importado. Si la operación mueve acciones,
 * el valor debe ser uno de los que mueve: así la cabecera no contradice a sus efectos.
 */
function keptSecurity(db: DatabaseSync, id: number, wanted: string | undefined, fail: (errors: string[]) => never): number | null {
	const current = (db.prepare('SELECT security_id AS securityId FROM operation WHERE id = ?').get(id) as { securityId: number | null }).securityId;
	if (!wanted || wanted === String(current)) return current;
	const security = /^\d+$/.test(wanted) ? (db.prepare('SELECT id FROM security WHERE id = ?').get(Number(wanted)) as { id: number } | undefined) : undefined;
	if (!security) return fail(['El valor no existe.']);
	const legs = db.prepare('SELECT DISTINCT s.id, s.ticker FROM position_leg l JOIN security s ON s.id = l.security_id WHERE l.operation_id = ?').all(id) as { id: number; ticker: string }[];
	if (legs.length && !legs.some((l) => l.id === security.id)) return fail([`Las acciones de esta operación son de ${legs.map((l) => l.ticker).join(', ')}: el valor tiene que ser uno de ellos.`]);
	return security.id;
}

/**
 * Moneda de una operación que conserva sus efectos: la que tiene, o la pedida en `wanted`. Solo cambia la etiqueta
 * de los importes en moneda local (una moneda mal anotada en la hoja); los importes en euros y el cambio no se tocan.
 */
function keptCurrency(db: DatabaseSync, id: number, wanted: string | undefined, fail: (errors: string[]) => never): string | null {
	const current = (db.prepare('SELECT currency FROM operation WHERE id = ?').get(id) as { currency: string | null }).currency;
	const code = (wanted ?? '').toUpperCase();
	if (!code || code === current) return current;
	return /^[A-Z]{3}$/.test(code) ? code : fail(['La moneda debe ser un código de tres letras, como USD.']);
}

function checkAgainstLedger(db: DatabaseSync, portfolioId: number, before: Operation[], after: Operation[], confirmed: boolean): { errors: string[]; warnings: string[] } | null {
	const names = new Map(listAccounts(portfolioId, db).map((a) => [a.id, a.name]));
	const { errors, warnings } = checkChange(before, after, names);
	return errors.length > 0 || (warnings.length > 0 && !confirmed) ? { errors, warnings } : null;
}

/**
 * Lógica de `saveOperation`. Guarda una operación nueva (`id` nulo) o los cambios de una existente a partir de los campos
 * del formulario. Si `raw.keepEffects` es «1» (operaciones importadas) solo cambian fecha,
 * descripción, notas, el valor al que se atribuye y la etiqueta de su moneda; si no, los efectos se generan de nuevo. Los avisos (saldo negativo)
 * necesitan `confirmed`.
 */
function submit(db: DatabaseSync, portfolioId: number, id: number | null, form: RawInput, { confirmed = false, dryRun = false, source = 'manual' }: SaveOptions): SubmitResult {
	const raw: RawInput = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()]));
	const keepEffects = raw.keepEffects === '1';
	const notes = raw.notes ?? '';
	for (const key of ['notes', 'keepEffects', 'confirm', 'next']) delete raw[key];

	return transaction(db, (): SubmitResult => {
		const fail: (errors: string[], warnings?: string[]) => never = (errors, warnings = []) => {
			throw new Rejected({ ok: false, errors, warnings });
		};
		const existing = id == null ? null : getOperation(db, id);
		if (id != null && (!existing || existing.portfolioId !== portfolioId)) fail(['La operación ya no existe.']);
		const before = loadOperations(portfolioId, db);
		const date = raw.date ?? '';
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) fail(['La fecha no es válida.']);
		const seq = existing && existing.date === date ? existing.seq : endOfDay(db, portfolioId, date);

		if (keepEffects) {
			if (!existing) return fail(['No se puede dar de alta una operación sin efectos.']);
			const current = before.find((o) => o.id === id)!;
			const securityId = keptSecurity(db, id!, raw.security, fail);
			const currency = keptCurrency(db, id!, raw.currency, fail);
			const problem = checkAgainstLedger(db, portfolioId, before, before.map((o) => (o.id === id ? { ...current, date, seq, securityId } : o)), confirmed);
			if (problem) fail(problem.errors, problem.warnings);
			if (dryRun) throw new Rejected({ ok: true, id: id!, description: raw.description || existing.description });
			const old = snapshot(db, id!);
			db.prepare("UPDATE operation SET date = ?, seq = ?, description = ?, notes = ?, security_id = ?, currency = ?, updated_at = datetime('now') WHERE id = ?").run(date, seq, raw.description || existing.description, notes || null, securityId, currency, id);
			audit(db, id!, 'update', old, snapshot(db, id!));
			return { ok: true, id: id! };
		}

		const problems: string[] = [];
		resolveSecurity(db, raw, 'security', 'newTicker', problems);
		resolveSecurity(db, raw, 'toSecurity', 'newToTicker', problems);
		const { input, errors } = parseInput(raw);
		problems.push(...errors);
		if (!input || problems.length) return fail(problems);

		const ctx: BuildContext = {
			accounts: new Map(listAccounts(portfolioId, db).map((a) => [a.id, a])),
			securities: new Map(listSecurities(db).map((s) => [s.id, s])),
			sharesHeld: (securityId) => sharesBefore(before, { date, seq, excludeId: id ?? undefined }, securityId)
		};
		const result = buildOperation(input, ctx);
		if (!result.ok) return fail(result.errors);
		const built = result.operation;

		const candidate: Operation = { ...built, id: id ?? -1, seq };
		const after = id == null ? [...before, candidate] : before.map((o) => (o.id === id ? candidate : o));
		const problem = checkAgainstLedger(db, portfolioId, before, after, confirmed);
		if (problem) fail(problem.errors, problem.warnings);

		const balances: ResultingBalance[] = [];
		run(after, {
			onRow: (op, state) => {
				if (op.id === candidate.id) for (const leg of built.cash) balances.push({ accountId: leg.accountId, amount: state.cash.get(leg.accountId) ?? 0 });
			}
		});
		if (dryRun) throw new Rejected({ ok: true, id: id ?? 0, description: built.description, balances, operation: built });

		const old = id == null ? null : snapshot(db, id);
		const savedId = write(db, portfolioId, id, seq, built, notes, raw, source);
		audit(db, savedId, id == null ? 'create' : 'update', old, snapshot(db, savedId));
		return { ok: true, id: savedId, description: built.description, balances, operation: built };
	});
}

/** Rechazo de validación o simulación: deshace la transacción y se devuelve como resultado, no como error. */
class Rejected extends Error {
	result: SubmitResult;
	constructor(result: SubmitResult) {
		super('rechazado');
		this.result = result;
	}
}
function rejected<T extends SubmitResult>(work: () => T): SubmitResult {
	try {
		return work();
	} catch (e) {
		if (e instanceof Rejected) return e.result;
		throw e;
	}
}

function write(db: DatabaseSync, portfolioId: number, id: number | null, seq: number, op: BuiltOperation, notes: string, raw: RawInput, source: string): number {
	const values = [
		op.date, seq, op.type, op.accountId, op.securityId, op.quantity, op.price, op.currency, op.fxRate,
		op.amountLocal, op.taxLocal, op.whtSourceLocal, op.whtDestLocal, op.feesLocal,
		op.grossEur, op.taxEur, op.feesEur, op.capitalInEur, op.capitalOutEur, op.purchaseEur,
		op.description, notes || null, JSON.stringify(raw)
	];
	const columns = `date, seq, type, account_id, security_id, quantity, price, currency, fx_rate,
		amount_local, tax_local, wht_source_local, wht_dest_local, fees_local,
		gross_eur, tax_eur, fees_eur, capital_in_eur, capital_out_eur, purchase_eur, description, notes, input_json`;
	let savedId: number;
	if (id == null) {
		const marks = values.map(() => '?').join(',');
		savedId = Number(db.prepare(`INSERT INTO operation (portfolio_id, source, ${columns}) VALUES (?, ?, ${marks})`).run(portfolioId, source, ...values).lastInsertRowid);
	} else {
		const sets = columns.split(',').map((c) => `${c.trim()} = ?`).join(', ');
		db.prepare(`UPDATE operation SET ${sets}, source = ?, updated_at = datetime('now') WHERE id = ?`).run(...values, source, id);
		db.prepare('DELETE FROM cash_leg WHERE operation_id = ?').run(id);
		db.prepare('DELETE FROM position_leg WHERE operation_id = ?').run(id);
		savedId = id;
	}
	const insertCash = db.prepare('INSERT INTO cash_leg (operation_id, account_id, amount) VALUES (?,?,?)');
	for (const leg of op.cash) insertCash.run(savedId, leg.accountId, leg.amount);
	const insertLeg = db.prepare('INSERT INTO position_leg (operation_id, security_id, kind, shares, cost_eur, reduced_cost_eur, proceeds_eur, to_security_id) VALUES (?,?,?,?,?,?,?,?)');
	for (const leg of op.positions) insertLeg.run(savedId, leg.securityId, leg.kind, leg.shares, leg.cost, leg.reducedCost, leg.proceeds ?? null, leg.toSecurityId ?? null);
	return savedId;
}

export function saveOperation(db: DatabaseSync, portfolioId: number, id: number | null, form: RawInput, options: boolean | SaveOptions = {}): SubmitResult {
	return rejected(() => submit(db, portfolioId, id, form, typeof options === 'boolean' ? { confirmed: options } : options));
}

export function deleteOperation(db: DatabaseSync, portfolioId: number, id: number, confirmed = false): SubmitResult {
	return rejected(() =>
		transaction(db, (): SubmitResult => {
			const existing = getOperation(db, id);
			if (!existing || existing.portfolioId !== portfolioId) throw new Rejected({ ok: false, errors: ['La operación ya no existe.'], warnings: [] });
			const before = loadOperations(portfolioId, db);
			const problem = checkAgainstLedger(db, portfolioId, before, before.filter((o) => o.id !== id), confirmed);
			if (problem) throw new Rejected({ ok: false, ...problem });
			const old = snapshot(db, id);
			db.prepare('DELETE FROM operation WHERE id = ?').run(id);
			audit(db, id, 'delete', old, null);
			return { ok: true, id };
		})
	);
}

/** Operaciones del mismo día y cartera, en su orden. */
export function listDay(db: DatabaseSync, portfolioId: number, date: string): { id: number; seq: number; description: string }[] {
	return db.prepare('SELECT id, seq, description FROM operation WHERE portfolio_id = ? AND date = ? ORDER BY seq, id').all(portfolioId, date) as unknown as { id: number; seq: number; description: string }[];
}

/** Sube (`-1`) o baja (`1`) una operación dentro de su día, renumerando el orden del día. */
export function moveOperation(db: DatabaseSync, portfolioId: number, id: number, direction: -1 | 1): SubmitResult {
	return rejected(() =>
		transaction(db, (): SubmitResult => {
			const existing = getOperation(db, id);
			if (!existing || existing.portfolioId !== portfolioId) throw new Rejected({ ok: false, errors: ['La operación ya no existe.'], warnings: [] });
			const day = listDay(db, portfolioId, existing.date);
			const from = day.findIndex((o) => o.id === id);
			const to = from + direction;
			if (to < 0 || to >= day.length) return { ok: true, id };
			[day[from], day[to]] = [day[to], day[from]];
			const before = loadOperations(portfolioId, db);
			const order = new Map(day.map((o, i) => [o.id, i + 1]));
			const problem = checkAgainstLedger(db, portfolioId, before, before.map((o) => (order.has(o.id) ? { ...o, seq: order.get(o.id)! } : o)), true);
			if (problem) throw new Rejected({ ok: false, ...problem });
			const update = db.prepare("UPDATE operation SET seq = ?, updated_at = datetime('now') WHERE id = ?");
			for (const [opId, seq] of order) update.run(seq, opId);
			audit(db, id, 'move', JSON.stringify({ seq: existing.seq }), JSON.stringify({ seq: order.get(id) }));
			return { ok: true, id };
		})
	);
}

/** Datos que necesita el formulario: listas para elegir y saldos y acciones actuales, sin contar la operación `excludeId`. */
export function formContext(db: DatabaseSync, portfolioId: number, excludeId?: number) {
	const accounts = listAccounts(portfolioId, db);
	const securities = listSecurities(db);
	const { state } = run(loadOperations(portfolioId, db).filter((o) => o.id !== excludeId));
	const holdings: Record<number, number> = {};
	for (const [id, position] of state.positions) {
		const shares = totalShares(position);
		if (shares !== 0) holdings[id] = shares;
	}
	const balances: Record<number, number> = {};
	for (const a of accounts) balances[a.id] = state.cash.get(a.id) ?? 0;
	const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
	return { accounts, securities, holdings, balances, today };
}

/** Campos de un formulario enviado, como texto. */
export function rawFromForm(data: FormData): RawInput {
	const raw: RawInput = {};
	for (const [key, value] of data) if (typeof value === 'string') raw[key] = value;
	return raw;
}

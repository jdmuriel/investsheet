/**
 * Lógica de la API (`/api/v1`): consultas y cambios en JSON para un asistente o un script.
 * Escribe por la misma vía que el formulario (`saveOperation`), con sus validaciones y auditoría.
 * Importes en unidades de su moneda y acciones en unidades, no en céntimos ni millonésimas.
 */
import type { DatabaseSync } from 'node:sqlite';
import { investedCapital, run, totalCost, totalReducedCost, totalShares } from '../engine/engine.ts';
import type { RawInput } from '../engine/form.ts';
import { OPERATION_TYPES, type BuiltOperation } from '../engine/operations.ts';
import { MICRO } from '../engine/types.ts';
import { listChanges, updateChangeCurrency } from './dividends.ts';
import { deleteSecurity, listSecurityRecords, saveSecurity, securityFields } from './masters.ts';
import { deleteOperation, getOperation, saveOperation, type SubmitResult } from './operations.ts';
import { listAccounts, listSecurities, loadOperations, type Account, type OperationRow } from './store.ts';

/** Respuesta de la API: código HTTP y cuerpo JSON. */
export interface ApiResponse {
	status: number;
	body: unknown;
}
const ok = (body: unknown, status = 200): ApiResponse => ({ status, body });
const problem = (status: number, error: string, extra: object = {}): ApiResponse => ({ status, body: { error, ...extra } });

const units = (cents: number) => cents / 100;
const shares = (micro: number) => micro / MICRO;

const FORM_FIELDS = [
	'type', 'date', 'account', 'toAccount', 'security', 'toSecurity', 'quantity', 'price', 'currency', 'fxRate', 'amount', 'amountTo',
	'whtSource', 'whtDest', 'fees', 'cashTotal', 'ratioNew', 'ratioOld', 'sharesAfter', 'costMoved', 'description', 'notes'
];
const FLAGS = ['confirm', 'dryRun', 'keepEffects', 'createSecurity'];

function portfolios(db: DatabaseSync): { id: number; name: string }[] {
	return db.prepare('SELECT id, name FROM portfolio ORDER BY sort_order, id').all() as unknown as { id: number; name: string }[];
}

/** Cartera por identificador o por nombre (sin distinguir mayúsculas). */
export function findPortfolio(db: DatabaseSync, key: string): { id: number; name: string } | null {
	return portfolios(db).find((p) => String(p.id) === key || p.name.toLowerCase() === key.toLowerCase()) ?? null;
}

/** Guía de uso: carteras, cuentas, tipos de operación con sus campos y rutas disponibles. */
export function apiIndex(db: DatabaseSync): ApiResponse {
	return ok({
		portfolios: portfolios(db).map((p) => ({ ...p, accounts: listAccounts(p.id, db).map((a) => ({ code: a.code, name: a.name, currency: a.currency })) })),
		endpoints: {
			'GET /api/v1': 'Esta guía.',
			'GET /api/v1/valores': 'Valores conocidos, con moneda, retenciones y si están activos.',
			'PATCH /api/v1/valores/{ticker}': 'Cambia solo los datos enviados de un valor: name, priceTicker, country, currency, sector, supersector, zone, tier, active, reinvest, whtSourcePct y whtDestPct (en porcentaje, 15 = 15 %), targetPrice y dividendEstimate (en la moneda del valor). zone es una de España, EE. UU., Resto del mundo; tier, T1, T2, T3 o null.',
			'GET /api/v1/cambios-dividendo?valor=': 'Cambios de dividendo anotados (dividendo anual anterior y nuevo, moneda y cambio).',
			'PATCH /api/v1/cambios-dividendo/{id}': 'Corrige la moneda («currency») y, si se quiere, el cambio («fxRate») de un cambio de dividendo; sin fxRate se toma el del día.',
			'DELETE /api/v1/valores/{ticker}?confirm=1': 'Borra un valor que no usa ninguna operación (un ticker mal tecleado). Uno con historia se marca inactivo.',
			'GET /api/v1/carteras/{cartera}/estado?fecha=AAAA-MM-DD': 'Saldos, capital, resultado del año, posiciones y métricas anuales a una fecha (por defecto, hoy).',
			'GET /api/v1/carteras/{cartera}/operaciones?desde=&hasta=&tipo=&valor=&cuenta=&texto=&limite=': 'Operaciones que cumplen los filtros; las más recientes si hay más que el límite (50 por defecto).',
			'POST /api/v1/carteras/{cartera}/operaciones': 'Da de alta una operación.',
			'GET /api/v1/operaciones/{id}': 'Una operación con sus campos y efectos.',
			'PUT /api/v1/operaciones/{id}': 'Sustituye una operación: hay que enviar todos sus campos.',
			'DELETE /api/v1/operaciones/{id}?confirm=1': 'Borra una operación.'
		},
		writing: [
			'Todas las peticiones llevan «Authorization: Bearer <token>». Las de escritura (POST, PUT y también DELETE) deben llevar además «Content-Type: application/json»; sin ella el servidor responde 403.',
			'{cartera} es el id o el nombre de la cartera.',
			'El cuerpo es JSON con «type», «date» (AAAA-MM-DD) y los campos del tipo, listados en «types». Los que acaban en «(opcional)» se pueden omitir.',
			'«account» y «toAccount» son el código de la cuenta; «security» y «toSecurity», el ticker. Para un ticker que no existe, añade "createSecurity": true.',
			'Los números van como número JSON o como texto con coma o punto decimal.',
			'«amount» y las retenciones van en la moneda de la operación («currency»); «fees» y «cashTotal», en la de la cuenta. «fxRate» son unidades de la moneda por euro y solo hace falta si la moneda no es EUR.',
			'Si falta «amount» se calcula como quantity × price. Si se da «cashTotal» (lo abonado o cargado en la cuenta), los gastos son la diferencia.',
			'"dryRun": true valida y devuelve el resultado sin guardar nada: úsalo para enseñar la operación antes de anotarla.',
			'Un 409 trae avisos (por ejemplo, saldo negativo): se repite con "confirm": true si procede. Un 422 trae errores que hay que corregir.',
			'Las operaciones importadas de la hoja antigua («imported») solo admiten cambiar fecha, descripción, notas, el valor («security») al que se atribuyen y la etiqueta de su moneda («currency»), con "keepEffects": true. Si mueven acciones, el valor debe ser el de esas acciones.'
		],
		types: Object.fromEntries(Object.entries(OPERATION_TYPES).map(([code, d]) => [code, { label: d.label, fields: d.fields }]))
	});
}

export function apiSecurities(db: DatabaseSync): ApiResponse {
	return ok(
		listSecurityRecords(db).map((s) => ({ ticker: s.ticker, name: s.name, priceTicker: s.priceTicker, currency: s.currency, zone: s.zone, tier: s.tier, targetPrice: s.targetPrice, whtSourcePct: s.whtSourcePct, whtDestPct: s.whtDestPct, active: s.active === 1, uses: s.uses }))
	);
}

const SECURITY_TEXT = ['name', 'priceTicker', 'country', 'currency', 'sector', 'supersector', 'zone', 'tier'];
const SECURITY_FLAGS = ['active', 'reinvest'];
const SECURITY_PERCENTS = ['whtSourcePct', 'whtDestPct', 'targetPrice', 'dividendEstimate'];

const findSecurity = (db: DatabaseSync, ticker: string) => listSecurityRecords(db).find((s) => s.ticker === ticker.toUpperCase()) ?? null;

/** Cambia solo los datos enviados de un valor; el resto se queda como está. */
export function apiPatchSecurity(db: DatabaseSync, ticker: string, body: unknown): ApiResponse {
	const record = findSecurity(db, ticker);
	if (!record) return problem(404, `No existe el valor «${ticker}».`);
	if (body == null || typeof body !== 'object' || Array.isArray(body)) return problem(422, 'El cuerpo debe ser un objeto JSON.', { errors: [] });
	const fields = securityFields(record);
	const errors: string[] = [];
	for (const [key, value] of Object.entries(body)) {
		if (SECURITY_TEXT.includes(key) && (value === null || typeof value === 'string')) fields[key] = value ?? '';
		else if (SECURITY_FLAGS.includes(key) && typeof value === 'boolean') fields[key] = value ? '1' : '0';
		else if (SECURITY_PERCENTS.includes(key) && (value === null || typeof value === 'number')) fields[key] = value == null ? '' : String(value);
		else if (SECURITY_PERCENTS.includes(key)) errors.push(`El campo «${key}» debe ser un número o null.`);
		else if (SECURITY_TEXT.includes(key) || SECURITY_FLAGS.includes(key)) errors.push(`El campo «${key}» debe ser ${SECURITY_FLAGS.includes(key) ? 'true o false' : 'texto o null'}.`);
		else errors.push(`Campo desconocido: «${key}».`);
	}
	if (errors.length) return problem(422, 'Los datos del valor no son válidos.', { errors });
	const result = saveSecurity(db, record.id, fields);
	if (!result.ok) return problem(422, 'Los datos del valor no son válidos.', { errors: result.errors });
	return ok({ saved: true, ...(apiSecurities(db).body as { ticker: string }[]).find((s) => s.ticker === record.ticker) });
}

export function apiDeleteSecurity(db: DatabaseSync, ticker: string, confirmed: boolean): ApiResponse {
	const record = findSecurity(db, ticker);
	if (!record) return problem(404, `No existe el valor «${ticker}».`);
	if (record.uses === 0 && !confirmed) return problem(409, 'El borrado no se puede deshacer: repítelo con ?confirm=1.', { errors: [], warnings: [] });
	const result = deleteSecurity(db, record.id);
	if (!result.ok) return problem(422, 'No se puede borrar el valor.', { errors: result.errors });
	return ok({ deleted: true, ticker: record.ticker });
}

/** Estado de una cartera a una fecha (inclusive). */
export function apiState(db: DatabaseSync, portfolioId: number, date: string | null): ApiResponse {
	if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return problem(400, 'La fecha debe tener el formato AAAA-MM-DD.');
	const { state, warnings } = run(loadOperations(portfolioId, db), { until: date ?? undefined });
	const tickers = new Map(listSecurities(db).map((s) => [s.id, s.ticker]));
	const positions = [...state.positions]
		.map(([id, p]) => {
			const n = totalShares(p);
			return {
				ticker: tickers.get(id) ?? String(id),
				shares: shares(n),
				cost: units(totalCost(p)),
				reducedCost: units(totalReducedCost(p)),
				averagePrice: n > 0 ? Math.round((totalCost(p) / n) * MICRO) / 100 : null,
				lots: p.lots.length,
				dividendsGross: units(p.dividendsGross),
				realizedGain: units(p.realizedGain)
			};
		})
		.filter((p) => p.shares !== 0 || p.cost !== 0)
		.sort((a, b) => a.ticker.localeCompare(b.ticker));
	return ok({
		date,
		cash: listAccounts(portfolioId, db).map((a) => ({ account: a.code, name: a.name, currency: a.currency, balance: units(state.cash.get(a.id) ?? 0) })),
		capitalContributed: units(state.capital),
		capitalInvested: units(investedCapital(state)),
		year: state.year,
		yearResult: units(state.yearResult),
		totalCost: units(positions.reduce((s, p) => s + Math.round(p.cost * 100), 0)),
		positions,
		years: [...state.years.values()].map((y) => ({ year: y.year, capital: units(y.capital), gross: units(y.gross), tax: units(y.tax), fees: units(y.fees), net: units(y.gross - y.tax - y.fees), purchases: units(y.purchases), realizedGain: units(y.realizedGain) })),
		engineWarnings: warnings.length
	});
}

function describeRow(op: OperationRow, accounts: Account[]) {
	const code = (id: number) => accounts.find((a) => a.id === id)?.code ?? String(id);
	return {
		id: op.id,
		date: op.date,
		type: op.type,
		description: op.description,
		security: op.ticker,
		account: op.accountCode,
		quantity: op.quantity,
		price: op.price,
		currency: op.currency,
		fxRate: op.fxRate,
		grossEur: units(op.grossEur),
		taxEur: units(op.taxEur),
		feesEur: units(op.feesEur),
		netEur: units(op.grossEur - op.taxEur - op.feesEur),
		capitalEur: units(op.capitalInEur - op.capitalOutEur),
		purchaseEur: units(op.purchaseEur),
		cash: op.cash.map((c) => ({ account: code(c.accountId), amount: units(c.amount) }))
	};
}

/** `maxLimit` solo lo sube el servidor MCP, que agrega dentro del proceso; por HTTP son 500. */
export function apiOperations(db: DatabaseSync, portfolioId: number, query: URLSearchParams, maxLimit = 500): ApiResponse {
	const accounts = listAccounts(portfolioId, db);
	const from = query.get('desde');
	const to = query.get('hasta');
	const type = query.get('tipo')?.toUpperCase();
	const ticker = query.get('valor')?.toUpperCase();
	const account = query.get('cuenta')?.toUpperCase();
	const text = query.get('texto')?.toLowerCase();
	const limit = Math.min(Math.max(Number(query.get('limite')) || 50, 1), maxLimit);
	const accountId = account ? accounts.find((a) => a.code.toUpperCase() === account)?.id : undefined;
	if (account && accountId == null) return problem(400, `No hay ninguna cuenta «${account}» en esta cartera.`);
	const matching = loadOperations(portfolioId, db).filter(
		(op) =>
			(!from || op.date >= from) &&
			(!to || op.date <= to) &&
			(!type || op.type === type) &&
			(!ticker || op.ticker?.toUpperCase() === ticker) &&
			(accountId == null || op.cash.some((c) => c.accountId === accountId)) &&
			(!text || op.description.toLowerCase().includes(text))
	);
	return ok({ total: matching.length, returned: Math.min(matching.length, limit), operations: matching.slice(-limit).map((op) => describeRow(op, accounts)) });
}

export function apiOperation(db: DatabaseSync, id: number): ApiResponse {
	const record = getOperation(db, id);
	if (!record) return problem(404, 'Operación no encontrada.');
	const accounts = listAccounts(record.portfolioId, db);
	const row = loadOperations(record.portfolioId, db).find((o) => o.id === id)!;
	const tickers = new Map(listSecurities(db).map((s) => [String(s.id), s.ticker]));
	const codes = new Map(accounts.map((a) => [String(a.id), a.code]));
	// Los campos se devuelven con códigos y tickers, listos para reenviarlos en un PUT.
	const fields: RawInput = { ...record.raw };
	for (const key of ['account', 'toAccount']) if (fields[key]) fields[key] = codes.get(fields[key]) ?? fields[key];
	for (const key of ['security', 'toSecurity']) if (fields[key]) fields[key] = tickers.get(fields[key]) ?? fields[key];
	return ok({
		...describeRow(row, accounts),
		portfolio: portfolios(db).find((p) => p.id === record.portfolioId)?.name,
		notes: record.notes,
		source: record.source,
		imported: record.imported,
		fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')),
		positions: row.positions.map((l) => ({ security: tickers.get(String(l.securityId)), kind: l.kind, shares: shares(l.shares), costEur: units(l.cost), reducedCostEur: units(l.reducedCost), proceedsEur: l.proceeds == null ? undefined : units(l.proceeds), toSecurity: l.toSecurityId == null ? undefined : tickers.get(String(l.toSecurityId)) }))
	});
}

/** Convierte el cuerpo JSON en los campos del formulario: códigos de cuenta y tickers pasan a identificadores. */
function toRaw(db: DatabaseSync, portfolioId: number, body: unknown): { raw: RawInput; errors: string[] } {
	const errors: string[] = [];
	const raw: RawInput = {};
	if (body == null || typeof body !== 'object' || Array.isArray(body)) return { raw, errors: ['El cuerpo debe ser un objeto JSON.'] };
	for (const [key, value] of Object.entries(body)) {
		if (FLAGS.includes(key)) continue;
		if (!FORM_FIELDS.includes(key)) errors.push(`Campo desconocido: «${key}».`);
		else if (value == null) continue;
		else if (typeof value === 'string' || typeof value === 'number') raw[key] = String(value);
		else errors.push(`El campo «${key}» debe ser texto o número.`);
	}
	const accounts = listAccounts(portfolioId, db);
	for (const key of ['account', 'toAccount']) {
		if (!raw[key]) continue;
		const found = accounts.find((a) => a.code.toUpperCase() === raw[key].toUpperCase());
		if (found) raw[key] = String(found.id);
		else errors.push(`No hay ninguna cuenta «${raw[key]}» en esta cartera. Cuentas: ${accounts.map((a) => a.code).join(', ')}.`);
	}
	const securities = listSecurities(db);
	const create = (body as Record<string, unknown>).createSecurity === true;
	for (const [key, tickerKey] of [['security', 'newTicker'], ['toSecurity', 'newToTicker']]) {
		if (!raw[key]) continue;
		const found = securities.find((s) => s.ticker === raw[key].toUpperCase());
		if (found) raw[key] = String(found.id);
		else if (create) {
			raw[tickerKey] = raw[key];
			raw[key] = 'nuevo';
		} else errors.push(`No existe el valor «${raw[key]}». Si es nuevo, repite la petición con "createSecurity": true.`);
	}
	return { raw, errors };
}

function describeBuilt(db: DatabaseSync, portfolioId: number, result: Extract<SubmitResult, { ok: true }>, built: BuiltOperation | undefined) {
	const accounts = listAccounts(portfolioId, db);
	const account = (id: number) => accounts.find((a) => a.id === id);
	return {
		description: result.description,
		cash: built?.cash.map((c) => ({ account: account(c.accountId)?.code, currency: account(c.accountId)?.currency, amount: units(c.amount) })),
		balancesAfter: result.balances?.map((b) => ({ account: account(b.accountId)?.code, currency: account(b.accountId)?.currency, balance: units(b.amount) })),
		grossEur: built && units(built.grossEur),
		taxEur: built && units(built.taxEur),
		feesEur: built && units(built.feesEur),
		purchaseEur: built && units(built.purchaseEur),
		capitalEur: built && units(built.capitalInEur - built.capitalOutEur)
	};
}

/** Alta (`id` nulo) o sustitución de una operación. */
export function apiSave(db: DatabaseSync, portfolioId: number, id: number | null, body: unknown): ApiResponse {
	const { raw, errors } = toRaw(db, portfolioId, body);
	if (errors.length) return problem(422, 'La operación no es válida.', { errors, warnings: [] });
	const flags = body as Record<string, unknown>;
	if (flags.keepEffects === true) raw.keepEffects = '1';
	const dryRun = flags.dryRun === true;
	const result = saveOperation(db, portfolioId, id, raw, { confirmed: flags.confirm === true, dryRun, source: 'api' });
	if (!result.ok) {
		return result.errors.length
			? problem(422, 'La operación no es válida.', { errors: result.errors, warnings: result.warnings })
			: problem(409, 'La operación necesita confirmación: repítela con "confirm": true si los avisos son aceptables.', { errors: [], warnings: result.warnings });
	}
	const summary = describeBuilt(db, portfolioId, result, result.operation);
	if (dryRun) return ok({ saved: false, dryRun: true, ...summary });
	return ok({ saved: true, id: result.id, ...summary }, id == null ? 201 : 200);
}

export function apiDelete(db: DatabaseSync, id: number, confirmed: boolean): ApiResponse {
	const record = getOperation(db, id);
	if (!record) return problem(404, 'Operación no encontrada.');
	const result = deleteOperation(db, record.portfolioId, id, confirmed);
	if (result.ok) return ok({ deleted: true, id, description: record.description });
	return result.errors.length
		? problem(422, 'No se puede borrar la operación.', { errors: result.errors, warnings: result.warnings })
		: problem(409, 'El borrado necesita confirmación: repítelo con ?confirm=1 si los avisos son aceptables.', { errors: [], warnings: result.warnings });
}

export function apiDividendChanges(db: DatabaseSync, ticker: string | null): ApiResponse {
	const wanted = ticker?.toUpperCase();
	return ok(listChanges(db).filter((c) => !wanted || c.ticker === wanted).map(({ securityId: _, ...c }) => c));
}

export function apiPatchDividendChange(db: DatabaseSync, id: number, body: unknown): ApiResponse {
	if (body == null || typeof body !== 'object' || Array.isArray(body)) return problem(422, 'El cuerpo debe ser un objeto JSON.', { errors: [] });
	const { currency, fxRate, ...rest } = body as Record<string, unknown>;
	const errors = Object.keys(rest).map((k) => `Campo desconocido: «${k}». Solo se corrigen «currency» y «fxRate».`);
	if (typeof currency !== 'string') errors.push('Falta «currency».');
	if (fxRate != null && typeof fxRate !== 'number') errors.push('«fxRate» debe ser un número.');
	if (errors.length) return problem(422, 'El cambio de dividendo no es válido.', { errors });
	const result = updateChangeCurrency(db, id, currency as string, fxRate as number | undefined);
	if (!result.ok) return problem(result.errors[0].includes('no existe') ? 404 : 422, 'El cambio de dividendo no es válido.', { errors: result.errors });
	const { securityId: _, ...change } = result.change;
	return ok({ saved: true, ...change });
}

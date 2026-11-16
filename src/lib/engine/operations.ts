/**
 * Generación de operaciones a partir de los campos de un formulario: una función pura por
 * tipo que produce la cabecera y sus efectos (`cash` y `positions`), según la tabla del §4.1
 * del diseño. El motor solo entiende los efectos.
 */
import { MICRO, type CashLeg, type Cents, type Micro, type PositionLeg } from './types.ts';

export type FieldName =
	| 'account'
	| 'toAccount'
	| 'security'
	| 'toSecurity'
	| 'quantity'
	| 'price'
	| 'currency'
	| 'amount'
	| 'amountTo'
	| 'whtSource'
	| 'whtDest'
	| 'fees'
	| 'cashTotal'
	| 'ratio'
	| 'sharesAfter'
	| 'costMoved';

export interface TypeDefinition {
	label: string;
	frequent?: boolean;
	/** Campos que pide el formulario, con su etiqueta. Los opcionales acaban en «(opcional)». */
	fields: Partial<Record<FieldName, string>>;
}

const OPTIONAL = ' (opcional)';

/** Tipos que se pueden dar de alta. Los códigos son los de la hoja antigua. */
export const OPERATION_TYPES = {
	DIVIDENDOS: {
		label: 'Dividendo',
		frequent: true,
		fields: {
			account: 'Cuenta',
			security: 'Valor',
			quantity: 'Acciones' + OPTIONAL,
			price: 'Dividendo por acción' + OPTIONAL,
			currency: 'Moneda',
			amount: 'Importe bruto',
			whtSource: 'Retención en origen',
			whtDest: 'Retención en destino',
			fees: 'Gastos',
			cashTotal: 'Neto abonado en cuenta' + OPTIONAL
		}
	},
	COMPRA: {
		label: 'Compra',
		frequent: true,
		fields: { account: 'Cuenta', security: 'Valor', quantity: 'Acciones', price: 'Precio', currency: 'Moneda', amount: 'Importe', fees: 'Gastos', cashTotal: 'Total cargado en cuenta' + OPTIONAL }
	},
	APORTACION: { label: 'Aportación', frequent: true, fields: { account: 'Cuenta', amount: 'Importe' } },
	INTERESES: {
		label: 'Intereses',
		frequent: true,
		fields: { account: 'Cuenta', amount: 'Importe bruto', whtDest: 'Retención', fees: 'Gastos' }
	},
	GASTOS: { label: 'Gasto o comisión', frequent: true, fields: { account: 'Cuenta', amount: 'Importe' } },
	TRASPASO: { label: 'Traspaso de efectivo', frequent: true, fields: { account: 'Cuenta de origen', toAccount: 'Cuenta de destino', amount: 'Importe', fees: 'Gastos' } },
	CAMBIO: {
		label: 'Cambio de divisa',
		frequent: true,
		fields: { account: 'Cuenta de origen', toAccount: 'Cuenta de destino', amount: 'Importe que sale', amountTo: 'Importe que entra', fees: 'Gastos incluidos, en euros' }
	},
	VENTA: {
		label: 'Venta',
		fields: { account: 'Cuenta', security: 'Valor', quantity: 'Acciones', price: 'Precio', currency: 'Moneda', amount: 'Importe', fees: 'Gastos', cashTotal: 'Neto abonado en cuenta' + OPTIONAL }
	},
	RETIRADA: { label: 'Retirada', fields: { account: 'Cuenta', amount: 'Importe' } },
	DEVOLUCIONPRIMA: {
		label: 'Devolución de prima',
		fields: { account: 'Cuenta', security: 'Valor', quantity: 'Acciones' + OPTIONAL, price: 'Importe por acción' + OPTIONAL, currency: 'Moneda', amount: 'Importe', fees: 'Gastos' }
	},
	COMPRADERECHOS: {
		label: 'Compra de derechos',
		fields: { account: 'Cuenta', security: 'Valor', quantity: 'Derechos', price: 'Precio', currency: 'Moneda', amount: 'Importe', fees: 'Gastos', cashTotal: 'Total cargado en cuenta' + OPTIONAL }
	},
	VENTADERECHOS: {
		label: 'Venta de derechos',
		fields: {
			account: 'Cuenta',
			security: 'Valor',
			quantity: 'Derechos',
			price: 'Precio',
			currency: 'Moneda',
			amount: 'Importe bruto',
			whtDest: 'Retención',
			fees: 'Gastos',
			cashTotal: 'Neto abonado en cuenta' + OPTIONAL
		}
	},
	CONVERSIONDERECHOS: { label: 'Conversión de derechos en acciones', fields: { account: 'Cuenta' + OPTIONAL, security: 'Valor', quantity: 'Acciones nuevas', price: 'Derechos usados' + OPTIONAL, fees: 'Gastos' } },
	AMPLIACIONLIBERADA: { label: 'Ampliación liberada', fields: { account: 'Cuenta' + OPTIONAL, security: 'Valor', quantity: 'Acciones nuevas', fees: 'Gastos' } },
	SPLIT: { label: 'Split o contrasplit', fields: { security: 'Valor', ratio: 'Proporción', sharesAfter: 'Acciones tras el split' + OPTIONAL } },
	SPINOFF: {
		label: 'Spin-off',
		fields: {
			account: 'Cuenta' + OPTIONAL,
			security: 'Valor de origen',
			toSecurity: 'Valor nuevo',
			quantity: 'Acciones recibidas',
			costMoved: 'Coste que pasa al valor nuevo, en euros',
			currency: 'Moneda',
			amount: 'Picos cobrados en efectivo' + OPTIONAL
		}
	},
	CONVERSION: { label: 'Conversión de ticker', fields: { security: 'Valor de origen', toSecurity: 'Valor nuevo', sharesAfter: 'Acciones del valor nuevo' + OPTIONAL } },
	TRASPASOVALORES: { label: 'Traspaso de valores', fields: { account: 'Cuenta que paga los gastos' + OPTIONAL, security: 'Valor', quantity: 'Acciones' + OPTIONAL, fees: 'Gastos' } },
	VENTAOPCION: {
		label: 'Venta de opción',
		fields: { account: 'Cuenta', security: 'Subyacente' + OPTIONAL, quantity: 'Contratos' + OPTIONAL, price: 'Prima por contrato' + OPTIONAL, currency: 'Moneda', amount: 'Prima', fees: 'Gastos', cashTotal: 'Neto abonado en cuenta' + OPTIONAL }
	},
	COMPRAOPCION: {
		label: 'Compra de opción',
		fields: { account: 'Cuenta', security: 'Subyacente' + OPTIONAL, quantity: 'Contratos' + OPTIONAL, price: 'Prima por contrato' + OPTIONAL, currency: 'Moneda', amount: 'Prima', fees: 'Gastos', cashTotal: 'Total cargado en cuenta' + OPTIONAL }
	},
	INGRESOPROMOCION: { label: 'Ingreso por promoción', fields: { account: 'Cuenta', amount: 'Importe bruto', whtDest: 'Retención' } },
	PERDIDASFONDOS: { label: 'Pérdidas de fondo monetario', fields: { account: 'Cuenta', amount: 'Importe' } },
	COMPENSACIONFONDOS: { label: 'Compensación de fondo monetario', fields: { account: 'Cuenta', amount: 'Importe' } }
} satisfies Record<string, TypeDefinition>;

export type OperationType = keyof typeof OPERATION_TYPES;

export function isOperationType(type: string): type is OperationType {
	return Object.hasOwn(OPERATION_TYPES, type);
}
export function typeDefinition(type: OperationType): TypeDefinition {
	return OPERATION_TYPES[type];
}
export function isRequired(type: OperationType, field: FieldName): boolean {
	const label = typeDefinition(type).fields[field];
	return label != null && !label.endsWith(OPTIONAL);
}

/** Campos del formulario ya interpretados. Lo que un tipo no usa se ignora. */
export interface OperationInput {
	type: OperationType;
	/** AAAA-MM-DD */
	date: string;
	accountId: number | null;
	toAccountId: number | null;
	securityId: number | null;
	toSecurityId: number | null;
	/** Acciones, derechos o contratos. */
	quantity: Micro;
	/** Precio unitario, informativo: el importe es el que manda. */
	price: number;
	/** Moneda de la operación (la del valor); vacía = la de la cuenta. */
	currency: string;
	/** Unidades de la moneda de la operación por euro. */
	fxRate: number;
	/** Importe bruto en la moneda de la operación; 0 = cantidad × precio. */
	amount: Cents;
	/** Cambio de divisa: importe que entra, en la moneda de la cuenta de destino. */
	amountTo: Cents;
	whtSource: Cents;
	whtDest: Cents;
	/** Gastos en la moneda de la cuenta. */
	fees: Cents;
	/** Total abonado o cargado en la cuenta; si se indica, los gastos son la diferencia. */
	cashTotal: Cents | null;
	/** Split: `ratioNew` acciones nuevas por cada `ratioOld` antiguas. */
	ratioNew: number;
	ratioOld: number;
	sharesAfter: Micro | null;
	/** Spin-off: coste en euros que pasa del valor de origen al nuevo. */
	costMoved: Cents;
	/** Vacía = se genera. */
	description: string;
}

export function emptyInput(type: OperationType, date: string): OperationInput {
	return {
		type,
		date,
		accountId: null,
		toAccountId: null,
		securityId: null,
		toSecurityId: null,
		quantity: 0,
		price: 0,
		currency: '',
		fxRate: 1,
		amount: 0,
		amountTo: 0,
		whtSource: 0,
		whtDest: 0,
		fees: 0,
		cashTotal: null,
		ratioNew: 0,
		ratioOld: 0,
		sharesAfter: null,
		costMoved: 0,
		description: ''
	};
}

/** Datos maestros y posición que necesita el generador. */
export interface BuildContext {
	accounts: Map<number, { code: string; currency: string }>;
	securities: Map<number, { ticker: string }>;
	/** Acciones del valor justo antes de la operación (para los splits). */
	sharesHeld: (securityId: number) => Micro;
}

/** Operación lista para guardar: cabecera con los datos informativos y efectos. */
export interface BuiltOperation {
	type: OperationType;
	date: string;
	accountId: number | null;
	securityId: number | null;
	quantity: number | null;
	price: number | null;
	currency: string | null;
	fxRate: number | null;
	amountLocal: Cents | null;
	taxLocal: Cents | null;
	whtSourceLocal: Cents | null;
	whtDestLocal: Cents | null;
	feesLocal: Cents | null;
	grossEur: Cents;
	taxEur: Cents;
	feesEur: Cents;
	capitalInEur: Cents;
	capitalOutEur: Cents;
	purchaseEur: Cents;
	description: string;
	cash: CashLeg[];
	positions: PositionLeg[];
}

export type BuildResult = { ok: true; operation: BuiltOperation } | { ok: false; errors: string[] };

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6, useGrouping: false });
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
const fmt = (n: number) => plain.format(n);
const fmtMoney = (cents: Cents) => money.format(cents / 100);

class Invalid extends Error {}
function need(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Invalid(message);
}

/** Genera la operación de un formulario, o la lista de errores que impiden guardarla. */
export function buildOperation(input: OperationInput, ctx: BuildContext): BuildResult {
	try {
		return { ok: true, operation: build(input, ctx) };
	} catch (e) {
		if (e instanceof Invalid) return { ok: false, errors: [e.message] };
		throw e;
	}
}

function build(input: OperationInput, ctx: BuildContext): BuiltOperation {
	const { type } = input;
	const def = typeDefinition(type);
	need(/^\d{4}-\d{2}-\d{2}$/.test(input.date) && !Number.isNaN(Date.parse(input.date)), 'La fecha no es válida.');
	for (const [field, label] of Object.entries(def.fields) as [FieldName, string][]) {
		if (label.endsWith(OPTIONAL)) continue;
		const present =
			field === 'account' ? input.accountId != null
			: field === 'toAccount' ? input.toAccountId != null
			: field === 'security' ? input.securityId != null
			: field === 'toSecurity' ? input.toSecurityId != null
			: field === 'quantity' ? input.quantity > 0
			: field === 'amount' ? input.amount > 0 || (input.quantity > 0 && input.price > 0)
			: field === 'amountTo' ? input.amountTo > 0
			: field === 'ratio' ? input.ratioNew > 0 && input.ratioOld > 0
			: field === 'costMoved' ? input.costMoved >= 0
			: true;
		need(present, `Falta «${label}».`);
	}
	for (const [name, value] of Object.entries({ quantity: input.quantity, price: input.price, amount: input.amount, amountTo: input.amountTo, whtSource: input.whtSource, whtDest: input.whtDest, costMoved: input.costMoved }))
		need(Number.isFinite(value) && value >= 0, `El campo «${def.fields[name as FieldName] ?? name}» no puede ser negativo.`);
	need(Number.isFinite(input.fees), 'Los gastos no son válidos.');

	const account = input.accountId == null ? null : ctx.accounts.get(input.accountId);
	need(input.accountId == null || account, 'La cuenta no existe.');
	const toAccount = input.toAccountId == null ? null : ctx.accounts.get(input.toAccountId);
	need(input.toAccountId == null || toAccount, 'La cuenta de destino no existe.');
	const ticker = input.securityId == null ? '' : (ctx.securities.get(input.securityId)?.ticker ?? '');
	need(input.securityId == null || ticker, 'El valor no existe.');
	const toTicker = input.toSecurityId == null ? '' : (ctx.securities.get(input.toSecurityId)?.ticker ?? '');
	need(input.toSecurityId == null || toTicker, 'El valor nuevo no existe.');

	// Monedas: la operación va en la moneda de la cuenta o, si la cuenta es en euros, en otra con su cambio.
	const accountCurrency = account?.currency ?? 'EUR';
	const currency = ('currency' in def.fields && input.currency) || accountCurrency;
	need(currency === accountCurrency || accountCurrency === 'EUR', `Una cuenta en ${accountCurrency} solo admite operaciones en ${accountCurrency}.`);
	const fx = currency === 'EUR' ? 1 : input.fxRate;
	need(Number.isFinite(fx) && fx > 0, `Falta el tipo de cambio (${currency} por euro).`);
	/** De la moneda de la operación a euros. */
	const toEur = (x: Cents) => (currency === 'EUR' ? x : Math.round(x / fx));
	/** De la moneda de la operación a la de la cuenta. */
	const toAcc = (x: Cents) => (currency === accountCurrency ? x : toEur(x));
	/** De la moneda de la cuenta a euros. */
	const accToEur = (x: Cents) => (accountCurrency === 'EUR' ? x : Math.round(x / fx));

	const amount = input.amount || Math.round((input.quantity / MICRO) * input.price * 100);
	const tax = ('whtSource' in def.fields ? input.whtSource : 0) + ('whtDest' in def.fields ? input.whtDest : 0);
	const qty = input.quantity / MICRO;

	const op: BuiltOperation = {
		type,
		date: input.date,
		accountId: input.accountId,
		securityId: 'security' in def.fields ? input.securityId : null,
		quantity: 'quantity' in def.fields && input.quantity ? qty : null,
		price: 'price' in def.fields && input.price ? input.price : null,
		currency: account || 'currency' in def.fields ? currency : null,
		fxRate: account || 'currency' in def.fields ? fx : null,
		amountLocal: 'amount' in def.fields ? amount : null,
		taxLocal: 'whtSource' in def.fields || 'whtDest' in def.fields ? tax : null,
		whtSourceLocal: 'whtSource' in def.fields ? input.whtSource : null,
		whtDestLocal: 'whtDest' in def.fields ? input.whtDest : null,
		feesLocal: null,
		grossEur: 0,
		taxEur: 0,
		feesEur: 0,
		capitalInEur: 0,
		capitalOutEur: 0,
		purchaseEur: 0,
		description: '',
		cash: [],
		positions: []
	};
	const cash = (accountId: number | null, value: Cents) => {
		if (accountId != null && value !== 0) op.cash.push({ accountId, amount: value });
	};
	/** Gastos en la moneda de la cuenta: los tecleados o, si se dio el total de la cuenta, la diferencia. */
	const fees = (direction: 'in' | 'out' | 'none'): Cents => {
		let value = 'fees' in def.fields ? input.fees : 0;
		if (direction !== 'none' && 'cashTotal' in def.fields && input.cashTotal != null) {
			const before = toAcc(amount) - toAcc(tax);
			value = direction === 'in' ? before - input.cashTotal : input.cashTotal - before;
			need(value >= 0, `El total en cuenta no cuadra con el importe: saldrían unos gastos de ${fmtMoney(value)}. Revisa el importe o el tipo de cambio.`);
		}
		need(value >= 0, 'Los gastos no pueden ser negativos.');
		need(value === 0 || account, 'Para anotar gastos hay que indicar la cuenta.');
		op.feesLocal = 'fees' in def.fields ? value : null;
		op.feesEur = accToEur(value);
		return value;
	};

	switch (type) {
		case 'DIVIDENDOS':
		case 'INTERESES':
		case 'INGRESOPROMOCION':
		case 'DEVOLUCIONPRIMA':
		case 'VENTADERECHOS': {
			const f = fees('in');
			need(tax <= amount, 'Las retenciones superan el importe bruto.');
			op.grossEur = toEur(amount);
			op.taxEur = toEur(tax);
			cash(input.accountId, toAcc(amount) - toAcc(tax) - f);
			// La devolución de prima y la venta de derechos rebajan el coste reducido, no el original.
			// Una venta de derechos con retención se trata como un dividendo y no rebaja coste.
			if (type === 'DEVOLUCIONPRIMA' || (type === 'VENTADERECHOS' && tax === 0)) op.positions.push({ securityId: input.securityId!, kind: 'adjust', shares: 0, cost: 0, reducedCost: -op.grossEur });
			const detail = input.quantity && input.price ? ` (${fmt(qty)}*${fmt(input.price)} ${currency})` : '';
			op.description =
				type === 'DIVIDENDOS' ? `Dividendos ${ticker}${detail}`
				: type === 'DEVOLUCIONPRIMA' ? `Devolución de prima ${ticker}${detail}`
				: type === 'VENTADERECHOS' ? `Venta derechos ${ticker}${detail}`
				: type === 'INTERESES' ? `Intereses ${account!.code}`
				: `Promoción ${account!.code}`;
			break;
		}
		case 'COMPRA':
		case 'COMPRADERECHOS': {
			const f = fees('out');
			op.purchaseEur = toEur(amount);
			cash(input.accountId, -(toAcc(amount) + f));
			// Como en la hoja, los gastos de la compra forman parte del coste del lote.
			const cost = op.purchaseEur + op.feesEur;
			if (type === 'COMPRA') {
				op.positions.push({ securityId: input.securityId!, kind: 'buy', shares: input.quantity, cost, reducedCost: cost });
				op.description = `Compra ${fmt(qty)} x ${ticker} @ ${fmt(input.price || amount / 100 / qty)} ${currency}`;
			} else {
				op.positions.push({ securityId: input.securityId!, kind: 'adjust', shares: 0, cost, reducedCost: cost });
				op.description = `Compra derechos ${ticker}: ${fmt(qty)} derechos a ${fmt(input.price || amount / 100 / qty)} ${currency}`;
			}
			break;
		}
		case 'VENTA': {
			const f = fees('in');
			op.purchaseEur = -toEur(amount);
			cash(input.accountId, toAcc(amount) - f);
			op.positions.push({ securityId: input.securityId!, kind: 'sell', shares: input.quantity, cost: 0, reducedCost: 0, proceeds: toEur(amount) });
			op.description = `Venta ${fmt(qty)} x ${ticker} @ ${fmt(input.price || amount / 100 / qty)} ${currency}`;
			break;
		}
		case 'VENTAOPCION':
		case 'COMPRAOPCION': {
			// La prima es renta del año al cobrarla o pagarla (negativa si se paga). Sirve para put y call, y para
			// cerrar antes del vencimiento con la operación contraria; un ejercicio se anota como compra o venta normal.
			const sold = type === 'VENTAOPCION';
			const f = fees(sold ? 'in' : 'out');
			op.grossEur = sold ? toEur(amount) : -toEur(amount);
			cash(input.accountId, sold ? toAcc(amount) - f : -(toAcc(amount) + f));
			op.description = `${sold ? 'Venta' : 'Compra'} ${input.quantity ? fmt(qty) + ' x ' : ''}opción${ticker ? ' ' + ticker : ''}${input.price ? ` @ ${fmt(input.price)} ${currency}` : ''}`;
			break;
		}
		case 'APORTACION':
		case 'RETIRADA': {
			const eur = accToEur(amount);
			if (type === 'APORTACION') op.capitalInEur = eur;
			else op.capitalOutEur = eur;
			cash(input.accountId, type === 'APORTACION' ? amount : -amount);
			op.description = `${type === 'APORTACION' ? 'Aportación' : 'Retirada'} de capital ${account!.code}`;
			break;
		}
		case 'GASTOS': {
			op.feesLocal = amount;
			op.feesEur = accToEur(amount);
			cash(input.accountId, -amount);
			op.description = `Gastos ${account!.code}`;
			break;
		}
		case 'PERDIDASFONDOS':
		case 'COMPENSACIONFONDOS': {
			const sign = type === 'PERDIDASFONDOS' ? -1 : 1;
			op.grossEur = sign * accToEur(amount);
			cash(input.accountId, sign * amount);
			op.description = `${type === 'PERDIDASFONDOS' ? 'Pérdidas' : 'Compensación de pérdidas'} del fondo monetario ${account!.code}`;
			break;
		}
		case 'TRASPASO': {
			need(input.accountId !== input.toAccountId, 'Las cuentas de origen y destino son la misma.');
			need(account!.currency === toAccount!.currency, 'Las dos cuentas deben tener la misma moneda; para pasar de una moneda a otra usa «Cambio de divisa».');
			const f = fees('none');
			cash(input.accountId, -(amount + f));
			cash(input.toAccountId, amount);
			op.description = `Traspaso ${fmtMoney(amount)} ${accountCurrency} de ${account!.code} a ${toAccount!.code}`;
			break;
		}
		case 'CAMBIO': {
			need(input.accountId !== input.toAccountId, 'Las cuentas de origen y destino son la misma.');
			need(account!.currency !== toAccount!.currency, 'Las dos cuentas tienen la misma moneda; usa «Traspaso de efectivo».');
			need(account!.currency === 'EUR' || toAccount!.currency === 'EUR', 'Una de las dos cuentas debe ser en euros.');
			need(input.fees >= 0, 'Los gastos no pueden ser negativos.');
			// Los importes son los que salen y entran de verdad en cada cuenta; los gastos ya van incluidos en ellos.
			cash(input.accountId, -amount);
			cash(input.toAccountId, input.amountTo);
			const [eur, foreign, foreignCurrency] = account!.currency === 'EUR' ? [amount, input.amountTo, toAccount!.currency] : [input.amountTo, amount, account!.currency];
			op.currency = foreignCurrency;
			op.fxRate = Math.round((foreign / eur) * 1e6) / 1e6;
			op.feesLocal = input.fees;
			op.feesEur = input.fees;
			op.description = `Cambio ${fmtMoney(amount)} ${account!.currency} -> ${fmtMoney(input.amountTo)} ${toAccount!.currency}`;
			break;
		}
		case 'CONVERSIONDERECHOS':
		case 'AMPLIACIONLIBERADA': {
			const f = fees('none');
			cash(input.accountId, -f);
			op.positions.push({ securityId: input.securityId!, kind: 'adjust', shares: input.quantity, cost: 0, reducedCost: 0 });
			op.description =
				type === 'CONVERSIONDERECHOS'
					? `Suscripción acciones ${ticker}: ${input.price ? fmt(input.price) + ' derechos generan ' : ''}${fmt(qty)} acciones`
					: `Ampliación liberada ${ticker}: ${fmt(qty)} acciones`;
			break;
		}
		case 'SPLIT': {
			const before = ctx.sharesHeld(input.securityId!);
			need(before > 0, `No hay acciones de ${ticker} en esa fecha.`);
			const after = input.sharesAfter ?? Math.round((before * input.ratioNew) / input.ratioOld);
			need(after > 0, 'El split dejaría la posición sin acciones.');
			op.quantity = Math.round((input.ratioNew / input.ratioOld) * 1e10) / 1e10;
			op.positions.push({ securityId: input.securityId!, kind: 'adjust', shares: after - before, cost: 0, reducedCost: 0 });
			op.description = `Split ${ticker} ${fmt(input.ratioNew)}x${fmt(input.ratioOld)} (${fmt(before / MICRO)} -> ${fmt(after / MICRO)})`;
			break;
		}
		case 'SPINOFF': {
			need(input.securityId !== input.toSecurityId, 'El valor nuevo es el mismo que el de origen.');
			op.grossEur = toEur(input.amount);
			op.amountLocal = input.amount;
			cash(input.accountId, toAcc(input.amount));
			need(input.amount === 0 || account, 'Para anotar los picos hay que indicar la cuenta.');
			if (input.costMoved) op.positions.push({ securityId: input.securityId!, kind: 'adjust', shares: 0, cost: -input.costMoved, reducedCost: -input.costMoved });
			op.positions.push({ securityId: input.toSecurityId!, kind: 'buy', shares: input.quantity, cost: input.costMoved, reducedCost: input.costMoved });
			op.description = `Spin-off ${toTicker}: ${fmt(qty)} acciones por las de ${ticker}`;
			break;
		}
		case 'CONVERSION': {
			need(input.securityId !== input.toSecurityId, 'El valor nuevo es el mismo que el de origen.');
			need(ctx.sharesHeld(input.securityId!) > 0, `No hay acciones de ${ticker} en esa fecha.`);
			op.positions.push({ securityId: input.securityId!, kind: 'convert', shares: input.sharesAfter ?? 0, cost: 0, reducedCost: 0, toSecurityId: input.toSecurityId! });
			op.description = `Conversión de ${ticker} a ${toTicker}`;
			break;
		}
		case 'TRASPASOVALORES': {
			const f = fees('none');
			cash(input.accountId, -f);
			op.description = `Traspaso de valores ${input.quantity ? fmt(qty) + ' x ' : ''}${ticker}`;
			break;
		}
		default: {
			const unknown: never = type;
			throw new Invalid(`Tipo de operación desconocido: ${unknown}`);
		}
	}
	if (input.description.trim()) op.description = input.description.trim();
	return op;
}

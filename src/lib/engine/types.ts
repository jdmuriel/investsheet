/** Importe en céntimos enteros de su moneda. */
export type Cents = number;
/** Nº de acciones en millonésimas (1 acción = 1_000_000), para admitir fracciones sin coma flotante. */
export type Micro = number;

export const MICRO = 1_000_000;

/** Movimiento de efectivo de una operación en una cuenta, en la moneda de la cuenta. */
export interface CashLeg {
	accountId: number;
	amount: Cents;
}

/**
 * Efecto de una operación sobre la posición de un valor.
 *
 * - `buy`: crea un lote nuevo con `shares`, `cost` y `reducedCost`.
 * - `sell`: da de baja `shares` (positivo) por FIFO; `proceeds` es el importe obtenido.
 * - `adjust`: reparte `shares`, `cost` y `reducedCost` (con signo) entre los lotes vivos en
 *   proporción a sus acciones. Sirve para acciones liberadas, splits, compra y venta de
 *   derechos y devoluciones de prima.
 * - `convert`: traslada todos los lotes a `toSecurityId`; si `shares` > 0 es el nuevo total.
 */
export type PositionKind = 'buy' | 'sell' | 'adjust' | 'convert';

export interface PositionLeg {
	securityId: number;
	kind: PositionKind;
	shares: Micro;
	cost: Cents;
	reducedCost: Cents;
	proceeds?: Cents;
	toSecurityId?: number;
}

export interface Operation {
	id: number;
	/** AAAA-MM-DD */
	date: string;
	/** Orden dentro del día. */
	seq: number;
	type: string;
	/** Valor al que se atribuyen las rentas de la operación (dividendos), si lo hay. */
	securityId?: number | null;
	grossEur: Cents;
	taxEur: Cents;
	feesEur: Cents;
	capitalInEur: Cents;
	capitalOutEur: Cents;
	/** Importe de compra sin comisiones (negativo en ventas), para la métrica «compras». */
	purchaseEur: Cents;
	cash: CashLeg[];
	positions: PositionLeg[];
}

export interface Lot {
	/** Fecha de la compra original. */
	date: string;
	shares: Micro;
	cost: Cents;
	reducedCost: Cents;
}

export interface Position {
	lots: Lot[];
	dividendsGross: Cents;
	dividendsSinceLastBuy: Cents;
	realizedGain: Cents;
}

export interface YearMetrics {
	year: number;
	capital: Cents;
	gross: Cents;
	tax: Cents;
	fees: Cents;
	purchases: Cents;
	realizedGain: Cents;
}

/** Estado acumulado tras una operación. El motor lo muta: quien lo guarde debe copiar lo que necesite. */
export interface State {
	cash: Map<number, Cents>;
	capital: Cents;
	/** Rentas menos impuestos y gastos acumulados en el año de la última operación. */
	yearResult: Cents;
	year: number | null;
	positions: Map<number, Position>;
	years: Map<number, YearMetrics>;
}

export interface Warning {
	operationId: number;
	message: string;
}

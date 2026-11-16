/** Lectura de las fuentes de precios y tipos de cambio (RF-43 a RF-46): solo interpretación de texto, sin red. */
import { parseDecimal } from './form.ts';

/** Filas de un CSV, con comillas dobles y saltos de línea dentro de un campo. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	const src = text.replace(/^﻿/, '');
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"' && src[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && src[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += ch;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export interface SheetPrice {
	/** Ticker tal como figura en la hoja de precios, en mayúsculas (p. ej. `BME:ACME`). */
	ticker: string;
	/** Precio en unidades de `currency`: los que llegan en peniques (`GBX`) se pasan a libras. */
	price: number;
	currency: string | null;
	/** Fecha del precio (AAAA-MM-DD), si la hoja la trae. */
	date: string | null;
}

function sheetDate(text: string): string | null {
	const t = text.trim();
	let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
	return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/**
 * Pestaña `actual` de la hoja de precios: ticker, precio, moneda y fecha, con o sin fila de títulos.
 * Las filas sin precio válido (errores de la fuente, celdas vacías) se saltan.
 */
export function parsePriceCsv(text: string): SheetPrice[] {
	const out: SheetPrice[] = [];
	for (const [ticker = '', priceText = '', currencyText = '', dateText = ''] of parseCsv(text)) {
		const price = parseDecimal(priceText);
		if (!ticker.trim() || price == null || !Number.isFinite(price) || price <= 0) continue;
		const currency = currencyText.trim().toUpperCase() || null;
		const pence = currency === 'GBX' || currency === 'GBP.P' || currencyText.trim() === 'GBp';
		out.push({ ticker: ticker.trim().toUpperCase(), price: pence ? price / 100 : price, currency: pence ? 'GBP' : currency, date: sheetDate(dateText) });
	}
	return out;
}

export interface FxRate {
	currency: string;
	date: string;
	/** Unidades de la moneda por euro. */
	rate: number;
}

/** Ficheros de referencia del BCE (diario, 90 días o histórico): un bloque por fecha con una línea por moneda. */
export function parseEcbXml(xml: string, currencies?: Set<string>): FxRate[] {
	const out: FxRate[] = [];
	const day = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g;
	for (let d = day.exec(xml); d; d = day.exec(xml)) {
		const line = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;
		for (let r = line.exec(d[2]); r; r = line.exec(d[2])) {
			const rate = Number(r[2]);
			if ((!currencies || currencies.has(r[1])) && rate > 0) out.push({ currency: r[1], date: d[1], rate });
		}
	}
	return out;
}

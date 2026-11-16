/** Lectura de la hoja de cálculo antigua: valores de las celdas, sin fórmulas ni formato. */
import ExcelJS from 'exceljs';
import type { SheetCell, SheetRows } from '../engine/log-export.ts';

/** Valor de una celda tal como lo entrega ExcelJS (resultado de fórmula, texto con formato…) a valor simple. */
export function plain(v: unknown): SheetCell {
	if (v == null) return null;
	if (v instanceof Date) return v;
	if (typeof v === 'object') {
		const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
		if ('result' in o) return plain(o.result);
		if (o.richText) return o.richText.map((t) => t.text).join('');
		if (o.error) return null;
		if (typeof o.text === 'string') return o.text;
		return null;
	}
	if (typeof v === 'string' || typeof v === 'number') return v;
	return null;
}

/** Lee las solapas que acepta `wanted`, leyendo el libro en flujo para no cargarlo entero en memoria. De cada una se guardan como mucho `maxRows` filas. */
export async function readSheets(path: string, wanted: (name: string) => boolean, maxRows: (name: string) => number = () => Infinity): Promise<Map<string, SheetRows>> {
	const out = new Map<string, SheetRows>();
	const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, { sharedStrings: 'cache', styles: 'cache', worksheets: 'emit', hyperlinks: 'ignore' } as never);
	for await (const ws of reader as AsyncIterable<{ name: string } & AsyncIterable<{ number: number; values: unknown[] }>>) {
		if (!wanted(ws.name)) {
			for await (const _ of ws) void _;
			continue;
		}
		const sheet: SheetRows = [];
		const limit = maxRows(ws.name);
		for await (const row of ws) if (row.number <= limit) sheet[row.number] = (row.values as unknown[]).map(plain);
		out.set(ws.name, sheet);
	}
	return out;
}

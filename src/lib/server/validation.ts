/**
 * Exportación de validación (RF-49): libro de cálculo con el registro de cada cartera en la disposición
 * de la solapa `Log` de la hoja antigua y, si se da una copia de la hoja como referencia, una solapa de diferencias.
 */
import ExcelJS from 'exceljs';
import type { DatabaseSync } from 'node:sqlite';
import { Writable } from 'node:stream';
import config from '../../../scripts/legacy-config.json' with { type: 'json' };
import {
	FIRST_ROW, HEADER_ROW, buildLog, colIndex, defaultBlocks, defaultYears, diffLog, fixedColumns, yearsFromReference,
	type LogComparison, type LogLayout, type LogModel, type SheetRows
} from '../engine/log-export.ts';
import { readSheets } from './legacy-sheet.ts';
import { listAccounts, listPortfolios, listSecurities, loadOperations } from './store.ts';

/** Valores de los bloques del registro principal, en el orden de sus columnas en la hoja. */
export const MAIN_LOG_TICKERS = [
	'SAN', 'TEF', 'ABE', 'ENG', 'BME', 'NTGY', 'TRE', 'RED', 'EBRO', 'ACS', 'ELE', 'IBE', 'SAB', 'AMS', 'VIS', 'LOG', 'ITX', 'MRL', 'MAP', 'T', 'WBD', 'PEAK', 'BPL', 'VZ', 'KHC', 'GIS', 'TXN', 'MO', 'PM',
	'AAPL', 'MSFT', 'INTC', 'JNJ', 'DIS', 'MMM', 'ABBV', 'SPG', 'O', 'XOM', 'SBUX', 'CSCO', 'KO', 'PEP', 'HSY', 'CVS', 'PFE', 'TROW', 'LMT', 'BIPC', 'BEPC', 'BIP', 'BEP', 'BPY',
	'AMS:SHELL', 'AMS:RDSB', 'AMS:NN', 'AMS:UNA', 'LON:BATS', 'LON:RDSA', 'LON:RIO', 'LON:AV'
];

const aliases: Record<string, string> = config.tickerAliases;
/** Ticker de la aplicación para una etiqueta de la hoja («LON:BATS» → «BATS»). */
const baseTicker = (label: string) => {
	const t = label.toUpperCase().split(':').pop()!.trim();
	return aliases[t] ?? t;
};
const text = (v: unknown) => (v == null ? '' : String(v).trim());

export interface ValidationOptions {
	/** Solapas `Log…` de la hoja antigua, para ordenar igual las columnas y comparar. */
	reference?: Map<string, SheetRows>;
	/** Solo se informan diferencias desde esta fecha. */
	from?: string;
	/** Fecha de hoy (AAAA-MM-DD), para la columna «Año en curso». */
	today: string;
}

export interface ValidationResult {
	models: LogModel[];
	comparisons: LogComparison[];
	notes: string[];
}

/** Nombre de la solapa de la hoja de la que salió la cartera: el que guardó la importación o, si no, `Log` + nombre. */
function sheetName(db: DatabaseSync, portfolio: { id: number; name: string }, index: number): string {
	const row = db.prepare("SELECT legacy_ref FROM operation WHERE portfolio_id = ? AND legacy_ref LIKE '%!%' ORDER BY id LIMIT 1").get(portfolio.id) as { legacy_ref: string } | undefined;
	if (row) return row.legacy_ref.slice(0, row.legacy_ref.indexOf('!'));
	return index === 0 ? 'Log' : `Log${portfolio.name}`.slice(0, 31);
}

function layoutFor(db: DatabaseSync, portfolio: { id: number; name: string }, index: number, operations: { date: string }[], options: ValidationOptions, notes: string[]): LogLayout {
	const sheet = sheetName(db, portfolio, index);
	const main = sheet === 'Log';
	const reference = options.reference?.get(sheet);
	const f = fixedColumns(main);
	const securities = new Map(listSecurities(db).map((s) => [s.ticker, s.id]));

	let labels = main ? MAIN_LOG_TICKERS : [];
	let blocks = defaultBlocks(labels.length);
	if (main && reference) {
		// Con la hoja delante mandan sus columnas: los bloques empiezan donde se repite el primer valor.
		const header = reference[HEADER_ROW] ?? [];
		const start = colIndex('AE');
		const end = header.findIndex((v, c) => c >= start && /^total/i.test(text(v)));
		const found = end > start ? header.slice(start, end).map(text) : [];
		const repeats = header.map((v, c) => (c > end && found.length && text(v) === found[0] ? c : -1)).filter((c) => c > 0);
		if (found.length && repeats.length >= 3) {
			labels = found;
			blocks = { costStart: start, reducedStart: repeats[0], sharesStart: repeats[2] };
		} else notes.push(`No se han reconocido los bloques por valor de la solapa «${sheet}»: se usa la disposición conocida.`);
	}
	const tickers = labels.map((label) => ({ label, securityId: securities.get(baseTicker(label)) ?? null }));

	const accounts = listAccounts(portfolio.id, db);
	const codeRow = reference?.[7] ?? [];
	const used = new Set<number>();
	const placed = accounts.map((a, i) => {
		let col = f.cash + i;
		if (reference) {
			col = codeRow.findIndex((v, c) => c >= f.cash && c < f.cash + 6 && text(v).toUpperCase() === a.code.toUpperCase());
			if (col < 0) notes.push(`La cuenta ${a.code} no tiene columna de saldo en la solapa «${sheet}»: no se exporta ni se compara.`);
		}
		if (col > 0) used.add(col);
		return { col, id: a.id, name: a.name, code: a.code, currency: a.currency };
	});

	const firstYear = Number((operations[0]?.date ?? options.today).slice(0, 4));
	const years = reference ? yearsFromReference(reference, main) : defaultYears(main, Number(options.today.slice(0, 4)), firstYear);
	return { sheet, main, accounts: placed.filter((a) => a.col > 0), tickers, ...blocks, years: years.length ? years : defaultYears(main, Number(options.today.slice(0, 4)), firstYear) };
}

/** Calcula el registro de cada cartera con la disposición de la hoja y, si hay referencia, sus diferencias. */
export function buildValidation(db: DatabaseSync, options: ValidationOptions): ValidationResult {
	const notes: string[] = [];
	const models: LogModel[] = [];
	const comparisons: LogComparison[] = [];
	const tickerOf = new Map(listSecurities(db).map((s) => [s.id, s.ticker]));
	listPortfolios(db).forEach((portfolio, index) => {
		const operations = loadOperations(portfolio.id, db);
		const layout = layoutFor(db, portfolio, index, operations, options, notes);
		const model = buildLog(operations, layout);
		models.push(model);

		if (layout.main) {
			// Valores con movimientos en posiciones que no tienen columna: no aparecen en los bloques.
			const listed = new Set(layout.tickers.map((t) => t.securityId));
			const missing = new Set<string>();
			for (const op of operations) for (const leg of op.positions) for (const id of [leg.securityId, leg.toSecurityId]) if (id != null && !listed.has(id)) missing.add(tickerOf.get(id) ?? String(id));
			if (missing.size) notes.push(`Valores de «${layout.sheet}» sin columna en los bloques por valor: ${[...missing].sort().join(', ')}.`);
		}

		const reference = options.reference?.get(layout.sheet);
		if (reference) {
			const overrides = config.overrides.filter((o) => o.sheet === layout.sheet).map((o) => ({ date: o.match.date, ticker: o.match.ticker, set: o.set.date }));
			comparisons.push(diffLog(model, reference, { from: options.from, overrides }));
		} else if (options.reference) notes.push(`La hoja de referencia no tiene la solapa «${layout.sheet}»: esa cartera no se compara.`);
	});
	return { models, comparisons, notes };
}

const MONEY = '#,##0.00;[Red]-#,##0.00';
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

// El libro se escribe en flujo, fila a fila: con cientos de miles de celdas, montarlo entero en memoria no cabe en el servidor.
type Writer = InstanceType<typeof ExcelJS.stream.xlsx.WorkbookWriter>;

function writeLog(workbook: Writer, model: LogModel): void {
	const { layout } = model;
	const ws = workbook.addWorksheet(layout.sheet, { views: [{ state: 'frozen', xSplit: 4, ySplit: HEADER_ROW }] });
	const f = fixedColumns(layout.main);
	const shares = new Set(model.columns.filter((c) => c.unit === 'shares').map((c) => c.col));
	const amounts = new Set(model.columns.filter((c) => c.unit === 'money').map((c) => c.col));
	for (let c = f.amountLocal || f.net; c <= f.cash + 6; c++) amounts.add(c);
	const last = Math.max(...model.columns.map((c) => c.col), f.cash + 6);
	ws.columns = Array.from({ length: last }, (_, i) => {
		const col = i + 1;
		if (col === 3) return { width: 11, style: { numFmt: 'dd/mm/yyyy' } };
		if (col === 4) return { width: 44 };
		if (col === 5) return { width: 18 };
		if (amounts.has(col)) return { width: 13, style: { numFmt: MONEY } };
		return { width: shares.has(col) ? 9 : 10 };
	});

	for (let r = 1; r <= HEADER_ROW; r++) {
		// Las filas van con índice 1 y la columna A vacía: ExcelJS toma así una matriz sin elemento 0.
		const row = ws.addRow(model.header[r] ?? []);
		if (r === HEADER_ROW) {
			row.font = { bold: true };
			row.alignment = { wrapText: true, vertical: 'bottom' };
		}
		// Los años de la cabecera comparten columna con importes: no deben tomar su formato.
		if (r === 1) for (const y of layout.years) if (typeof y.label === 'number') row.getCell(y.col).numFmt = '0';
		row.commit();
	}
	const blockStart = layout.tickers.length ? layout.costStart : Infinity;
	for (const { date, cells } of model.rows) {
		// En los bloques por valor los ceros se dejan en blanco: son la mayoría de las celdas.
		const values = cells.map((value, c) => (c === 3 ? asDate(date) : c >= blockStart && value === 0 ? null : value));
		ws.addRow(values).commit();
	}
	ws.commit();
}

function writeNotes(workbook: Writer, lines: string[]): void {
	const ws = workbook.addWorksheet('Notas');
	ws.columns = [{ width: 120 }];
	for (const line of lines) ws.addRow([line]).commit();
	ws.commit();
}

function writeDifferences(workbook: Writer, result: ValidationResult, options: ValidationOptions): void {
	const ws = workbook.addWorksheet('Diferencias', { views: [{ state: 'frozen', ySplit: 1 }] });
	ws.columns = [
		{ header: 'Solapa', width: 14 }, { header: 'Fecha', width: 11, style: { numFmt: 'dd/mm/yyyy' } }, { header: 'Columna', width: 8 }, { header: 'Concepto', width: 38 }, { header: 'Tipo', width: 20 },
		{ header: 'Hoja', width: 14 }, { header: 'Aplicación', width: 14 }, { header: 'Diferencia', width: 13 }, { header: 'Cambio de la diferencia', width: 13 }
	];
	ws.getRow(1).font = { bold: true };
	for (const comparison of result.comparisons) {
		// Primero lo que sigue sin cuadrar a día de hoy; después, el detalle por fecha.
		const order = (kind: string) => (kind === 'Diferencia vigente' ? 0 : kind === 'Métrica anual' ? 1 : 2);
		const sorted = [...comparison.differences].sort((a, b) => order(a.kind) - order(b.kind) || (order(a.kind) === 2 ? (a.date ?? '').localeCompare(b.date ?? '') : 0));
		for (const d of sorted) {
			const row = ws.addRow([d.sheet, d.date ? asDate(d.date) : null, d.cell, d.column, d.kind, d.reference, d.app, d.difference, d.change ?? null]);
			const format = /^Acciones /.test(d.column) ? '#,##0.######' : MONEY;
			for (const c of [6, 7, 8, 9]) row.getCell(c).numFmt = format;
			row.commit();
		}
	}
	ws.commit();

	const lines = ['Exportación de validación: el registro de cada cartera tal como lo calcula la aplicación, con las columnas de la hoja.'];
	if (options.from) lines.push(`Solo se detallan diferencias desde el ${options.from.slice(8)}/${options.from.slice(5, 7)}/${options.from.slice(0, 4)}; las vigentes se muestran siempre.`);
	lines.push(
		'',
		'Cómo leer la solapa «Diferencias» (diferencia = aplicación − hoja; no se informa de un céntimo o menos):',
		'· Diferencia vigente: acumulados que no coinciden en la última fecha comparable. Es lo que queda por cuadrar.',
		'· Métrica anual: celdas de la cabecera de métricas que no coinciden.',
		'· Movimientos del día: la suma de los importes de las operaciones de esa fecha no coincide (falta una operación, o tiene otro importe u otra fecha).',
		'· Acumulado: saldo, capital, ganancias, coste o acciones al cierre de esa fecha. Solo aparece cuando la diferencia cambia; una diferencia que se arrastra igual no se repite.',
		'Los acumulados solo se comparan en las fechas en que la hoja está ordenada; alrededor de una fila descolocada se comparan únicamente los movimientos del día.',
		''
	);
	for (const c of result.comparisons)
		lines.push(`${c.sheet}: ${c.referenceRows} filas en la hoja, ${c.checkpoints} cierres de día comparados (último: ${c.lastCheckpoint ?? '—'}), ${c.skippedDates} fechas sin comparar acumulados, ${c.differences.length} diferencias.`);
	if (result.notes.length) lines.push('', ...result.notes);
	writeNotes(workbook, lines);
}

/** Genera el libro de validación (formato .xlsx). */
export async function exportValidation(db: DatabaseSync, options: ValidationOptions): Promise<{ data: Uint8Array; result: ValidationResult }> {
	const result = buildValidation(db, options);
	const chunks: Buffer[] = [];
	const stream = new Writable({
		write(chunk: Buffer, _encoding, done) {
			chunks.push(chunk);
			done();
		}
	});
	const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
	if (options.reference) writeDifferences(workbook, result, options);
	else if (result.notes.length) writeNotes(workbook, result.notes);
	for (const model of result.models) writeLog(workbook, model);
	await workbook.commit();
	return { data: new Uint8Array(Buffer.concat(chunks)), result };
}

/** Lee de un libro las solapas de registro (`Log`, `Log…`) que sirven de referencia. */
export function readReference(path: string): Promise<Map<string, SheetRows>> {
	return readSheets(path, (name) => name.startsWith('Log'));
}

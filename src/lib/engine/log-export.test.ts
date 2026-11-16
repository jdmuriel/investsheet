import { describe, expect, it } from 'vitest';
import { buildLog, colIndex, colName, defaultBlocks, defaultYears, diffLog, fixedColumns, yearsFromReference, FIRST_ROW, type LogLayout, type LogOperation, type SheetRows } from './log-export.ts';

// Todos los datos de estas pruebas son inventados.
const BANK = 1;
const ACME = 7;
let nextId = 1;
function op(date: string, fields: Partial<LogOperation>): LogOperation {
	return {
		id: nextId++, date, seq: nextId, type: 'DIVIDENDOS', securityId: null, grossEur: 0, taxEur: 0, feesEur: 0, capitalInEur: 0, capitalOutEur: 0, purchaseEur: 0, cash: [], positions: [],
		description: '', ticker: null, accountCode: 'BANCO', quantity: null, price: null, currency: 'EUR', fxRate: null, amountLocal: null, taxLocal: null, feesLocal: null,
		...fields
	};
}
const operations: LogOperation[] = [
	op('2024-12-20', { type: 'APORTACION', capitalInEur: 100000, cash: [{ accountId: BANK, amount: 100000 }] }),
	op('2024-12-21', { type: 'INTERESES', grossEur: 1000, taxEur: 190, cash: [{ accountId: BANK, amount: 810 }] }),
	op('2025-01-10', { type: 'COMPRA', ticker: 'ACME', securityId: ACME, quantity: 10, price: 50, purchaseEur: 50000, feesEur: 200, cash: [{ accountId: BANK, amount: -50200 }], positions: [{ securityId: ACME, kind: 'buy', shares: 10_000_000, cost: 50000, reducedCost: 50000 }] }),
	op('2025-02-03', { ticker: 'ACME', securityId: ACME, grossEur: 2000, taxEur: 380, cash: [{ accountId: BANK, amount: 1620 }] })
];

function layout(main: boolean): LogLayout {
	const f = fixedColumns(main);
	return {
		sheet: main ? 'Log' : 'LogOtra',
		main,
		accounts: [{ col: f.cash, id: BANK, name: 'Banco', code: 'BANCO', currency: 'EUR' }],
		tickers: main ? [{ label: 'ACME', securityId: ACME }, { label: 'LON:NADA', securityId: null }] : [],
		...defaultBlocks(main ? 2 : 0),
		years: defaultYears(main, 2025, 2024)
	};
}
const cell = (row: (string | number | Date | null)[], letters: string) => row[colIndex(letters)];

/** Solapa de referencia con las mismas celdas que el modelo, como si la hoja coincidiera del todo. */
function asSheet(model: ReturnType<typeof buildLog>): SheetRows {
	const sheet: SheetRows = model.header.map((r) => [...(r ?? [])]);
	model.rows.forEach((row, i) => {
		sheet[FIRST_ROW + i] = [...row.cells];
		sheet[FIRST_ROW + i][3] = new Date(`${row.date}T00:00:00Z`);
	});
	return sheet;
}

describe('columnas', () => {
	it('convierte entre letras e índices', () => {
		expect(colIndex('A')).toBe(1);
		expect(colIndex('AE')).toBe(31);
		expect(colName(31)).toBe('AE');
		expect(colName(colIndex('HO'))).toBe('HO');
	});

	it('los bloques por valor caen donde están en la hoja', () => {
		expect(defaultBlocks(61)).toEqual({ costStart: colIndex('AE'), reducedStart: colIndex('CP'), sharesStart: colIndex('HO') });
	});
});

describe('registro con el formato de la hoja', () => {
	it('registro principal: columnas de entrada, acumulados, saldos y bloques por valor', () => {
		const model = buildLog(operations, layout(true));
		expect(model.rows).toHaveLength(4);
		const buy = model.rows[2].cells;
		expect(cell(buy, 'C')).toBe('2025-01-10');
		expect(cell(buy, 'E')).toBe('COMPRA');
		expect(cell(buy, 'O')).toBe(-2); // resultado neto: solo los gastos
		expect(cell(buy, 'R')).toBe(2);
		expect(cell(buy, 'U')).toBe(500);
		// El capital invertido del registro principal incluye el resultado del año cerrado.
		expect(cell(buy, 'V')).toBe(1008.1);
		expect(cell(buy, 'W')).toBe(-2);
		expect(cell(buy, 'X')).toBe(506.1);
		expect(cell(buy, 'AE')).toBe(500);
		expect(cell(buy, 'AG')).toBe(500); // total coste
		const shares = model.layout.sharesStart;
		expect(buy[shares]).toBe(10);
		expect(model.rows[1].cells[shares]).toBe(0);
		expect(model.header[9][colIndex('AE')]).toBe('ACME');
		expect(model.header[7][colIndex('X')]).toBe('BANCO');
	});

	it('cabecera de métricas: año en curso, anteriores y total', () => {
		const { header } = buildLog(operations, layout(true));
		expect(header[1].slice(colIndex('Q'), colIndex('S') + 1)).toEqual(['Año en curso', 2024, 2023]);
		expect(header[2][colIndex('R')]).toBe(1000); // aumento de capital de 2024
		expect(header[3][colIndex('Q')]).toBe(20); // ingresos de 2025
		expect(header[6][colIndex('Q')]).toBe(14.2); // neto de 2025: 20 − 3,80 − 2
		expect(header[7][colIndex('W')]).toBe(500); // compras desde el principio
		expect(header[3][colIndex('W')]).toBe(30);
	});

	it('registro secundario: sin moneda local ni bloques, y el capital no suma años cerrados', () => {
		const model = buildLog(operations, layout(false));
		const buy = model.rows[2].cells;
		expect(cell(buy, 'L')).toBe(-2);
		expect(cell(buy, 'R')).toBe(500);
		expect(cell(buy, 'S')).toBe(1000);
		expect(cell(buy, 'V')).toBe(506.1);
		expect(model.columns.some((c) => c.unit === 'shares')).toBe(false);
	});
});

describe('diferencias con la hoja', () => {
	it('sin diferencias cuando la hoja dice lo mismo, aunque el orden dentro del día sea otro', () => {
		const model = buildLog(operations, layout(true));
		const result = diffLog(model, asSheet(model));
		expect(result.differences).toEqual([]);
		expect(result).toMatchObject({ referenceRows: 4, checkpoints: 4, lastCheckpoint: '2025-02-03', skippedDates: 0 });
	});

	it('un importe distinto aparece como movimiento del día y como acumulado, una sola vez', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		// En la hoja, los intereses de 2024 son 1 € más: lo arrastran capital y saldo en todas las filas siguientes.
		for (let i = 1; i < 4; i++) {
			const row = sheet[FIRST_ROW + i];
			if (i === 1) row[colIndex('P')] = 11;
			if (i === 1) row[colIndex('W')] = (row[colIndex('W')] as number) + 1;
			else row[colIndex('V')] = (row[colIndex('V')] as number) + 1;
			row[colIndex('X')] = (row[colIndex('X')] as number) + 1;
		}
		const { differences } = diffLog(model, sheet);
		const by = (kind: string) => differences.filter((d) => d.kind === kind).map((d) => `${d.date} ${d.cell} ${d.difference}`);
		expect(by('Movimientos del día')).toEqual(['2024-12-21 P -1']);
		expect(by('Acumulado')).toEqual(['2024-12-21 W -1', '2024-12-21 X -1', '2025-01-10 V -1', '2025-01-10 W 0']);
		expect(by('Diferencia vigente')).toEqual(['2025-02-03 V -1', '2025-02-03 X -1']);
		expect(by('Métrica anual')).toEqual([]);
	});

	it('compara las métricas anuales de la cabecera', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		sheet[3][colIndex('R')] = 11; // ingresos de 2024 en la hoja
		expect(diffLog(model, sheet).differences).toEqual([
			{ sheet: 'Log', date: null, cell: 'R3', column: 'Total ingresos · 2024', kind: 'Métrica anual', reference: 11, app: 10, difference: -1 }
		]);
	});

	it('no informa de diferencias de un céntimo', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		sheet[FIRST_ROW + 3][colIndex('X')] = (sheet[FIRST_ROW + 3][colIndex('X')] as number) + 0.01;
		expect(diffLog(model, sheet).differences).toEqual([]);
	});

	it('con filas descolocadas en la hoja solo compara acumulados donde vuelve a estar en orden', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		// La compra de enero está anotada después del dividendo de febrero.
		[sheet[FIRST_ROW + 2], sheet[FIRST_ROW + 3]] = [sheet[FIRST_ROW + 3], sheet[FIRST_ROW + 2]];
		const result = diffLog(model, sheet);
		expect(result.differences.filter((d) => d.kind !== 'Diferencia vigente')).toEqual([]);
		expect(result).toMatchObject({ checkpoints: 2, lastCheckpoint: '2024-12-21', skippedDates: 2 });
	});

	it('admite que la hoja cierre el año en una fila de 31 de diciembre', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		// Fila de cierre sin tipo: la hoja ya ha pasado el resultado de 2024 (8,10 €) al capital y reiniciado las ganancias.
		const closing: SheetRows[number] = [];
		closing[3] = new Date('2024-12-31T00:00:00Z');
		closing[colIndex('V')] = 1008.1;
		closing[colIndex('W')] = 0;
		closing[colIndex('X')] = 1008.1;
		sheet.splice(FIRST_ROW + 2, 0, closing);
		expect(diffLog(model, sheet).differences).toEqual([]);
	});

	it('una operación que falta en la aplicación aparece en su fecha', () => {
		const model = buildLog(operations.slice(0, 3), layout(true));
		const full = asSheet(buildLog(operations, layout(true)));
		const { differences } = diffLog(model, full);
		expect(differences.find((d) => d.kind === 'Movimientos del día')).toMatchObject({ date: '2025-02-03', cell: 'P', reference: 20, app: 0, difference: -20 });
		expect(differences.some((d) => d.kind === 'Acumulado' && d.cell === 'X' && d.difference === -16.2)).toBe(true);
	});

	it('«desde» deja fuera el detalle anterior pero no las diferencias vigentes', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		for (let i = 1; i < 4; i++) sheet[FIRST_ROW + i][colIndex('X')] = (sheet[FIRST_ROW + i][colIndex('X')] as number) + 5;
		const kinds = diffLog(model, sheet, { from: '2025-01-01' }).differences.map((d) => d.kind);
		expect(kinds).toEqual(['Diferencia vigente']);
	});

	it('corrige las fechas mal tecleadas que conoce la importación', () => {
		const model = buildLog(operations, layout(true));
		const sheet = asSheet(model);
		sheet[FIRST_ROW + 3][3] = new Date('2024-02-03T00:00:00Z');
		sheet[FIRST_ROW + 3][6] = 'NYSE:ACME';
		expect(diffLog(model, sheet).differences.length).toBeGreaterThan(0);
		expect(diffLog(model, sheet, { overrides: [{ date: '2024-02-03', ticker: 'ACME', set: '2025-02-03' }] }).differences).toEqual([]);
	});

	it('lee de la cabecera de la hoja a qué año corresponde cada columna', () => {
		const sheet: SheetRows = [];
		sheet[1] = [];
		['Año en curso', 2025, 2024, 'Desde 2014'].forEach((label, i) => (sheet[1][colIndex('Q') + i] = label));
		expect(yearsFromReference(sheet, true).map((y) => y.year)).toEqual([2026, 2025, 2024, null]);
	});
});

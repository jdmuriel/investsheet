import { describe, expect, it } from 'vitest';
import { addMonths, buildHistory, compareMonth, comparisonText, evolution, securityHistory, yearTotals, type Payment } from './history.ts';

// Datos inventados.
let next = 1;
const ids = new Map<string, number>();
function pay(date: string, ticker: string, shares: number | null, dps: number | null, gross: number, currency = 'EUR', account = 'A'): Payment {
	if (!ids.has(ticker)) ids.set(ticker, next++);
	return { date, securityId: ids.get(ticker)!, ticker, account, shares, dps, currency, gross, net: Math.round(gross * 0.81) };
}
const id = (t: string) => ids.get(t)!;

describe('meses', () => {
	it('suma y resta meses cruzando años', () => {
		expect(addMonths('2030-01', -1)).toBe('2029-12');
		expect(addMonths('2030-11', 3)).toBe('2031-02');
		expect(addMonths('2030-09', -12)).toBe('2029-09');
	});
});

describe('historial por meses', () => {
	const h = buildHistory([pay('2030-03-10', 'AAA', 100, 0.5, 5000), pay('2030-03-20', 'AAA', 100, 0.1, 1000), pay('2031-03-10', 'AAA', 120, 0.55, 6600)]);
	it('agrupa los cobros de un valor en el mismo mes sumando lo cobrado por acción', () => {
		const c = h.months.get('2030-03')!.get(id('AAA'))!;
		expect(c).toMatchObject({ gross: 6000, shares: 100, count: 2 });
		expect(c.dps).toBeCloseTo(0.6);
	});
	it('el mismo dividendo cobrado en dos cuentas suma acciones', () => {
		const two = buildHistory([pay('2030-09-09', 'TWO', 7, 2, 1400, 'USD', 'A'), pay('2030-09-09', 'TWO', 9, 2, 1800, 'USD', 'B')]);
		expect(two.months.get('2030-09')!.get(id('TWO'))).toMatchObject({ shares: 16, dps: 2, gross: 3200, count: 2 });
	});
	it('totales por año con su variación', () => {
		expect(yearTotals(h, 'bruto')).toEqual([
			{ year: 2030, amount: 6000, change: null },
			{ year: 2031, amount: 6600, change: 0.1 }
		]);
	});
	it('cobros de un valor por año', () => {
		const rows = securityHistory(h, id('AAA'));
		expect(rows.map((r) => r.year)).toEqual([2031, 2030]);
		expect(rows[1]).toMatchObject({ gross: 6000, shares: 100, currency: 'EUR' });
		expect(rows[1].months[2]?.gross).toBe(6000);
	});
});

describe('evolución del año', () => {
	const h = buildHistory([pay('2030-02-01', 'AAA', 10, 1, 1000), pay('2030-08-01', 'AAA', 10, 1, 1000), pay('2031-02-01', 'AAA', 10, 1.5, 1500), pay('2031-03-05', 'AAA', 10, 0.5, 500)]);
	it('acumula mes a mes y compara con el año anterior', () => {
		const e = evolution(h, 2031, 'bruto', '2031-12-31');
		expect(e.months[1]).toMatchObject({ amount: 1500, cumulative: 1500, prevAmount: 1000, prevCumulative: 1000, change: 0.5, cumChange: 0.5 });
		expect(e.months[2].cumulative).toBe(2000);
		expect(e.prevTotal).toBe(2000);
		expect(e.reachedOn).toBe('2031-03-05');
	});
	it('en el año en curso, los meses por llegar van vacíos y se estima cuándo se alcanzará el año anterior', () => {
		const e = evolution(h, 2031, 'bruto', '2031-02-15', [0, 1500, 0, 0, 0, 0, 0, 0, 600, 0, 0, 0]);
		expect(e.months[2].future).toBe(true);
		expect(e.total).toBe(1500);
		expect(e.reachedOn).toBeNull();
		expect(e.prevToDate).toBe(1000);
		expect(e.forecastMonth).toBe('2031-09');
	});
});

describe('comparación de un mes', () => {
	const today = '2031-12-31';
	const h = buildHistory([
		pay('2030-09-10', 'UP', 100, 0.5, 5000),
		pay('2031-09-10', 'UP', 110, 0.55, 6050),
		pay('2030-09-10', 'DIV', 100, 0.5, 5000),
		pay('2031-09-10', 'DIV', 100, 0.6, 6000),
		pay('2030-09-10', 'SAME', 100, 1, 9000, 'USD'),
		pay('2031-09-10', 'SAME', 100, 1, 8500, 'USD'),
		pay('2028-09-10', 'BACK', 50, 1, 5000),
		pay('2031-09-10', 'BACK', 50, 1, 5000),
		pay('2031-09-10', 'NEW', 10, 1, 1000),
		pay('2030-10-10', 'EARLY', 10, 1, 1000),
		pay('2031-09-10', 'EARLY', 10, 1, 1000),
		pay('2030-09-10', 'GONE', 10, 1, 1000),
		pay('2030-09-10', 'SPLIT', 10, 2, 2000),
		pay('2031-09-10', 'SPLIT', 20, 1.1, 2200)
	]);
	const cmp = compareMonth(h, '2031-09', 'anual', 'bruto', { today, held: (s) => (s === id('GONE') ? 0 : 1), splits: [{ securityId: id('SPLIT'), date: '2031-05-01', factor: 2 }] });
	const row = (t: string) => cmp.rows.find((r) => r.ticker === t)!;
	it('reparte la diferencia entre acciones, dividendo y cambio', () => {
		expect(row('UP')).toMatchObject({ cause: 'cambio', dividend: 1, shares: 1, diff: 1050, parts: { shares: 500, dividend: 550, fx: 0 } });
		expect(row('DIV')).toMatchObject({ dividend: 1, shares: 0, parts: { shares: 0, dividend: 1000, fx: 0 } });
		expect(row('SAME')).toMatchObject({ dividend: 0, shares: 0, diff: -500, parts: { fx: -500 } });
	});
	it('ajusta acciones y dividendo por los splits', () => {
		expect(row('SPLIT')).toMatchObject({ dividend: 1, shares: 0 });
	});
	it('distingue nuevos, los que vuelven, los que se adelantan y los vendidos', () => {
		expect(row('NEW').cause).toBe('nuevo');
		expect(row('BACK').cause).toBe('vuelve');
		expect(row('EARLY')).toMatchObject({ cause: 'adelanta', movedFrom: '2030-10' });
		expect(row('GONE').cause).toBe('vendido');
	});
	it('un cobro que pasa al mes siguiente se atrasa; si aún no ha llegado, está pendiente', () => {
		const late = buildHistory([pay('2030-09-10', 'LATE', 10, 1, 1000), pay('2031-10-10', 'LATE', 10, 1, 1000)]);
		expect(compareMonth(late, '2031-09', 'anual', 'bruto', { today }).rows[0]).toMatchObject({ cause: 'atrasa', movedFrom: '2031-10' });
		expect(compareMonth(late, '2031-10', 'anual', 'bruto', { today }).rows[0]).toMatchObject({ cause: 'atrasa', movedFrom: '2030-09' });
		const waiting = buildHistory([pay('2030-09-10', 'WAIT', 10, 1, 1000)]);
		expect(compareMonth(waiting, '2031-09', 'anual', 'bruto', { today: '2031-09-05' }).rows[0].cause).toBe('pendiente');
	});
	it('frente al trimestre anterior, los pagos anuales o semestrales no se toman por nuevos', () => {
		const q = compareMonth(h, '2031-09', 'trimestral', 'bruto', { today });
		expect(q.base).toBe('2031-06');
		expect(q.rows.find((r) => r.ticker === 'UP')!.cause).toBe('no-trimestral');
	});
	it('redacta el texto del mes', () => {
		const text = comparisonText(cmp, 'bruto');
		expect(text.startsWith('En bruto 297.50€, por 220.00€ del año pasado. Nuevo cobro de NEW(+10€); vuelvo a cobrar BACK(+50€), que no cobré en 2030; subida de dividendo y acciones de UP(+11€); subida de dividendo de DIV(+10€), SPLIT(+2€);')).toBe(true);
		expect(text).toContain('se adelanta el cobro de EARLY(+10€)');
		expect(text).toContain('sin cambios SAME(-5€)');
		expect(text.endsWith('ya no cobro, por venta, GONE(-10€).')).toBe(true);
	});
});

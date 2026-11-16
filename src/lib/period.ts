/** Periodos que ofrece el listado de movimientos. */
export interface Period {
	/** `ultimos`, `mes`, `trimestre`, `actual` (año en curso), un año (`2024`) o `todos`. */
	key: string;
	/** Fechas AAAA-MM-DD, inclusive; `null` = sin límite. */
	from: string | null;
	to: string | null;
	/** Año cuyas métricas se resaltan, si el periodo cae en uno solo. */
	year: number | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Rango de fechas de un periodo, a partir de la fecha de hoy (AAAA-MM-DD). Lo que no se
 * reconoce se trata como `ultimos`: el mes anterior completo y el mes en curso.
 */
export function resolvePeriod(key: string | null, today: string): Period {
	const year = Number(today.slice(0, 4));
	const month = Number(today.slice(5, 7));
	if (key === 'todos') return { key, from: null, to: null, year: null };
	if (key === 'mes') return { key, from: `${year}-${pad(month)}-01`, to: null, year };
	if (key === 'trimestre') return { key, from: `${year}-${pad(month - ((month - 1) % 3))}-01`, to: null, year };
	if (key === 'actual' || key === String(year)) return { key: 'actual', from: `${year}-01-01`, to: null, year };
	if (key && /^\d{4}$/.test(key)) return { key, from: `${key}-01-01`, to: `${key}-12-31`, year: Number(key) };
	const from = month === 1 ? `${year - 1}-12-01` : `${year}-${pad(month - 1)}-01`;
	return { key: 'ultimos', from, to: null, year };
}

export function inPeriod(date: string, period: Period): boolean {
	return (period.from == null || date >= period.from) && (period.to == null || date <= period.to);
}

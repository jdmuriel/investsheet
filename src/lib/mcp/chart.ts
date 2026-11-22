/**
 * Gráficos en SVG autónomo (barras, barras apiladas y líneas) para el servidor MCP.
 * Puro: recibe los datos y devuelve el texto del SVG. Lleva colores de modo claro y oscuro,
 * leyenda con dos o más series y el valor de cada marca al pasar el ratón (`<title>`).
 */
import { dec2, eurWhole } from '../format.ts';

export type ChartKind = 'barras' | 'barras_apiladas' | 'lineas';

export interface ChartSeries {
	name: string;
	/** Un valor por etiqueta, en unidades (euros, no céntimos); `null` deja el hueco. */
	values: (number | null)[];
}

export interface ChartSpec {
	title: string;
	subtitle?: string;
	kind: ChartKind;
	labels: string[];
	series: ChartSeries[];
	/** Unidad que se añade al valor en las etiquetas: «€», «%», «acciones»… */
	unit?: string;
	width?: number;
	height?: number;
}

/** Paleta categórica validada, en orden fijo (claro / oscuro). */
const PALETTE = [
	['#2a78d6', '#3987e5'],
	['#eb6834', '#d95926'],
	['#1baf7a', '#199e70'],
	['#eda100', '#c98500'],
	['#e87ba4', '#d55181'],
	['#008300', '#0ca30c'],
	['#6250d6', '#9085e9'],
	['#e34948', '#e66767']
];
export const MAX_SERIES = PALETTE.length;
/** «Otros» no es una entidad: va en gris neutro, no con el siguiente color de la paleta. */
const OTHER = 'Otros';
const OTHER_COLORS = ['#a3a29b', '#6b6a64'];

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Valor con separador de miles: sin decimales a partir de 100, con dos por debajo. */
export function formatValue(value: number, unit = ''): string {
	const text = Math.abs(value) >= 100 ? eurWhole(Math.round(value * 100)) : dec2(value);
	return unit ? `${text} ${unit}` : text;
}

/** Paso «redondo» (1, 2, 2,5 o 5 por una potencia de diez) para unas cinco divisiones. */
export function niceStep(span: number, divisions = 5): number {
	if (!(span > 0)) return 1;
	const raw = span / divisions;
	const power = 10 ** Math.floor(Math.log10(raw));
	const f = raw / power;
	return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power;
}

/** Comprueba la especificación; devuelve la lista de errores (vacía si es válida). */
export function validateChart(spec: ChartSpec): string[] {
	const errors: string[] = [];
	if (!['barras', 'barras_apiladas', 'lineas'].includes(spec.kind)) errors.push('«tipo» debe ser barras, barras_apiladas o lineas.');
	if (!spec.labels?.length) errors.push('Faltan las etiquetas del eje horizontal.');
	if (!spec.series?.length) errors.push('Falta al menos una serie.');
	if (spec.series?.length > MAX_SERIES) errors.push(`Como mucho ${MAX_SERIES} series: agrupa el resto en «Otros».`);
	for (const s of spec.series ?? []) {
		if (s.values?.length !== spec.labels?.length) errors.push(`La serie «${s.name}» tiene ${s.values?.length ?? 0} valores y hay ${spec.labels?.length ?? 0} etiquetas.`);
		if (s.values?.some((v) => v != null && !Number.isFinite(v))) errors.push(`La serie «${s.name}» tiene valores que no son números.`);
	}
	return errors;
}

/** Rectángulo con las esquinas del extremo de datos redondeadas (4 px) y recto en la línea base. */
function bar(x: number, y0: number, y1: number, w: number, rounded: boolean): string {
	const up = y1 < y0;
	const h = Math.abs(y1 - y0);
	const r = rounded ? Math.min(4, w / 2, h) : 0;
	if (r === 0) return `M${r1(x)},${r1(Math.min(y0, y1))}h${r1(w)}v${r1(h)}h${r1(-w)}z`;
	return up
		? `M${r1(x)},${r1(y0)}V${r1(y1 + r)}Q${r1(x)},${r1(y1)} ${r1(x + r)},${r1(y1)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y1)} ${r1(x + w)},${r1(y1 + r)}V${r1(y0)}z`
		: `M${r1(x)},${r1(y0)}V${r1(y1 - r)}Q${r1(x)},${r1(y1)} ${r1(x + r)},${r1(y1)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y1)} ${r1(x + w)},${r1(y1 - r)}V${r1(y0)}z`;
}

export function renderChart(spec: ChartSpec): string {
	const errors = validateChart(spec);
	if (errors.length) throw new Error(errors.join(' '));
	const W = spec.width ?? 880;
	const H = spec.height ?? 440;
	const unit = spec.unit ?? '';
	const many = spec.series.length > 1;
	const left = 72;
	const right = 20;
	const top = (spec.subtitle ? 62 : 44) + (many ? 26 : 0);
	const bottom = 40;
	const plotW = W - left - right;
	const plotH = H - top - bottom;
	const n = spec.labels.length;

	// Dominio vertical: incluye el cero; en barras apiladas, la suma de cada columna.
	const columns = spec.labels.map((_, i) => spec.series.map((s) => s.values[i] ?? 0));
	const extremes =
		spec.kind === 'barras_apiladas'
			? columns.flatMap((c) => [c.filter((v) => v > 0).reduce((a, b) => a + b, 0), c.filter((v) => v < 0).reduce((a, b) => a + b, 0)])
			: columns.flat();
	let min = Math.min(0, ...extremes);
	let max = Math.max(0, ...extremes);
	if (min === max) max = 1;
	const step = niceStep(max - min);
	min = Math.floor(min / step) * step;
	max = Math.ceil(max / step - 1e-9) * step;
	const y = (v: number) => top + plotH - ((v - min) / (max - min)) * plotH;
	const band = plotW / n;
	const cx = (i: number) => left + band * (i + 0.5);

	const colors = spec.series.map((s, i) => (s.name === OTHER && i === spec.series.length - 1 ? OTHER_COLORS : PALETTE[i]));
	const out: string[] = [];
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" role="img" aria-label="${escape(spec.title)}">`,
		'<style>',
		`svg{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#8a8984;--grid:#e6e5e0;${colors.map((c, i) => `--s${i}:${c[0]}`).join(';')}}`,
		`@media (prefers-color-scheme: dark){svg{--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#8f8e86;--grid:#33332f;${colors.map((c, i) => `--s${i}:${c[1]}`).join(';')}}}`,
		'.t{fill:var(--ink);font-size:17px;font-weight:600}.st{fill:var(--ink2);font-size:13px}.ax{fill:var(--muted);font-size:12px}.lg{fill:var(--ink2);font-size:12.5px}',
		'.g{stroke:var(--grid);stroke-width:1}.base{stroke:var(--muted);stroke-width:1}.m:hover{opacity:.8}',
		'</style>',
		`<rect width="${W}" height="${H}" fill="var(--surface)"/>`,
		`<text class="t" x="${left}" y="26">${escape(spec.title)}</text>`
	);
	if (spec.subtitle) out.push(`<text class="st" x="${left}" y="46">${escape(spec.subtitle)}</text>`);

	// Leyenda en una fila, sobre el gráfico.
	if (many) {
		let lx = left;
		const ly = top - 18;
		spec.series.forEach((s, i) => {
			out.push(`<rect x="${lx}" y="${ly - 9}" width="10" height="10" rx="2" fill="var(--s${i})"/><text class="lg" x="${lx + 15}" y="${ly}">${escape(s.name)}</text>`);
			lx += 30 + s.name.length * 7;
		});
	}

	// Rejilla y eje vertical.
	for (let v = min; v <= max + step / 2; v += step) {
		const yy = r1(y(v));
		out.push(`<line class="${Math.abs(v) < step / 2 ? 'base' : 'g'}" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/>`);
		const tick = Math.abs(v) < step / 2 ? 0 : v;
		out.push(`<text class="ax" x="${left - 8}" y="${yy + 4}" text-anchor="end">${escape(step >= 1 ? eurWhole(Math.round(tick * 100)) : formatValue(tick))}</text>`);
	}
	// Etiquetas del eje horizontal, aclaradas si no caben.
	const longest = Math.max(...spec.labels.map((l) => l.length));
	const every = Math.max(1, Math.ceil((longest * 7 + 10) / band));
	spec.labels.forEach((l, i) => {
		if (i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2)) out.push(`<text class="ax" x="${r1(cx(i))}" y="${H - bottom + 18}" text-anchor="middle">${escape(l)}</text>`);
	});

	const tip = (i: number, s: ChartSeries, v: number) => `<title>${escape(`${spec.labels[i]}${many ? ` · ${s.name}` : ''}: ${formatValue(v, unit)}`)}</title>`;
	const zero = y(0);
	if (spec.kind === 'barras') {
		const k = spec.series.length;
		const w = Math.max(2, Math.min(24, (band * 0.72) / k - 2));
		spec.series.forEach((s, j) => {
			s.values.forEach((v, i) => {
				if (v == null || v === 0) return;
				const x = cx(i) - (k * (w + 2) - 2) / 2 + j * (w + 2);
				out.push(`<path class="m" fill="var(--s${j})" d="${bar(x, zero, y(v), w, true)}">${tip(i, s, v)}</path>`);
			});
		});
	} else if (spec.kind === 'barras_apiladas') {
		const w = Math.max(2, Math.min(24, band * 0.6));
		columns.forEach((col, i) => {
			let pos = 0;
			let neg = 0;
			const lastUp = col.findLastIndex((v) => v > 0);
			const lastDown = col.findLastIndex((v) => v < 0);
			col.forEach((v, j) => {
				if (v === 0) return;
				const from = v > 0 ? pos : neg;
				const to = from + v;
				if (v > 0) pos = to;
				else neg = to;
				// Hueco de 2 px entre segmentos: cada segmento empieza un poco más allá del anterior.
				const gap = from === 0 ? 0 : v > 0 ? -2 : 2;
				const y0 = y(from) + gap;
				const y1 = y(to);
				if (Math.abs(y1 - y0) < 0.5) return;
				out.push(`<path class="m" fill="var(--s${j})" d="${bar(cx(i) - w / 2, y0, y1, w, j === (v > 0 ? lastUp : lastDown))}">${tip(i, spec.series[j], v)}</path>`);
			});
		});
	} else {
		spec.series.forEach((s, j) => {
			const points = s.values.map((v, i) => (v == null ? null : [r1(cx(i)), r1(y(v))]));
			// Tramos continuos: un hueco (`null`) corta la línea.
			let path = '';
			points.forEach((p, i) => {
				if (!p) return;
				path += `${i > 0 && points[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}`;
			});
			out.push(`<path d="${path}" fill="none" stroke="var(--s${j})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
			const markers = n <= 40;
			points.forEach((p, i) => {
				if (!p) return;
				const v = s.values[i]!;
				out.push(
					markers
						? `<circle class="m" cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--s${j})" stroke="var(--surface)" stroke-width="2">${tip(i, s, v)}</circle>`
						: `<circle cx="${p[0]}" cy="${p[1]}" r="${r1(Math.max(3, band / 2))}" fill="transparent">${tip(i, s, v)}</circle>`
				);
			});
			// Etiqueta directa del último valor (con el nombre si hay pocas series).
			const last = points.findLastIndex((p) => p != null);
			if (last >= 0 && spec.series.length <= 4) {
				const [px, py] = points[last]!;
				const label = formatValue(s.values[last]!, unit);
				out.push(`<text class="lg" x="${px}" y="${py - 10}" text-anchor="end">${escape(spec.series.length > 1 ? `${s.name}: ${label}` : label)}</text>`);
			}
		});
	}
	out.push('</svg>');
	return out.join('\n');
}

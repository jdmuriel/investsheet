<script lang="ts">
	import { date, eurWhole, num, price as fmtPrice, pct } from '#lib/format.ts';
	import type { PricePoint, Purchase } from '#lib/engine/selection.ts';
	import { MICRO } from '#lib/engine/types.ts';

	/**
	 * Evolución del precio de un valor en las revisiones de la selección. `small` es la línea de la tabla;
	 * sin él, el gráfico con eje, objetivo y detalle de cada punto al pasar el ratón o tocar.
	 */
	let {
		points,
		currency = null,
		target = null,
		tone = null,
		purchases = [],
		small = false,
		label = ''
	}: { points: PricePoint[]; currency?: string | null; target?: number | null; tone?: string | null; purchases?: Purchase[]; small?: boolean; label?: string } = $props();

	const toneClass = $derived(tone?.replace(' ', '-') ?? '');
	let measured = $state(600);
	const width = $derived(small ? 96 : measured);
	const times = $derived(points.map((p) => Date.parse(p.date)));
	/** Milisegundos por píxel, aproximado (sin márgenes de rótulos): para repartir los rótulos de compras. */
	const msPerPx = $derived(times.length > 1 ? (times[times.length - 1] - times[0]) / Math.max(width - 72, 1) : 1);
	/** Compras con su rótulo (acciones y total) en el grande; los rótulos que se pisarían bajan a otra fila. */
	const buys = $derived.by(() => {
		const rows: number[] = [];
		return purchases.map((b) => {
			const t = Date.parse(b.date);
			const text = `${num(b.shares / MICRO)} acc.${b.price == null ? '' : ` a ${fmtPrice(b.price, b.currency ?? currency)}`}, total ${eurWhole(b.cost)} €`;
			const span = (text.length * 6 + 8) * msPerPx;
			// Pegado a la derecha de la raya, o a la izquierda si no cabe antes del final.
			const end = t + span > times[times.length - 1];
			const start = end ? t - span : t;
			let row = rows.findIndex((last) => last < start);
			if (row < 0) row = rows.push(0) - 1;
			rows[row] = start + span;
			return { ...b, t, text, row, end };
		});
	});
	const labelRows = $derived(small ? 0 : Math.max(0, ...buys.map((b) => b.row + 1)));
	const height = $derived(small ? 24 : 220 + labelRows * 14);
	const pad = $derived(small ? { l: 3, r: 4, t: 4, b: 4 } : { l: 56, r: 16, t: 14 + labelRows * 14, b: 26 });

	const domain = $derived.by(() => {
		const values = points.map((p) => p.price);
		// En el grande el objetivo entra en la escala: la distancia a él es lo que se mira.
		if (!small && target) values.push(target);
		let lo = Math.min(...values);
		let hi = Math.max(...values);
		if (lo === hi) [lo, hi] = [lo * 0.95, hi * 1.05];
		const margin = small ? 0 : (hi - lo) * 0.08;
		return { lo: lo - margin, hi: hi + margin, t0: times[0], t1: times[times.length - 1] };
	});
	const x = (t: number) => (domain.t1 === domain.t0 ? (pad.l + width - pad.r) / 2 : pad.l + ((t - domain.t0) / (domain.t1 - domain.t0)) * (width - pad.l - pad.r));
	const y = (v: number) => pad.t + (1 - (v - domain.lo) / (domain.hi - domain.lo)) * (height - pad.t - pad.b);
	const path = $derived(points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.price).toFixed(1)}`).join(''));

	/** Marcas del eje vertical en valores redondos (1, 2 o 5 por potencia de diez). */
	const ticks = $derived.by(() => {
		const span = domain.hi - domain.lo;
		const raw = span / 4;
		const pow = 10 ** Math.floor(Math.log10(raw));
		const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
		const out: number[] = [];
		for (let v = Math.ceil(domain.lo / step) * step; v <= domain.hi; v += step) out.push(Math.round(v / step) * step);
		return out;
	});
	/** Principios de año dentro del periodo dibujado, para las rayas verticales del gráfico pequeño. */
	const yearStarts = $derived.by(() => {
		const out: number[] = [];
		if (!points.length) return out;
		for (let y = Number(points[0].date.slice(0, 4)) + 1; y <= Number(points[points.length - 1].date.slice(0, 4)); y++) out.push(Date.parse(`${y}-01-01`));
		return out;
	});
	/** Rótulos del eje horizontal: el primer punto de cada año. */
	const years = $derived(points.map((p, i) => ({ i, year: p.date.slice(0, 4) })).filter((p, k, all) => k === 0 || p.year !== all[k - 1].year));

	let hover = $state<number | null>(null);
	function pick(event: PointerEvent) {
		const svg = event.currentTarget as SVGSVGElement;
		const px = event.clientX - svg.getBoundingClientRect().left;
		let best = 0;
		for (let i = 1; i < points.length; i++) if (Math.abs(x(times[i]) - px) < Math.abs(x(times[best]) - px)) best = i;
		hover = best;
	}
	const first = $derived(points[0]?.price ?? 0);
	const shown = $derived(hover == null ? null : points[hover]);
	const axisNumber = (v: number) => fmtPrice(v).replace(/,?0+$/, '').replace(/,$/, '');
</script>

{#if points.length < 2}
	{#if !small}<p class="muted">Aún no hay precios de dos revisiones para dibujar su evolución.</p>{/if}
{:else if small}
	<svg class="spark" {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label}>
		{#each yearStarts as t (t)}<line class="year" x1={x(t)} x2={x(t)} y1="0" y2={height} />{/each}
		{#each buys as b (b.date)}<line class="buy" x1={x(b.t)} x2={x(b.t)} y1="0" y2={height} />{/each}
		<path d={path} />
		<circle class="end {toneClass}" cx={x(times[times.length - 1])} cy={y(points[points.length - 1].price)} r="2.5" />
	</svg>
{:else}
	<div class="chart" bind:clientWidth={measured}>
		<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={label} onpointermove={pick} onpointerdown={pick} onpointerleave={() => (hover = null)}>
			{#each yearStarts as t (t)}<line class="year" x1={x(t)} x2={x(t)} y1={pad.t} y2={height - pad.b} />{/each}
			{#each ticks as v (v)}
				<line class="grid" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
				<text class="axis" x={pad.l - 6} y={y(v)} text-anchor="end" dominant-baseline="middle">{axisNumber(v)}</text>
			{/each}
			{#each years as yr (yr.i)}
				<text class="axis" x={x(times[yr.i])} y={height - 6} text-anchor={yr.i === 0 ? 'start' : 'middle'}>{yr.year}</text>
			{/each}
			{#each buys as b (b.date)}
				<line class="buy" x1={x(b.t)} x2={x(b.t)} y1={14 + b.row * 14} y2={height - pad.b} />
				<text class="buy-label" x={x(b.t) + (b.end ? -4 : 4)} y={14 + b.row * 14 + 9} text-anchor={b.end ? 'end' : 'start'}><title>Compra del {date(b.date)}</title>{b.text}</text>
			{/each}
			{#if target}
				<line class="target" x1={pad.l} x2={width - pad.r} y1={y(target)} y2={y(target)} />
				<text class="axis" x={width - pad.r} y={y(target) - 5} text-anchor="end">Objetivo {fmtPrice(target)}</text>
			{/if}
			<path class="line" d={path} />
			{#each points as p, i (p.date)}
				{#if p.today || i === points.length - 1}
					<circle class="end {toneClass}" class:today={p.today} cx={x(times[i])} cy={y(p.price)} r="4" />
				{/if}
			{/each}
			{#if shown && hover != null}
				<line class="cross" x1={x(times[hover])} x2={x(times[hover])} y1={pad.t} y2={height - pad.b} />
				<circle class="dot" cx={x(times[hover])} cy={y(shown.price)} r="4" />
			{/if}
		</svg>
		{#if shown && hover != null}
			<div class="tip" style:left="{Math.min(Math.max(x(times[hover]), 70), width - 70)}px">
				<strong>{fmtPrice(shown.price, currency)}</strong>
				<span>{shown.today ? 'Hoy' : 'Revisión'} del {date(shown.date)}</span>
				{#if hover > 0}<span class="muted">{shown.price >= first ? '+' : ''}{pct((shown.price - first) / first)} desde el {date(points[0].date)}</span>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.spark {
		display: block;
		overflow: visible;
	}
	.spark path,
	.line {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.5;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.line {
		stroke-width: 2;
	}
	.end {
		fill: var(--accent);
		stroke: var(--bg);
		stroke-width: 1.5;
	}
	.end.today {
		fill: var(--bg);
		stroke: var(--accent);
		stroke-width: 2;
	}
	.end.sube,
	.end.sube.today {
		fill: var(--up-fg);
		stroke: var(--bg);
	}
	.end.baja,
	.end.baja.today {
		fill: var(--down-fg);
		stroke: var(--bg);
	}
	.end.sube-fuerte {
		fill: var(--up-strong);
		stroke: var(--bg);
	}
	.end.baja-fuerte {
		fill: var(--down-strong);
		stroke: var(--bg);
	}
	.chart {
		position: relative;
		width: 100%;
	}
	.chart svg {
		display: block;
		touch-action: pan-y;
	}
	.buy {
		stroke: var(--buy);
		stroke-width: 1.5;
		stroke-dasharray: 3 2;
	}
	.spark .buy {
		stroke-width: 1;
		stroke-dasharray: none;
	}
	.buy-label {
		fill: var(--buy);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.year {
		stroke: var(--line);
		stroke-width: 1;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}
	.target {
		stroke: var(--muted);
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}
	.axis {
		fill: var(--muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.cross {
		stroke: var(--muted);
		stroke-width: 1;
	}
	.dot {
		fill: var(--accent);
		stroke: var(--bg);
		stroke-width: 2;
	}
	.tip {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: grid;
		gap: 0.1rem;
		padding: 0.3rem 0.5rem;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 6px;
		box-shadow: 0 2px 6px rgb(0 0 0 / 0.12);
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
		text-align: left;
	}
	.muted {
		color: var(--muted);
	}
</style>

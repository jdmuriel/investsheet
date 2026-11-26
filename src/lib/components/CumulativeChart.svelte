<script lang="ts">
	import { MONTH_SHORT } from '#lib/engine/dividends.ts';
	import { eurWhole } from '#lib/format.ts';

	/**
	 * Acumulado anual de dividendos mes a mes, una línea por año: el elegido resaltado, el anterior
	 * en gris oscuro y el resto tenues, para ver de un vistazo si se va por delante o por detrás.
	 */
	let { lines, year }: { lines: { year: number; points: number[] }[]; year: number } = $props();

	let width = $state(640);
	const height = 260;
	const pad = { l: 56, r: 44, t: 12, b: 24 };
	const max = $derived(Math.max(1, ...lines.flatMap((l) => l.points)));
	/** Marcas del eje vertical en valores redondos (1, 2 o 5 por potencia de diez), en céntimos. */
	const ticks = $derived.by(() => {
		const raw = max / 4;
		const p = 10 ** Math.floor(Math.log10(raw));
		const step = [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? p * 10;
		const out = [];
		for (let v = 0; v <= max; v += step) out.push(v);
		return out;
	});
	const x = (i: number) => pad.l + (i / 11) * (width - pad.l - pad.r);
	const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
	const path = (points: number[]) => points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
	// Primero los tenues, para que el año elegido y el anterior queden encima.
	const ordered = $derived([...lines].sort((a, b) => rank(a.year) - rank(b.year)));
	function rank(y: number) {
		return y === year ? 2 : y === year - 1 ? 1 : 0;
	}
	let hover = $state<number | null>(null);
	const current = $derived(lines.find((l) => l.year === year));
	const previous = $derived(lines.find((l) => l.year === year - 1));
	function move(e: PointerEvent) {
		const box = (e.currentTarget as SVGElement).getBoundingClientRect();
		const i = Math.round(((e.clientX - box.left - pad.l) / (width - pad.l - pad.r)) * 11);
		hover = i >= 0 && i <= 11 ? i : null;
	}
</script>

<div class="chart" bind:clientWidth={width}>
	<svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label="Acumulado anual de dividendos por meses" onpointermove={move} onpointerleave={() => (hover = null)}>
		{#each ticks as v (v)}
			<line class="grid" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
			<text class="axis" x={pad.l - 6} y={y(v)} text-anchor="end" dominant-baseline="middle">{eurWhole(v)}</text>
		{/each}
		{#each MONTH_SHORT as m, i (m)}<text class="axis" x={x(i)} y={height - 6} text-anchor="middle">{m}</text>{/each}
		{#each ordered as l (l.year)}
			{#if l.points.length}
				<path class="line r{rank(l.year)}" d={path(l.points)}><title>{l.year}: {eurWhole(l.points.at(-1))} €</title></path>
				{#if rank(l.year) > 0}<text class="end r{rank(l.year)}" x={x(l.points.length - 1) + 6} y={y(l.points.at(-1)!)} dominant-baseline="middle">{l.year}</text>{/if}
			{/if}
		{/each}
		{#if hover != null}
			<line class="cross" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
			{#if current && current.points[hover] != null}<circle class="dot" cx={x(hover)} cy={y(current.points[hover])} r="4" />{/if}
		{/if}
	</svg>
	{#if hover != null}
		<div class="tip" style:left="{Math.min(Math.max(x(hover), 80), width - 80)}px">
			<strong>{MONTH_SHORT[hover]}</strong>
			{#if current?.points[hover] != null}<span>{year}: {eurWhole(current.points[hover])} €</span>{/if}
			{#if previous?.points[hover] != null}<span class="muted">{year - 1}: {eurWhole(previous.points[hover])} €</span>{/if}
		</div>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		max-width: 56rem;
	}
	svg {
		display: block;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--line);
	}
	.axis {
		font-size: 11px;
		fill: var(--muted);
	}
	.line {
		fill: none;
		stroke: var(--muted);
		stroke-width: 1.5;
		opacity: 0.3;
	}
	.line.r1 {
		stroke-width: 2;
		opacity: 1;
	}
	.line.r2 {
		stroke: var(--accent);
		stroke-width: 3;
		opacity: 1;
	}
	.end {
		font-size: 11px;
		fill: var(--muted);
	}
	.end.r2 {
		fill: var(--accent);
		font-weight: 600;
	}
	.cross {
		stroke: var(--muted);
		stroke-dasharray: 3 3;
	}
	.dot {
		fill: var(--accent);
	}
	.tip {
		position: absolute;
		top: 0;
		transform: translateX(-50%);
		display: grid;
		gap: 0.1rem;
		padding: 0.3rem 0.5rem;
		font-size: 12px;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 4px;
		pointer-events: none;
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--muted);
	}
</style>

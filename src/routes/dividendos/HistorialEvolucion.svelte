<script lang="ts">
	import { page } from '$app/state';
	import CumulativeChart from '#lib/components/CumulativeChart.svelte';
	import { MONTH_NAMES } from '#lib/engine/dividends.ts';
	import { date, eur, pct } from '#lib/format.ts';
	import { link } from './link.ts';
	import type { PageData } from './$types';

	/** Evolución mensual de un año: cobrado, acumulado y comparación con el año anterior (columnas BL a BQ de `Control cartera`). */
	let { data }: { data: Extract<PageData, { view: 'evolucion' }> } = $props();
	const e = $derived(data.evolution);
	const prev = $derived(data.year - 1);
	const maxYear = $derived(Math.max(1, ...data.yearTotals.map((y) => y.amount)));
	const monthName = (m: string) => MONTH_NAMES[Number(m.slice(5, 7)) - 1];
	const change = (v: number | null) => (v == null ? '' : `${v > 0 ? '+' : ''}${pct(v)}`);
	const signed = (v: number) => `${v > 0 ? '+' : ''}${eur(v)} €`;
</script>

<form method="GET" class="filters">
	<input type="hidden" name="cartera" value={data.portfolioId} />
	<input type="hidden" name="vista" value="historial" />
	<input type="hidden" name="ver" value="evolucion" />
	<label>
		Año
		<select name="anio" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
			{#each data.years as y (y)}<option value={y} selected={y === data.year}>{y}</option>{/each}
		</select>
	</label>
</form>

<div class="summary">
	<div>
		<span class="muted">Cobrado en {data.year}</span>
		<strong>{eur(e.total)} €</strong>
	</div>
	{#if e.prevTotal}
		<div>
			<span class="muted">Total de {prev}</span>
			<strong>{eur(e.prevTotal)} €</strong>
			<span class:neg={e.total < e.prevTotal}>{pct(e.total / e.prevTotal)} · {signed(e.total - e.prevTotal)}</span>
		</div>
		{#if e.prevToDate != null}
			<div>
				<span class="muted">{prev} a la misma fecha</span>
				<strong>{eur(e.prevToDate)} €</strong>
				{#if e.prevToDate}<span class:neg={e.total < e.prevToDate}>{change((e.total - e.prevToDate) / e.prevToDate)}</span>{/if}
			</div>
		{/if}
	{/if}
</div>
{#if e.prevTotal}
	<p>
		{#if e.reachedOn}
			Se superan los dividendos de {prev} el <strong>{date(e.reachedOn)}</strong>.
		{:else if e.prevToDate != null}
			Faltan {eur(e.prevTotal - e.total)} € para igualar {prev}.
			{#if e.forecastMonth}Con el calendario previsto, se superarán en {monthName(e.forecastMonth)}.{:else}Con el calendario previsto, no se alcanzarán este año.{/if}
		{:else}
			No se llegó a los dividendos de {prev}.
		{/if}
	</p>
{/if}

<CumulativeChart lines={data.lines} year={data.year} />

<h2>{data.year} mes a mes</h2>
<div class="scroll">
	<table>
		<thead>
			<tr>
				<th class="l">Mes</th>
				<th>Cobrado</th>
				<th>{prev}</th>
				<th>Variación</th>
				<th>Acumulado</th>
				<th>Acumulado {prev}</th>
				<th>Variación</th>
				<th>Diferencia</th>
			</tr>
		</thead>
		<tbody>
			{#each e.months as m (m.month)}
				<tr class:none={m.future}>
					<td class="l"><a href={link(page.url, { ver: 'mes', mes: m.month, anio: null })} title="Comparar {monthName(m.month)} valor a valor">{monthName(m.month)}</a></td>
					<td>{m.future ? '' : eur(m.amount, true)}</td>
					<td>{eur(m.prevAmount, true)}</td>
					<td class:neg={(m.change ?? 0) < 0}>{change(m.change)}</td>
					<td>{m.future ? '' : eur(m.cumulative)}</td>
					<td>{eur(m.prevCumulative)}</td>
					<td class:neg={(m.cumChange ?? 0) < 0}>{change(m.cumChange)}</td>
					<td class:neg={m.cumulative < m.prevCumulative}>{m.future ? '' : signed(m.cumulative - m.prevCumulative)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<h2>Por años</h2>
<div class="scroll narrow">
	<table>
		<thead>
			<tr>
				<th class="l">Año</th>
				<th>Total</th>
				<th>Variación</th>
				<th class="l bar-col"></th>
			</tr>
		</thead>
		<tbody>
			{#each data.yearTotals as y (y.year)}
				<tr class:sel={y.year === data.year}>
					<td class="l"><a href={link(page.url, { anio: y.year })}>{y.year}</a></td>
					<td>{eur(y.amount)}</td>
					<td class:neg={(y.change ?? 0) < 0}>{change(y.change)}</td>
					<td class="l bar-col"><span class="bar" style:width="{(y.amount / maxYear) * 100}%"></span></td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="muted">Importes {data.measure === 'neto' ? 'netos' : 'brutos'} en €: dividendos, ventas de derechos y devoluciones de prima, por fecha de abono. Pulsa un mes para compararlo valor a valor.</p>

<style>
	.summary {
		display: flex;
		gap: 0.5rem 2rem;
		flex-wrap: wrap;
		margin: 0.25rem 0 0.5rem;
	}
	.summary div {
		display: grid;
		gap: 0.1rem;
	}
	.summary strong {
		font-size: 1.15rem;
		font-variant-numeric: tabular-nums;
	}
	.narrow {
		max-width: 40rem;
	}
	.bar-col {
		width: 50%;
	}
	.bar {
		display: block;
		height: 0.7rem;
		background: var(--accent);
		border-radius: 2px;
		opacity: 0.7;
	}
	tr.sel td {
		font-weight: 600;
	}
</style>

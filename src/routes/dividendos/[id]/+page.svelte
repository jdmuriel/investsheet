<script lang="ts">
	import { annualDividend, changeEffect, MONTH_NAMES, MONTH_SHORT } from '#lib/engine/dividends.ts';
	import { parseDecimal } from '#lib/engine/form.ts';
	import { date, eur, num, pct, price } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const typedNumber = (n: number) => (n ? String(n).replace('.', ',') : '');
	// svelte-ignore state_referenced_locally
	let months = $state(Array.from({ length: 12 }, (_, i) => form?.raw?.[`m${i + 1}`] ?? typedNumber(data.schedule?.months[i] ?? 0)));
	// svelte-ignore state_referenced_locally
	let isChange = $state(form?.raw ? form.raw.change === '1' : data.schedule != null);
	// svelte-ignore state_referenced_locally
	let currency = $state(form?.raw?.currency ?? data.currency);
	// svelte-ignore state_referenced_locally
	let fxText = $state(form?.raw?.fxRate ?? '');

	const oldAnnual = $derived(data.schedule ? annualDividend(data.schedule.months) : 0);
	const newAnnual = $derived(annualDividend(months.map((m) => parseDecimal(m) ?? 0).map((n) => (Number.isFinite(n) ? n : 0))));
	const fxRate = $derived(currency === 'EUR' ? 1 : (parseDecimal(fxText) ?? data.fx?.rate ?? null));
	const effect = $derived(fxRate && Number.isFinite(fxRate) ? changeEffect(oldAnnual, newAnnual, fxRate, data.shares) : null);
</script>

<header class="page">
	<h1>Dividendo de {data.security.ticker}</h1>
	{#if data.security.name}<span class="muted">{data.security.name}</span>{/if}
	<a href="/dividendos">Volver a Dividendos</a>
</header>

{#if form?.errors}
	<ul class="errors">
		{#each form.errors as e (e)}<li>{e}</li>{/each}
	</ul>
{/if}

<form method="POST">
	<div class="grid">
		<label>
			En vigor desde
			<input type="date" name="date" value={form?.raw?.date ?? data.today} required />
		</label>
		<label>
			Moneda del dividendo
			<select name="currency" bind:value={currency}>
				{#each data.currencies as c (c)}<option>{c}</option>{/each}
			</select>
		</label>
	</div>

	<fieldset>
		<legend>Importe por acción de cada mes, en {currency}</legend>
		<div class="months">
			{#each MONTH_NAMES as name, i (name)}
				<label>
					{name}
					<input name="m{i + 1}" bind:value={months[i]} inputmode="decimal" autocomplete="off" size="8" />
				</label>
			{/each}
		</div>
	</fieldset>

	<p class="summary">
		Dividendo anual por acción: <strong>{price(newAnnual)} {currency}</strong>
		{#if data.schedule}
			(antes {price(oldAnnual)} {currency}{#if effect?.pct != null && newAnnual !== oldAnnual}, {effect.pct > 0 ? '+' : ''}{pct(effect.pct)}{/if}).
		{/if}
		{#if effect && data.shares > 0 && newAnnual !== oldAnnual}
			Con {num(data.shares)} acciones, el ingreso anual pasa de {eur(Math.round(effect.beforeEur * 100))} a {eur(Math.round(effect.afterEur * 100))} EUR.
		{/if}
	</p>

	<label class="check">
		<input type="checkbox" name="change" value="1" bind:checked={isChange} />
		Es un cambio de dividendo: dejar constancia en la lista de cambios
	</label>
	{#if !isChange}
		<p class="muted">Sin marcar es una corrección o el primer calendario: se guarda sin anotar ningún cambio.</p>
	{:else}
		<div class="grid">
			{#if currency !== 'EUR'}
				<label>
					Tipo de cambio ({currency} por EUR)
					<input name="fxRate" bind:value={fxText} inputmode="decimal" autocomplete="off" placeholder={data.fx ? String(data.fx.rate).replace('.', ',') : ''} />
					<small>{data.fx ? `En blanco se usa el de la fecha (último conocido: ${date(data.fx.date)})` : 'No hay ninguno guardado: tecléalo'}</small>
				</label>
			{/if}
			<label class="wide">
				Enlace a la fuente (opcional)
				<input name="url" type="url" value={form?.raw?.url ?? ''} placeholder="https://…" />
			</label>
			<label class="wide">
				Nota (opcional)
				<input name="note" value={form?.raw?.note ?? ''} />
			</label>
		</div>
	{/if}
	<p><button>Guardar</button></p>
</form>

{#if data.changes.length}
	<h2>Cambios anotados</h2>
	<ul class="plain">
		{#each data.changes as c (c.id)}
			<li>{date(c.date)}: de {price(c.oldAnnual)} a {price(c.newAnnual)} {c.currency}{#if c.oldAnnual > 0}&nbsp;({c.newAnnual > c.oldAnnual ? '+' : ''}{pct(c.newAnnual / c.oldAnnual - 1)}){/if}</li>
		{/each}
	</ul>
{/if}

{#if data.versions.length}
	<h2>Versiones del calendario</h2>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="l">Desde</th>
					<th class="l">Moneda</th>
					{#each MONTH_SHORT as m (m)}<th>{m}</th>{/each}
					<th>Anual</th>
				</tr>
			</thead>
			<tbody>
				{#each data.versions as v (v.validFrom)}
					<tr>
						<td class="l">{date(v.validFrom)}</td>
						<td class="l">{v.currency}</td>
						{#each v.months as m, i (i)}<td>{m ? price(m) : ''}</td>{/each}
						<td>{price(annualDividend(v.months))}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.page {
		display: flex;
		gap: 0.3rem 1rem;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 1.5rem 0 0.4rem;
	}
	form {
		max-width: 46rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.6rem 1rem;
		margin-bottom: 0.8rem;
	}
	.wide {
		grid-column: span 2;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
	}
	label.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: inherit;
		color: inherit;
		margin: 0.6rem 0;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: 6px;
		margin: 0 0 0.6rem;
	}
	legend {
		font-size: 12px;
		color: var(--muted);
	}
	.months {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
		gap: 0.5rem 0.8rem;
	}
	.months input {
		text-align: right;
	}
	input,
	select,
	button {
		font: inherit;
		padding: 0.3rem 0.45rem;
	}
	input:not([type='checkbox']),
	select {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
		min-width: 0;
	}
	.summary {
		margin: 0.4rem 0;
	}
	.muted,
	small {
		color: var(--muted);
	}
	.errors {
		color: var(--neg);
	}
	.plain {
		padding-left: 1.1rem;
		margin: 0;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.25rem 0.5rem;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-size: 12px;
		color: var(--muted);
	}
	.l {
		text-align: left;
	}
</style>

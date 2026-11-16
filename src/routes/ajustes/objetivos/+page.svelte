<script lang="ts">
	import { eur, typed } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Valor del campo: lo tecleado si el envío se rechazó, o lo guardado. */
	const value = (key: string, goal: number | null) => form?.raw?.[key] ?? (goal == null ? '' : typed(goal));
</script>

<header class="page">
	<h1>Objetivos anuales</h1>
	<span class="muted">{data.portfolios.find((p) => p.id === data.portfolioId)?.name}</span>
	<form method="GET">
		<input type="hidden" name="cartera" value={data.portfolioId} />
		<label>
			Año
			<select name="anio" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each data.years as y (y)}<option selected={y === data.year}>{y}</option>{/each}
			</select>
		</label>
	</form>
	<a href="/ajustes">Volver a Ajustes</a>
</header>

{#if form?.errors}
	<ul class="errors">
		{#each form.errors as e (e)}<li>{e}</li>{/each}
	</ul>
{:else if form?.saved}
	<p class="ok">Objetivos de {data.year} guardados.</p>
{/if}

<p class="note">Importes en EUR. Una métrica en blanco se queda sin objetivo y no aparece en el listado de movimientos. El de gastos es un tope: lo deseable es no alcanzarlo.</p>

<form method="POST" action="?/guardar&cartera={data.portfolioId}&anio={data.year}">
	<input type="hidden" name="year" value={data.year} />
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th>Métrica</th>
					<th>Objetivo de {data.year}</th>
					<th class="r">Conseguido en {data.year}</th>
					<th class="r">Conseguido en {data.year - 1}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.metrics as m (m.key)}
					<tr>
						<td>{m.label}</td>
						<td><input name={m.key} value={value(m.key, m.goal)} inputmode="decimal" size="12" aria-label="Objetivo de {m.label}" /></td>
						<td class="r">{eur(m.actual)}</td>
						<td class="r">{eur(m.previous)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p><button>Guardar objetivos</button></p>
</form>

<style>
	.page {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	.muted,
	label {
		color: var(--muted);
	}
	.note {
		max-width: 50rem;
		color: var(--muted);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0.3rem 0.5rem;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-size: 12px;
		color: var(--muted);
	}
	.r {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	input,
	select,
	button {
		font: inherit;
		padding: 0.25rem 0.4rem;
	}
	input,
	select {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	input {
		text-align: right;
	}
	.errors {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>

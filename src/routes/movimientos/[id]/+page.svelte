<script lang="ts">
	import OperationForm from '#lib/components/OperationForm.svelte';
	import { date } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const saveResult = $derived(form?.raw ? { errors: form.errors, warnings: form.warnings, raw: form.raw } : null);
	const deleteResult = $derived(form?.deleting ? { errors: form.errors, warnings: form.warnings } : null);
	const moveResult = $derived(form?.moving ? { errors: form.errors } : null);
	const position = $derived(data.day.findIndex((o) => o.id === data.record.id));
</script>

<header class="page">
	<h1>Editar movimiento</h1>
	<span class="muted">{data.portfolio.name} · {date(data.record.date)}</span>
	<a href="/movimientos?cartera={data.portfolioId}&anio={data.record.date.slice(0, 4)}&op={data.record.id}">Volver al listado</a>
</header>

<OperationForm
	accounts={data.accounts}
	securities={data.securities}
	holdings={data.holdings}
	balances={data.balances}
	initial={data.initial}
	rejected={saveResult}
	imported={data.record.imported}
	supported={data.record.supported}
	action="?/guardar"
/>

{#if data.day.length > 1}
	<section>
		<h2>Orden dentro del día</h2>
		{#if moveResult}
			<p class="neg">No se puede mover: {moveResult.errors.join(' ')}</p>
		{/if}
		<ol>
			{#each data.day as o (o.id)}
				<li class:current={o.id === data.record.id}>
					{#if o.id === data.record.id}{o.description}{:else}<a href="/movimientos/{o.id}">{o.description}</a>{/if}
				</li>
			{/each}
		</ol>
		<form method="POST" action="?/mover" class="buttons">
			<button name="direction" value="up" disabled={position <= 0}>↑ Subir</button>
			<button name="direction" value="down" disabled={position >= data.day.length - 1}>↓ Bajar</button>
		</form>
	</section>
{/if}

<section>
	<h2>Borrar</h2>
	{#if deleteResult}
		<ul class="neg">
			{#each [...deleteResult.errors, ...deleteResult.warnings] as m (m)}<li>{m}</li>{/each}
		</ul>
	{/if}
	<form
		method="POST"
		action="?/borrar"
		class="buttons"
		onsubmit={(e) => {
			if (!confirm('¿Borrar este movimiento? Queda una copia en el registro de auditoría.')) e.preventDefault();
		}}
	>
		{#if deleteResult && deleteResult.errors.length === 0}
			<label><input type="checkbox" name="confirm" value="1" required /> Borrar de todos modos</label>
		{/if}
		<button class="danger">Borrar el movimiento</button>
	</form>
</section>

<style>
	.page {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: baseline;
		margin-bottom: 1rem;
	}
	h1 {
		font-size: 1.2rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}
	section {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
		max-width: 46rem;
	}
	.muted {
		color: var(--muted);
	}
	ol {
		margin: 0 0 0.6rem;
		padding-left: 1.5rem;
	}
	li.current {
		font-weight: 600;
	}
	.buttons {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
	}
	button {
		font: inherit;
		padding: 0.4rem 0.9rem;
		border-radius: 4px;
		border: 1px solid var(--line);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
	}
	button:disabled {
		color: var(--muted);
		cursor: default;
	}
	button.danger {
		color: var(--neg);
		border-color: var(--neg);
	}
	.neg {
		color: var(--neg);
	}
	ul.neg {
		padding-left: 1.2rem;
	}
</style>

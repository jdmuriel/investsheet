<script lang="ts">
	import OperationEditor from '#lib/components/OperationEditor.svelte';
	import { date } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<header class="page">
	<h1>Editar movimiento</h1>
	<span class="muted">{data.portfolio.name} · {date(data.record.date)}</span>
	<a href="/movimientos?cartera={data.portfolioId}&op={data.record.id}">Volver al listado</a>
	{#if data.record.supported}<a href="/movimientos/nuevo?cartera={data.portfolioId}&copiar={data.record.id}">Duplicar con la fecha de hoy</a>{/if}
</header>

{#key data.record.id}
	<OperationEditor {data} {form} />
{/key}

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
	.muted {
		color: var(--muted);
	}
</style>

<script lang="ts">
	import OperationForm from '#lib/components/OperationForm.svelte';
	import { date, eur } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<header class="page">
	<h1>Nuevo movimiento</h1>
	<a href="/movimientos?cartera={data.portfolioId}">Volver al listado</a>
</header>

{#if data.saved && !form}
	<p class="saved">
		Guardado: <a href="/movimientos/{data.saved.id}">{data.saved.description}</a>.
		{#each data.accounts.filter((a) => data.saved?.accountIds.includes(a.id)) as a (a.id)}
			Saldo de {a.name}: {eur(data.balances[a.id])} {a.currency}.
		{/each}
	</p>
{/if}

{#if data.copied}
	<p class="saved">Copia de «{data.copied.description}» del {date(data.copied.date)}, con la fecha de hoy. Revisa los campos antes de guardar.</p>
{/if}

{#key `${data.saved?.id}-${data.copied?.id}`}
	<OperationForm accounts={data.accounts} securities={data.securities} holdings={data.holdings} balances={data.balances} initial={data.initial} rejected={form} action="?cartera={data.portfolioId}" allowAnother duplicate={data.copied != null} />
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
	.saved {
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--soft);
		max-width: 46rem;
		box-sizing: border-box;
	}
</style>

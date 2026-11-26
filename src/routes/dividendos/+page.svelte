<script lang="ts">
	import { page } from '$app/state';
	import { eur } from '#lib/format.ts';
	import Calendario from './Calendario.svelte';
	import Cambios from './Cambios.svelte';
	import Historial from './Historial.svelte';
	import { link } from './link.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const TABS = [
		['cambios', 'Cambios de dividendo'],
		['calendario', 'Calendario previsto'],
		['historial', 'Historial']
	] as const;
</script>

<div class="dividendos">
	<header class="page">
		<h1>Dividendos</h1>
		<span class="muted">PADI bruto {eur(data.padiGross)} € · neto {eur(data.padiNet)} €</span>
	</header>

	<nav class="tabs" aria-label="Solapas de dividendos">
		{#each TABS as [key, label] (key)}
			<!-- Al cambiar de solapa se quitan los parámetros de la anterior. -->
			<a href={link(page.url, { vista: key, anio: null, mes: null, valor: null, ver: null, medida: null })} class:on={data.tab === key} aria-current={data.tab === key ? 'page' : undefined}>{label}</a>
		{/each}
	</nav>

	{#if data.tab === 'cambios'}
		<Cambios {data} deleted={!!form?.deleted} />
	{:else if data.tab === 'calendario'}
		<Calendario {data} />
	{:else}
		<Historial {data} />
	{/if}
</div>

<style>
	.page {
		display: flex;
		gap: 0.5rem 1rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		border-bottom: 1px solid var(--line);
		margin: 0.75rem 0 0.75rem;
	}
	.tabs a {
		padding: 0.4rem 0.8rem;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		color: var(--muted);
		text-decoration: none;
		margin-bottom: -1px;
	}
	.tabs a.on {
		color: var(--fg);
		background: var(--bg);
		border-color: var(--line);
		font-weight: 600;
	}
	/* Estilos comunes de las solapas, que son componentes aparte. */
	.dividendos :global(h2) {
		font-size: 1rem;
		margin: 1.25rem 0 0.4rem;
	}
	.dividendos :global(.filters) {
		display: flex;
		gap: 0.5rem 1rem;
		align-items: end;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.dividendos :global(label) {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
	}
	.dividendos :global(select),
	.dividendos :global(input[type='month']) {
		font: inherit;
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	.dividendos :global(.scroll) {
		overflow: auto;
		max-height: 34rem;
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	.dividendos :global(table) {
		border-collapse: collapse;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	.dividendos :global(th),
	.dividendos :global(td) {
		padding: 0.25rem 0.5rem;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	.dividendos :global(thead th) {
		position: sticky;
		top: 0;
		background: var(--soft);
		font-size: 12px;
		color: var(--muted);
		z-index: 1;
	}
	.dividendos :global(tfoot td) {
		position: sticky;
		bottom: 0;
		background: var(--soft);
		font-weight: 600;
		border-bottom: none;
	}
	.dividendos :global(.l) {
		text-align: left;
	}
	.dividendos :global(.wrap) {
		white-space: normal;
		min-width: 18rem;
		max-width: 34rem;
	}
	.dividendos :global(tr.none td) {
		color: var(--muted);
	}
	.dividendos :global(.muted) {
		color: var(--muted);
	}
	.dividendos :global(.neg) {
		color: var(--neg);
	}
	.dividendos :global(.ok) {
		color: var(--accent);
	}
	.dividendos :global(.warning) {
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--neg);
		background: var(--soft);
		max-width: 60rem;
	}
	.dividendos :global(button.link) {
		font: inherit;
		background: none;
		border: none;
		padding: 0;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
	}
</style>

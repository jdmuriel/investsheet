<script lang="ts">
	import { page } from '$app/state';
	import HistorialEvolucion from './HistorialEvolucion.svelte';
	import HistorialMes from './HistorialMes.svelte';
	import HistorialTabla from './HistorialTabla.svelte';
	import HistorialValor from './HistorialValor.svelte';
	import { link } from './link.ts';
	import type { PageData } from './$types';

	/** Solapa «Historial»: dividendos cobrados por mes y año (RF-38) y explicación de las variaciones (RF-40). */
	let { data }: { data: Extract<PageData, { tab: 'historial' }> } = $props();
	const VIEWS = [
		['evolucion', 'Evolución'],
		['mes', 'Mes'],
		['valor', 'Valor'],
		['tabla', 'Tabla completa']
	] as const;
	// Lo cobrado por acción solo se ofrece en las vistas valor a valor.
	const measures = $derived(
		(
			[
				['bruto', 'Bruto'],
				['neto', 'Neto'],
				['dpa', 'Por acción']
			] as const
		).filter(([m]) => m !== 'dpa' || data.view === 'valor' || data.view === 'tabla')
	);
</script>

<div class="bar">
	<span role="group" aria-label="Vista del historial" class="seg">
		{#each VIEWS as [key, label] (key)}
			<a href={link(page.url, { ver: key })} class:on={data.view === key} aria-current={data.view === key ? 'page' : undefined}>{label}</a>
		{/each}
	</span>
	<span role="group" aria-label="Importe" class="seg">
		{#each measures as [key, label] (key)}
			<a href={link(page.url, { medida: key })} class:on={data.measure === key} aria-current={data.measure === key ? 'true' : undefined}>{label}</a>
		{/each}
	</span>
</div>

{#if !data.lastMonth}
	<p class="muted">Esta cartera aún no tiene dividendos cobrados.</p>
{:else if data.view === 'evolucion'}
	<HistorialEvolucion {data} />
{:else if data.view === 'mes'}
	<HistorialMes {data} />
{:else if data.view === 'valor'}
	<HistorialValor {data} />
{:else}
	<HistorialTabla {data} />
{/if}

<style>
	.bar {
		display: flex;
		gap: 0.5rem 1.5rem;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 0.75rem;
	}
	.seg {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 6px;
		overflow: hidden;
	}
	.seg a {
		padding: 0.25rem 0.7rem;
		color: var(--muted);
		text-decoration: none;
		font-size: 14px;
	}
	.seg a + a {
		border-left: 1px solid var(--line);
	}
	.seg a.on {
		background: var(--soft);
		color: var(--fg);
		font-weight: 600;
	}
</style>

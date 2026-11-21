<script lang="ts">
	import { page } from '$app/state';
	import SecurityForm from '#lib/components/SecurityForm.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const back = $derived(page.url.searchParams.get('volver'));
	const backLabel = $derived(back === '/seleccion' ? 'Volver a Selección' : back === '/' ? 'Volver a Cartera' : 'Volver a Valores');
</script>

<header class="page">
	<h1>{data.security ? data.security.ticker : 'Nuevo valor'}</h1>
	<a href={back ?? '/ajustes/valores'}>{backLabel}</a>
</header>

<SecurityForm security={data.security} currencies={data.currencies} zones={data.zones} tiers={data.tiers} action="/ajustes/valores/{data.security?.id ?? 'nuevo'}" {back} failed={form} />

<style>
	.page {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
</style>

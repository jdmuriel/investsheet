<script lang="ts">
	import { invalidateAll, preloadData } from '$app/navigation';
	import Dialog from './Dialog.svelte';
	import SecurityForm from './SecurityForm.svelte';

	// Edición de un valor en ventana emergente: carga los datos de su página (`/ajustes/valores/[id]`) y, al guardar,
	// cierra y vuelve a cargar la pantalla de debajo para que refleje el cambio.
	interface Props {
		/** Id o ticker del valor, o `nuevo`. */
		security: string | number;
		onclose: () => void;
		/** Tras guardar o borrar, con el destino que habría tenido la página (lleva `guardado=<id>`). */
		onsaved?: (location: string) => void;
	}
	let { security, onclose, onsaved }: Props = $props();
	const path = $derived(`/ajustes/valores/${encodeURIComponent(String(security))}`);

	let loaded = $state<Record<string, any> | null>(null);
	let problem = $state<string | null>(null);
	$effect(() => {
		preloadData(path).then((r) => {
			if (r.type === 'loaded' && r.status === 200) loaded = r.data;
			else problem = r.type === 'error' ? r.error.message : 'No se ha podido cargar el valor.';
		});
	});

	async function done(location: string) {
		await invalidateAll();
		onsaved?.(location);
		onclose();
	}
</script>

<Dialog title={loaded ? (loaded.security?.ticker ?? 'Nuevo valor') : 'Valor'} {onclose}>
	{#if problem}
		<p class="neg">{problem}</p>
	{:else if loaded}
		<SecurityForm security={loaded.security} currencies={loaded.currencies} zones={loaded.zones} tiers={loaded.tiers} action="/ajustes/valores/{loaded.security?.id ?? 'nuevo'}" ondone={done} />
	{:else}
		<p class="muted">Cargando…</p>
	{/if}
</Dialog>

<style>
	.neg {
		color: var(--neg);
	}
	.muted {
		color: var(--muted);
	}
</style>

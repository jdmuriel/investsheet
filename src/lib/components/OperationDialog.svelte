<script lang="ts">
	import { invalidateAll, preloadData } from '$app/navigation';
	import { date } from '#lib/format.ts';
	import Dialog from './Dialog.svelte';
	import OperationEditor from './OperationEditor.svelte';

	// Edición de un movimiento en ventana emergente, con los datos de su página (`/movimientos/[id]`).
	interface Props {
		id: number;
		onclose: () => void;
		/** Tras guardar (con el id guardado) o borrar; la pantalla de debajo debe recargarse. */
		ondone: (what: 'saved' | 'deleted', id: number) => void;
	}
	let { id: initialId, onclose, ondone }: Props = $props();
	// svelte-ignore state_referenced_locally
	let id = $state(initialId);

	let loaded = $state<Record<string, any> | null>(null);
	let problem = $state<string | null>(null);
	// `preloadData` guarda lo que carga: cada lectura lleva su propio parámetro para que traiga los datos de ahora.
	let reads = 0;
	async function load() {
		const r = await preloadData(`/movimientos/${id}?lectura=${Date.now()}-${++reads}`);
		if (r.type === 'loaded' && r.status === 200) loaded = r.data;
		else problem = r.type === 'error' ? r.error.message : 'No se ha podido cargar el movimiento.';
	}
	$effect(() => {
		void id;
		load();
	});
</script>

<Dialog title={loaded ? `Editar movimiento · ${date(loaded.record.date)}` : 'Editar movimiento'} {onclose} wide>
	{#if problem}
		<p class="neg">{problem}</p>
	{:else if loaded}
		{#if loaded.record.supported}
			<p class="links"><a href="/movimientos/nuevo?cartera={loaded.portfolioId}&copiar={loaded.record.id}">Duplicar con la fecha de hoy</a> <a href="/movimientos/{loaded.record.id}">Abrir en su página</a></p>
		{/if}
		{#key loaded.record.id}
			<OperationEditor
				data={loaded}
				ondone={(what) => ondone(what, loaded!.record.id)}
				onrefresh={async () => {
					await Promise.all([load(), invalidateAll()]);
				}}
				onopen={(other) => ((loaded = null), (id = other))}
			/>
		{/key}
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
	.links {
		display: flex;
		gap: 1rem;
		margin: 0 0 0.6rem;
		font-size: 12px;
	}
</style>

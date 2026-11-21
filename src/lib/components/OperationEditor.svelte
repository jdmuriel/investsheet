<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import OperationForm from './OperationForm.svelte';

	// Edición de un movimiento: formulario, orden dentro del día y borrado. Lo usan su página y `OperationDialog`.
	interface Props {
		/** Datos de la carga de `/movimientos/[id]`. */
		data: Record<string, any>;
		/** Respuesta de una acción rechazada (la de la página, si no hay `ondone`). */
		form?: Record<string, any> | null;
		/** En ventana emergente: tras guardar o borrar; tras mover dentro del día (hay que recargar); al pulsar otro del mismo día. */
		ondone?: (what: 'saved' | 'deleted', location: string) => void;
		onrefresh?: () => Promise<void>;
		onopen?: (id: number) => void;
	}
	let { data, form = null, ondone, onrefresh, onopen }: Props = $props();
	const base = $derived(`/movimientos/${data.record.id}`);

	// Sin `ondone` los formularios se envían como siempre; con él, la respuesta se trata aquí.
	let local = $state<Record<string, any> | null>(null);
	const result = $derived(ondone ? local : form);
	// svelte-ignore state_referenced_locally
	const submit: SubmitFunction | undefined = ondone
		? ({ action }) =>
				async ({ result: r }) => {
					if (r.type === 'failure') local = r.data ?? null;
					else if (r.type === 'redirect') ondone(action.search.includes('borrar') ? 'deleted' : 'saved', r.location);
					else if (r.type === 'success') {
						local = null;
						await onrefresh?.();
					} else if (r.type === 'error') local = { errors: [r.error.message], warnings: [] };
				}
		: undefined;
	const enhanceIf = (node: HTMLFormElement, fn: SubmitFunction | undefined) => (fn ? enhance(node, fn) : undefined);
	function open(e: MouseEvent, id: number) {
		if (!onopen || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		onopen(id);
	}

	const saveResult = $derived(result?.raw ? { errors: result.errors, warnings: result.warnings, raw: result.raw } : null);
	const deleteResult = $derived(result?.deleting ? { errors: result.errors as string[], warnings: result.warnings as string[] } : null);
	const moveResult = $derived(result?.moving ? { errors: result.errors as string[] } : null);
	const position = $derived((data.day as { id: number }[]).findIndex((o) => o.id === data.record.id));
</script>

<OperationForm
	accounts={data.accounts}
	securities={data.securities}
	holdings={data.holdings}
	balances={data.balances}
	initial={data.initial}
	rejected={saveResult}
	imported={data.record.imported}
	supported={data.record.supported}
	action="{base}?/guardar"
	{submit}
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
					{#if o.id === data.record.id}{o.description}{:else}<a href="/movimientos/{o.id}" onclick={(e) => open(e, o.id)}>{o.description}</a>{/if}
				</li>
			{/each}
		</ol>
		<form method="POST" action="{base}?/mover" class="buttons" use:enhanceIf={submit}>
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
		action="{base}?/borrar"
		class="buttons"
		use:enhanceIf={submit}
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

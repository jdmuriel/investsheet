<script lang="ts">
	import type { Snippet } from 'svelte';

	// Ventana emergente modal: se abre al montarse y avisa con `onclose` al cerrarse (✕, Esc o pulsando fuera).
	// `wide` para formularios grandes; `fit` para contenidos pequeños, que fijan su propio ancho.
	let { title, onclose, wide = false, fit = false, children }: { title: string; onclose: () => void; wide?: boolean; fit?: boolean; children: Snippet } = $props();
	let dialog: HTMLDialogElement | undefined = $state();
	$effect(() => {
		dialog?.showModal();
	});
</script>

<dialog bind:this={dialog} class:wide class:fit {onclose} onclick={(e) => e.target === dialog && dialog.close()}>
	<header>
		<h2>{title}</h2>
		<button type="button" class="close" aria-label="Cerrar" onclick={() => dialog?.close()}>✕</button>
	</header>
	<div class="body">{@render children()}</div>
</dialog>

<style>
	dialog {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--bg);
		color: var(--fg);
		width: min(52rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		box-shadow: 0 8px 30px rgb(0 0 0 / 0.25);
	}
	dialog.wide {
		width: min(64rem, calc(100vw - 2rem));
	}
	dialog.fit {
		width: auto;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.35);
	}
	header {
		position: sticky;
		top: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--soft);
	}
	h2 {
		font-size: 1.1rem;
		margin: 0;
	}
	.close {
		font: inherit;
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
		font-size: 1.1rem;
	}
	.body {
		padding: 0.8rem 1rem 1rem;
	}
</style>

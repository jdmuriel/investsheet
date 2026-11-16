<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Inversión</title>
</svelte:head>

<header class="app">
	<strong>Inversión</strong>
	<nav><a href="/movimientos">Movimientos</a> <a href="/conciliacion">Conciliación</a> <a href="/ajustes">Ajustes</a></nav>
	<form method="POST" action="/auth/logout"><button>Salir</button></form>
</header>
<main>{@render children()}</main>

<style>
	:global(:root) {
		--bg: #fff;
		--fg: #1c2024;
		--muted: #60646c;
		--line: #e0e3e8;
		--soft: #f4f6f8;
		--accent: #0b6bcb;
		--neg: #c62828;
		color-scheme: light dark;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg: #111418;
			--fg: #e6e8eb;
			--muted: #9aa1ab;
			--line: #2a2f37;
			--soft: #1a1e24;
			--accent: #6cb2ff;
			--neg: #ff8a80;
		}
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--fg);
		font: 14px/1.4 system-ui, sans-serif;
	}
	:global(a) {
		color: var(--accent);
	}
	header.app {
		display: flex;
		gap: 0.4rem 1.5rem;
		flex-wrap: wrap;
		align-items: baseline;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--line);
	}
	nav {
		display: flex;
		gap: 1rem;
		flex: 1;
	}
	header.app button {
		font: inherit;
		background: none;
		border: 1px solid var(--line);
		border-radius: 4px;
		color: var(--muted);
		cursor: pointer;
	}
	main {
		padding: 1rem;
	}
</style>

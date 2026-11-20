<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// Al cambiar de cartera se sigue en la misma pantalla, salvo en la ficha de una operación, que es de la cartera anterior.
	const target = $derived(/^\/movimientos\/\d+/.test(page.url.pathname) ? '/movimientos' : page.url.pathname);
	const kept = $derived(['periodo', 'fecha', 'anio'].filter((key) => page.url.searchParams.has(key)).map((key) => [key, page.url.searchParams.get(key)!]));
</script>

<svelte:head>
	<title>Inversión</title>
</svelte:head>

<header class="app">
	<strong>Inversión</strong>
	<nav><a href="/">Cartera</a> <a href="/movimientos">Movimientos</a> <a href="/dividendos">Dividendos</a> <a href="/seleccion">Selección</a> <a href="/conciliacion">Conciliación</a> <a href="/ajustes">Ajustes</a></nav>
	{#if data.portfolios.length > 1}
		<form method="GET" action={target} class="portfolio">
			{#each kept as [key, value] (key)}<input type="hidden" name={key} {value} />{/each}
			<label>
				Cartera
				<select name="cartera" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
					{#each data.portfolios as p (p.id)}
						<option value={p.id} selected={p.id === data.portfolioId}>{p.name}</option>
					{/each}
				</select>
			</label>
		</form>
	{:else if data.portfolios.length === 1}
		<span class="portfolio">{data.portfolios[0].name}</span>
	{/if}
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
		/* Subidas y bajadas: claro para lo reseñable, oscuro para lo grande. */
		--up-fg: #1d6b34;
		--up-soft: #dcf2e2;
		--up-strong: #2e7d32;
		--down-fg: #a3221a;
		--down-soft: #fde2df;
		--down-strong: #c62828;
		--on-strong: #fff;
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
			--up-fg: #8fdca5;
			--up-soft: #17331f;
			--up-strong: #23753a;
			--down-fg: #ffb4ab;
			--down-soft: #42201d;
			--down-strong: #b3261e;
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
		gap: 0.2rem 1rem;
		flex: 1;
		flex-wrap: wrap;
	}
	.portfolio label {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		font-size: 12px;
		color: var(--muted);
	}
	.portfolio select {
		font: inherit;
		font-weight: 600;
		padding: 0.15rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
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

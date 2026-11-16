<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let search = $state('');
	let onlyActive = $state(false);
	const pct = (fraction: number | null) => (fraction == null ? '' : `${Math.round(fraction * 1e4) / 100} %`.replace('.', ','));
	const visible = $derived(
		data.securities.filter((s) => {
			if (onlyActive && !s.active) return false;
			const q = search.trim().toLowerCase();
			return !q || [s.ticker, s.name, s.priceTicker, s.sector, s.country].some((v) => (v ?? '').toLowerCase().includes(q));
		})
	);
</script>

<header class="page">
	<h1>Valores</h1>
	<input type="search" bind:value={search} placeholder="ticker, nombre, sector o país" aria-label="Buscar" />
	<label class="check"><input type="checkbox" bind:checked={onlyActive} /> Solo activos</label>
	<span class="count">{visible.length} de {data.securities.length}</span>
	<a class="new" href="/ajustes/valores/nuevo">Nuevo valor</a>
	<a href="/ajustes">Volver a Ajustes</a>
</header>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th>Ticker</th>
				<th>Nombre</th>
				<th>Ticker de precios</th>
				<th>País</th>
				<th>Moneda</th>
				<th>Sector</th>
				<th>Supersector</th>
				<th>Zona</th>
				<th><i>Tier</i></th>
				<th class="r">Ret. origen</th>
				<th class="r">Ret. destino</th>
				<th>Reinvertir</th>
				<th>Activo</th>
				<th class="r">Usos</th>
			</tr>
		</thead>
		<tbody>
			{#each visible as s (s.id)}
				<tr class:inactive={!s.active} class:saved={s.id === data.savedId}>
					<td><a href="/ajustes/valores/{s.id}">{s.ticker}</a></td>
					<td>{s.name ?? ''}</td>
					<td>{s.priceTicker ?? ''}</td>
					<td>{s.country ?? ''}</td>
					<td>{s.currency ?? ''}</td>
					<td>{s.sector ?? ''}</td>
					<td>{s.supersector ?? ''}</td>
					<td>{s.zone ?? ''}</td>
					<td>{s.tier ?? ''}</td>
					<td class="r">{pct(s.whtSourcePct)}</td>
					<td class="r">{pct(s.whtDestPct)}</td>
					<td>{s.reinvest ? 'sí' : 'no'}</td>
					<td>{s.active ? 'sí' : 'no'}</td>
					<td class="r">{s.uses}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.page {
		display: flex;
		gap: 0.75rem 1rem;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	input[type='search'] {
		font: inherit;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
		flex: 0 1 16rem;
	}
	.count {
		color: var(--muted);
		font-size: 12px;
	}
	.new {
		padding: 0.3rem 0.8rem;
		border-radius: 4px;
		background: var(--accent);
		color: var(--bg);
		font-weight: 600;
		text-decoration: none;
	}
	.scroll {
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: 6px;
		max-height: calc(100vh - 9rem);
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		padding: 0.25rem 0.5rem;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		position: sticky;
		top: 0;
		background: var(--soft);
		font-size: 12px;
	}
	.r {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tr.inactive td {
		color: var(--muted);
	}
	tr.saved td {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
</style>

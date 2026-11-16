<script lang="ts">
	import { date, eur, num } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let search = $state('');
	let type = $state('');

	const types = $derived([...new Set(data.rows.map((r) => r.type))].sort());
	const visible = $derived(
		data.rows.filter((r) => {
			if (type && r.type !== type) return false;
			if (!search) return true;
			const q = search.toLowerCase();
			return r.description.toLowerCase().includes(q) || (r.ticker ?? '').toLowerCase().includes(q) || (r.account ?? '').toLowerCase().includes(q);
		})
	);
	const current = $derived(data.years.find((y) => y.year === data.year));

	$effect(() => {
		if (data.saved) document.getElementById(`op-${data.saved.id}`)?.scrollIntoView({ block: 'center' });
	});
</script>

<form method="GET" class="filters">
	<label>
		Cartera
		<select name="cartera" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
			{#each data.portfolios as p (p.id)}
				<option value={p.id} selected={p.id === data.portfolioId}>{p.name}</option>
			{/each}
		</select>
	</label>
	<label>
		Periodo
		<select name="periodo" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
			{#each [['ultimos', 'Últimos movimientos'], ['mes', 'Mes en curso'], ['trimestre', 'Trimestre en curso'], ['actual', 'Año en curso']] as [key, label] (key)}
				<option value={key} selected={key === data.period}>{label}</option>
			{/each}
			{#each data.pastYears as y (y)}
				<option value={y} selected={String(y) === data.period}>{y}</option>
			{/each}
			<option value="todos" selected={data.period === 'todos'}>Todos</option>
		</select>
	</label>
	<label>
		Tipo
		<select bind:value={type}>
			<option value="">Todos</option>
			{#each types as t (t)}
				<option>{t}</option>
			{/each}
		</select>
	</label>
	<label class="grow">
		Buscar
		<input type="search" bind:value={search} placeholder="descripción, valor o cuenta" />
	</label>
	<span class="count">{visible.length} de {data.rows.length} movimientos</span>
	<a class="new" href="/movimientos/nuevo?cartera={data.portfolioId}">Nuevo movimiento</a>
</form>

{#if data.saved}
	<p class="saved">
		Guardado: {data.saved.description}.
		{#each data.saved.balances as b (b.name)}
			Saldo de {b.name} tras la operación: <strong class:neg={b.amount < 0}>{eur(b.amount)} {b.currency}</strong>.
		{/each}
	</p>
{/if}

{#if data.warnings > 0}
	<p class="warning">El motor ha emitido {data.warnings} avisos al recalcular esta cartera.</p>
{/if}

<details class="metrics" open>
	<summary>Métricas anuales</summary>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th>Año</th>
					<th>Aumento de capital</th>
					<th>Ingresos brutos</th>
					<th>Gastos</th>
					<th>Rendimiento bruto</th>
					<th>Rendimiento neto</th>
					<th>Compras netas</th>
					<th>Plusvalías realizadas</th>
				</tr>
			</thead>
			<tbody>
				{#each data.years as y (y.year)}
					<tr class:current={y === current}>
						<td>{y.year}</td>
						<td>{eur(y.capital)}</td>
						<td>{eur(y.gross)}</td>
						<td>{eur(y.fees)}</td>
						<td>{eur(y.gross - y.fees)}</td>
						<td>{eur(y.gross - y.tax - y.fees)}</td>
						<td>{eur(y.purchases)}</td>
						<td class:neg={y.realizedGain < 0}>{eur(y.realizedGain)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</details>

<div class="scroll ledger">
	<table>
		<thead>
			<tr>
				<th class="l" aria-label="Acciones"></th>
				<th class="l">Fecha</th>
				<th class="l">Descripción</th>
				<th class="l">Operación</th>
				<th class="l">Valor</th>
				<th>Cantidad</th>
				<th>Precio</th>
				<th class="l">Moneda</th>
				<th>Cambio</th>
				<th class="l">Cuenta</th>
				<th>Bruto €</th>
				<th>Impuestos €</th>
				<th>Gastos €</th>
				<th>Resultado €</th>
				<th>Capital ±</th>
				<th>Compra €</th>
				<th class="acc">Capital invertido</th>
				<th class="acc">Ganancias año</th>
				{#each data.accounts as a (a.id)}
					<th class="acc">{a.name} ({a.currency})</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each visible as r (r.id)}
				<tr id="op-{r.id}" class:saved={r.id === data.saved?.id}>
					<td class="l actions">
						{#if r.canCopy}<a href="/movimientos/nuevo?cartera={data.portfolioId}&copiar={r.id}" title="Duplicar con la fecha de hoy" aria-label="Duplicar {r.description}">⧉</a>{/if}
					</td>
					<td class="l nowrap"><a href="/movimientos/{r.id}" title="Editar">{date(r.date)}</a></td>
					<td class="l desc" title={r.description}>{r.description}</td>
					<td class="l">{r.type}</td>
					<td class="l">{r.ticker ?? ''}</td>
					<td>{num(r.quantity)}</td>
					<td>{num(r.price)}</td>
					<td class="l">{r.currency ?? ''}</td>
					<td>{num(r.fxRate)}</td>
					<td class="l">{r.account ?? ''}</td>
					<td>{eur(r.grossEur, true)}</td>
					<td>{eur(r.taxEur, true)}</td>
					<td>{eur(r.feesEur, true)}</td>
					<td class:neg={r.netEur < 0}>{eur(r.netEur, true)}</td>
					<td class:neg={r.capitalEur < 0}>{eur(r.capitalEur, true)}</td>
					<td class:neg={r.purchaseEur < 0}>{eur(r.purchaseEur, true)}</td>
					<td class="acc">{eur(r.invested)}</td>
					<td class="acc" class:neg={r.yearResult < 0}>{eur(r.yearResult)}</td>
					{#each r.cash as c, i (i)}
						<td class="acc" class:neg={c < 0}>{eur(c)}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1rem;
		align-items: end;
		margin-bottom: 0.75rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
	}
	label.grow {
		flex: 1 1 14rem;
	}
	select,
	input {
		font: inherit;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	.count {
		color: var(--muted);
		font-size: 12px;
	}
	.warning {
		color: var(--neg);
	}
	.new {
		padding: 0.3rem 0.8rem;
		border-radius: 4px;
		background: var(--accent);
		color: var(--bg);
		font-weight: 600;
		text-decoration: none;
	}
	p.saved {
		margin: 0 0 0.75rem;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--soft);
	}
	tr.saved td {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	td.actions {
		padding-right: 0;
	}
	td.actions a {
		display: inline-block;
		padding: 0 0.3rem;
		font-size: 15px;
		line-height: 1;
		color: var(--accent);
		text-decoration: none;
	}
	td a {
		color: inherit;
		text-decoration-color: var(--muted);
	}
	.metrics {
		margin-bottom: 0.75rem;
	}
	.metrics summary {
		cursor: pointer;
		color: var(--muted);
		margin-bottom: 0.3rem;
	}
	.metrics .scroll {
		max-height: 13rem;
	}
	.scroll {
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	.ledger {
		max-height: calc(100vh - 13rem);
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.25rem 0.5rem;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		position: sticky;
		top: 0;
		background: var(--soft);
		font-weight: 600;
		font-size: 12px;
		z-index: 1;
	}
	.l {
		text-align: left;
	}
	.desc {
		max-width: 22rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.acc {
		background: var(--soft);
	}
	th.acc {
		border-left: 1px solid var(--line);
	}
	.neg {
		color: var(--neg);
	}
	tr.current td {
		font-weight: 600;
	}
	tbody tr:hover td {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
</style>

<script lang="ts">
	import { amount, date, eur, num, symbol } from '#lib/format.ts';
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

	// En móvil la lista va de lo más reciente a lo más antiguo.
	const newestFirst = $derived([...visible].reverse());
	// Las columnas de acumulados quedan fijas a la derecha; cada una necesita saber cuántas tiene detrás.
	const accCount = $derived(2 + data.accounts.length);

	let ledger: HTMLDivElement | undefined = $state();
	let metricsOpen = $state(true);
	const isMobile = () => window.matchMedia('(max-width: 700px)').matches;
	$effect(() => {
		if (isMobile()) metricsOpen = false;
	});
	$effect(() => {
		// Al abrir (o cambiar de periodo o cartera) queda a la vista lo más reciente; tras guardar, la operación guardada.
		void data.rows;
		const saved = data.saved && document.getElementById(`${isMobile() ? 'm' : 'op'}-${data.saved.id}`);
		if (saved) saved.scrollIntoView({ block: 'center' });
		else if (ledger) ledger.scrollTop = ledger.scrollHeight;
	});
	const signed = (cents: number) => `${cents > 0 ? '+' : ''}${eur(cents)}`;
</script>

<form method="GET" class="filters">
	<input type="hidden" name="cartera" value={data.portfolioId} />
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
	<a class="reconcile" href="/conciliacion?cartera={data.portfolioId}">Conciliar saldos</a>
</form>

<dl class="summary mobile">
	{#each data.summary.cash as c (c.name)}
		<div><dt>{c.name}</dt><dd class:neg={c.amount < 0}>{amount(c.amount, c.currency)}</dd></div>
	{/each}
	<div><dt>Capital invertido</dt><dd>{eur(data.summary.invested)} €</dd></div>
	<div><dt>Ganancias {data.currentYear}</dt><dd class:neg={data.summary.yearResult < 0}>{eur(data.summary.yearResult)} €</dd></div>
</dl>

{#if data.saved}
	<p class="saved">
		Guardado: {data.saved.description}.
		{#each data.saved.balances as b (b.name)}
			Saldo de {b.name} tras la operación: <strong class:neg={b.amount < 0}>{amount(b.amount, b.currency)}</strong>.
		{/each}
	</p>
{/if}

{#if data.warnings > 0}
	<p class="warning">El motor ha emitido {data.warnings} avisos al recalcular esta cartera.</p>
{/if}

<details class="metrics" bind:open={metricsOpen}>
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

<div class="scroll ledger desktop" bind:this={ledger} style="--acc-count: {accCount}">
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
				<th class="acc first" style="--acc-i: 0">Capital invertido</th>
				<th class="acc" style="--acc-i: 1">Ganancias año</th>
				{#each data.accounts as a, i (a.id)}
					<th class="acc" style="--acc-i: {i + 2}">{a.name} ({symbol(a.currency)})</th>
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
					<td class="l">{symbol(r.currency)}</td>
					<td>{num(r.fxRate)}</td>
					<td class="l">{r.account ?? ''}</td>
					<td>{eur(r.grossEur, true)}</td>
					<td>{eur(r.taxEur, true)}</td>
					<td>{eur(r.feesEur, true)}</td>
					<td class:neg={r.netEur < 0}>{eur(r.netEur, true)}</td>
					<td class:neg={r.capitalEur < 0}>{eur(r.capitalEur, true)}</td>
					<td class:neg={r.purchaseEur < 0}>{eur(r.purchaseEur, true)}</td>
					<td class="acc first" style="--acc-i: 0">{eur(r.invested)}</td>
					<td class="acc" style="--acc-i: 1" class:neg={r.yearResult < 0}>{eur(r.yearResult)}</td>
					{#each r.cash as c, i (i)}
						<td class="acc" style="--acc-i: {i + 2}" class:neg={c < 0}>{eur(c)}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- Vista reducida para móvil: lo esencial de cada movimiento, y el detalle al tocarlo. -->
<ul class="cards mobile">
	{#each newestFirst as r (r.id)}
		<li id="m-{r.id}" class:saved={r.id === data.saved?.id}>
			<details>
				<summary>
					<span class="when">{date(r.date).slice(0, 5)}<small>{r.date.slice(0, 4)}</small></span>
					<span class="what">
						<span class="desc">{r.description || r.type}</span>
						<small>{[r.type, r.ticker, r.account].filter(Boolean).join(' · ')}</small>
					</span>
					<span class="amounts">
						{#each r.moves as m (m.account)}
							<span class:neg={m.amount < 0}>{signed(m.amount)} {symbol(m.currency)}</span>
							<small>saldo {eur(m.balance)}</small>
						{:else}
							<small>sin efectivo</small>
						{/each}
					</span>
				</summary>
				<dl>
					{#if r.quantity != null}<div><dt>Cantidad</dt><dd>{num(r.quantity)}</dd></div>{/if}
					{#if r.price != null}<div><dt>Precio</dt><dd>{num(r.price)} {symbol(r.currency)}</dd></div>{/if}
					{#if r.fxRate != null && r.fxRate !== 1}<div><dt>Cambio</dt><dd>{num(r.fxRate)}</dd></div>{/if}
					{#if r.grossEur}<div><dt>Bruto</dt><dd>{eur(r.grossEur)} €</dd></div>{/if}
					{#if r.taxEur}<div><dt>Impuestos</dt><dd>{eur(r.taxEur)} €</dd></div>{/if}
					{#if r.feesEur}<div><dt>Gastos</dt><dd>{eur(r.feesEur)} €</dd></div>{/if}
					{#if r.netEur}<div><dt>Resultado</dt><dd class:neg={r.netEur < 0}>{eur(r.netEur)} €</dd></div>{/if}
					{#if r.capitalEur}<div><dt>Capital ±</dt><dd class:neg={r.capitalEur < 0}>{eur(r.capitalEur)} €</dd></div>{/if}
					{#if r.purchaseEur}<div><dt>Compra</dt><dd class:neg={r.purchaseEur < 0}>{eur(r.purchaseEur)} €</dd></div>{/if}
					<div><dt>Capital invertido</dt><dd>{eur(r.invested)} €</dd></div>
					<div><dt>Ganancias del año</dt><dd class:neg={r.yearResult < 0}>{eur(r.yearResult)} €</dd></div>
					{#each data.accounts as a, i (a.id)}
						<div><dt>{a.name}</dt><dd class:neg={r.cash[i] < 0}>{amount(r.cash[i], a.currency)}</dd></div>
					{/each}
				</dl>
				<p class="links">
					<a href="/movimientos/{r.id}">Editar</a>
					{#if r.canCopy}<a href="/movimientos/nuevo?cartera={data.portfolioId}&copiar={r.id}">Duplicar con la fecha de hoy</a>{/if}
				</p>
			</details>
		</li>
	{/each}
</ul>

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
	.reconcile {
		font-size: 12px;
	}
	.mobile {
		display: none;
	}
	/* Acumulados siempre a la vista: columnas de ancho fijo pegadas al borde derecho. */
	@media (min-width: 1100px) {
		.ledger .acc {
			--acc-w: 6.6rem;
			position: sticky;
			right: calc(var(--acc-w) * (var(--acc-count) - 1 - var(--acc-i)));
			box-sizing: border-box;
			width: var(--acc-w);
			min-width: var(--acc-w);
			max-width: var(--acc-w);
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.ledger th.acc {
			z-index: 2;
			white-space: normal;
			vertical-align: bottom;
		}
		.ledger .acc.first {
			box-shadow: inset 1px 0 0 var(--line);
		}
		.ledger tbody tr:hover td.acc {
			background: color-mix(in srgb, var(--accent) 8%, var(--soft));
		}
		.ledger tr.saved td.acc {
			background: color-mix(in srgb, var(--accent) 18%, var(--soft));
		}
	}
	@media (max-width: 700px) {
		.desktop {
			display: none;
		}
		.mobile {
			display: block;
		}
		.count {
			flex-basis: 100%;
		}
		dl.summary {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.4rem 1rem;
			margin: 0 0 0.75rem;
			padding: 0.5rem 0.7rem;
			border: 1px solid var(--line);
			border-radius: 6px;
			background: var(--soft);
		}
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--line);
	}
	.cards li {
		border-bottom: 1px solid var(--line);
	}
	.cards li.saved {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
	}
	.cards summary {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.6rem;
		align-items: start;
		padding: 0.5rem 0.2rem;
		cursor: pointer;
		list-style: none;
	}
	.cards summary::-webkit-details-marker {
		display: none;
	}
	.cards summary > span {
		display: grid;
		min-width: 0;
	}
	.cards small {
		font-size: 11px;
		color: var(--muted);
	}
	.cards .desc {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cards details[open] .desc {
		white-space: normal;
	}
	.cards .amounts {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.cards details dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.3rem 1rem;
		margin: 0;
		padding: 0.2rem 0.2rem 0.5rem;
	}
	.cards .links {
		display: flex;
		gap: 1.5rem;
		margin: 0;
		padding: 0 0.2rem 0.7rem;
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

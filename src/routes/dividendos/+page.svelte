<script lang="ts">
	import { MONTH_SHORT } from '#lib/engine/dividends.ts';
	import { date, eur, num, pct, price, symbol } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const total = $derived(data.years.find((y) => y.year === data.year));
	const monthTotals = $derived(MONTH_SHORT.map((_, m) => data.calendar.reduce((a, r) => a + r.monthly[m], 0)));
	/** Frase resumen del cambio, como la que se anotaba en la hoja. */
	function phrase(c: (typeof data.changes)[number]): string {
		const verb = c.newAnnual > c.oldAnnual ? 'sube' : 'baja';
		const change = c.pct == null ? '' : `, ${c.pct > 0 ? '+' : ''}${pct(c.pct)}`;
		const own = c.shares > 0 ? ` Con ${num(c.shares)} acciones, el ingreso anual pasa de ${eur(c.beforeEur)} a ${eur(c.afterEur)} €.` : '';
		return `${c.ticker} ${verb} de ${price(c.oldAnnual)} a ${price(c.newAnnual)} ${symbol(c.currency)}${change}.${own}`;
	}
</script>

<header class="page">
	<h1>Dividendos</h1>
	<span class="muted">PADI bruto {eur(data.padiGross)} € · neto {eur(data.padiNet)} €</span>
</header>

{#if form?.deleted}<p class="ok">Cambio de dividendo borrado. El calendario no se ha tocado.</p>{/if}

<section>
	<h2>Cambios de dividendo</h2>
	<form method="GET" class="filters">
		<input type="hidden" name="cartera" value={data.portfolioId} />
		<label>
			Año
			<select name="anio" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each data.years as y (y.year)}<option value={y.year} selected={y.year === data.year}>{y.year} ({y.count})</option>{/each}
			</select>
		</label>
		{#if total}
			<span>
				Efecto en el ingreso anual de esta cartera:
				<strong class:neg={total.annualEur < 0}>{total.annualEur > 0 ? '+' : ''}{eur(total.annualEur)} €</strong>
			</span>
		{/if}
	</form>
	{#if data.changes.length}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th class="l">Fecha</th>
						<th class="l">Valor</th>
						<th>Antes</th>
						<th>Después</th>
						<th>Variación</th>
						<th>Acciones</th>
						<th>Efecto anual</th>
						<th class="l">Resumen</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.changes as c (c.id)}
						<tr class:none={c.shares === 0}>
							<td class="l">{date(c.date)}</td>
							<td class="l"><a href="/dividendos/{c.securityId}">{c.ticker}</a></td>
							<td>{price(c.oldAnnual, c.currency)}</td>
							<td>{price(c.newAnnual, c.currency)}</td>
							<td class:neg={(c.pct ?? 0) < 0}>{c.pct == null ? 'nuevo' : `${c.pct > 0 ? '+' : ''}${pct(c.pct)}`}</td>
							<td>{c.shares ? num(c.shares) : ''}</td>
							<td class:neg={c.annualEur < 0}>{c.shares ? `${c.annualEur > 0 ? '+' : ''}${eur(c.annualEur)} €` : ''}</td>
							<td class="l wrap">
								{phrase(c)}
								{#if c.note && !/^\S+ (sube|baja) de /i.test(c.note)}<span class="muted">{c.note}</span>{/if}
								{#if c.url}<a href={c.url} target="_blank" rel="noreferrer">fuente</a>{/if}
							</td>
							<td>
								<form method="POST" action="?/borrar&cartera={data.portfolioId}&anio={data.year}" onsubmit={(e) => confirm(`¿Borrar el cambio de ${c.ticker} del ${date(c.date)}?`) || e.preventDefault()}>
									<input type="hidden" name="id" value={c.id} />
									<button class="link">Borrar</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="muted">No hay cambios de dividendo anotados en {data.year}.</p>
	{/if}
	<p class="muted">Para anotar un cambio, abre el valor en el calendario de abajo: una sola acción actualiza el calendario y deja constancia aquí.</p>
</section>

<section>
	<h2>Calendario previsto</h2>
	{#if data.unscheduled.length}
		<p class="warning">Sin calendario: {data.unscheduled.join(', ')}.</p>
	{/if}
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="l">Valor</th>
					<th>Acciones</th>
					<th>DPA anual</th>
					{#each MONTH_SHORT as m (m)}<th>{m}</th>{/each}
					<th>Bruto anual</th>
					<th>Neto anual</th>
				</tr>
			</thead>
			<tbody>
				{#each data.calendar as r (r.id)}
					<tr>
						<td class="l"><a href="/dividendos/{r.id}" title={r.name ?? undefined}>{r.ticker}</a></td>
						<td>{num(r.shares)}</td>
						<td>{r.dpa == null ? '' : price(r.dpa, r.currency)}</td>
						{#each r.monthly as m, i (i)}<td>{eur(m, true)}</td>{/each}
						<td>{eur(r.gross)}</td>
						<td>{eur(r.net)}</td>
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<td class="l">Total</td>
					<td></td>
					<td></td>
					{#each monthTotals as m, i (i)}<td>{eur(m)}</td>{/each}
					<td>{eur(data.padiGross)}</td>
					<td>{eur(data.padiNet)}</td>
				</tr>
			</tfoot>
		</table>
	</div>
	<p class="muted">Importes brutos de cada mes en €, con las acciones de hoy; el DPA, en la moneda en que paga el valor.</p>
	{#if data.others.length}
		<form method="GET" class="filters" onsubmit={(e) => e.preventDefault()}>
			<label>
				Calendario de un valor sin posición
				<select onchange={(e) => e.currentTarget.value && (location.href = `/dividendos/${e.currentTarget.value}`)}>
					<option value="">Elegir…</option>
					{#each data.others as s (s.id)}<option value={s.id}>{s.ticker}</option>{/each}
				</select>
			</label>
		</form>
	{/if}
</section>

<style>
	.page,
	.filters {
		display: flex;
		gap: 0.5rem 1rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.filters {
		align-items: end;
		margin-bottom: 0.5rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 1.5rem 0 0.4rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
	}
	select {
		font: inherit;
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	.scroll {
		overflow: auto;
		max-height: 34rem;
		border: 1px solid var(--line);
		border-radius: 6px;
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
	thead th {
		position: sticky;
		top: 0;
		background: var(--soft);
		font-size: 12px;
		color: var(--muted);
	}
	tfoot td {
		position: sticky;
		bottom: 0;
		background: var(--soft);
		font-weight: 600;
		border-bottom: none;
	}
	.l {
		text-align: left;
	}
	.wrap {
		white-space: normal;
		min-width: 18rem;
		max-width: 34rem;
	}
	tr.none td {
		color: var(--muted);
	}
	.muted {
		color: var(--muted);
	}
	.neg {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
	.warning {
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--neg);
		background: var(--soft);
		max-width: 60rem;
	}
	button.link {
		font: inherit;
		background: none;
		border: none;
		padding: 0;
		color: var(--muted);
		text-decoration: underline;
		cursor: pointer;
	}
</style>

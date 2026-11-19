<script lang="ts">
	import BarList from '#lib/components/BarList.svelte';
	import { MONTH_NAMES } from '#lib/engine/dividends.ts';
	import { date, eur, num, pct, price } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = (typeof data.rows)[number];

	// Columnas de la tabla: de cada una, el dato por el que se ordena y cómo se pinta.
	const columns: { key: string; label: string; title?: string; value: (r: Row) => number | string | null; text: (r: Row) => string; signed?: boolean }[] = [
		{ key: 'ticker', label: 'Valor', value: (r) => r.ticker, text: (r) => r.ticker },
		{ key: 'shares', label: 'Acciones', value: (r) => r.shares, text: (r) => num(r.shares) },
		{ key: 'averagePrice', label: 'P. medio', title: 'Coste reducido por acción, en euros', value: (r) => r.averagePrice, text: (r) => price(r.averagePrice) },
		{ key: 'reducedCost', label: 'Coste', title: 'Coste reducido: el de compra menos ventas de derechos y devoluciones de prima', value: (r) => r.reducedCost, text: (r) => eur(r.reducedCost) },
		{ key: 'price', label: 'Precio', title: 'Último precio, en la moneda en que cotiza', value: (r) => r.priceEur, text: (r) => (r.quote ? price(r.quote.price, r.quote.currency) : '') },
		{ key: 'value', label: 'Valor mercado', value: (r) => r.value, text: (r) => eur(r.value) },
		{ key: 'gain', label: 'P/G', title: 'Valor de mercado menos coste reducido', value: (r) => r.gain, text: (r) => eur(r.gain), signed: true },
		{ key: 'gainPct', label: 'P/G %', value: (r) => r.gainPct, text: (r) => pct(r.gainPct), signed: true },
		{ key: 'weight', label: 'Peso', title: 'Parte del valor de mercado de la cartera', value: (r) => r.weight, text: (r) => pct(r.weight) },
		{ key: 'dpaEur', label: 'DPA', title: 'Dividendo anual por acción previsto, en euros', value: (r) => r.dpaEur, text: (r) => price(r.dpaEur) },
		{ key: 'dividendGross', label: 'Div. bruto', title: 'Dividendo bruto previsto a 12 meses', value: (r) => r.dividendGross, text: (r) => eur(r.dividendGross) },
		{ key: 'dividendNet', label: 'Div. neto', title: 'Tras las retenciones en origen y en destino', value: (r) => r.dividendNet, text: (r) => eur(r.dividendNet) },
		{ key: 'yocNet', label: 'YOC', title: 'Dividendo neto sobre el coste reducido', value: (r) => r.yocNet, text: (r) => pct(r.yocNet) },
		{ key: 'yieldGross', label: 'RPD', title: 'Dividendo bruto sobre el valor de mercado', value: (r) => r.yieldGross, text: (r) => pct(r.yieldGross) },
		{ key: 'yieldNet', label: 'RPD neta', title: 'Dividendo neto sobre el valor de mercado', value: (r) => r.yieldNet, text: (r) => pct(r.yieldNet) },
		{ key: 'dividendWeight', label: 'Peso div.', title: 'Parte del dividendo bruto previsto de la cartera', value: (r) => r.dividendWeight, text: (r) => pct(r.dividendWeight) },
		{ key: 'received', label: 'Cobrado', title: 'Dividendos brutos cobrados desde siempre', value: (r) => r.received, text: (r) => eur(r.received, true) },
		{ key: 'recovered', label: '% recup.', title: 'Dividendos cobrados sobre el coste', value: (r) => r.recovered, text: (r) => (r.received ? pct(r.recovered) : '') },
		{ key: 'sinceLastBuy', label: 'Por reinvertir', title: 'Cobrado desde la última compra, en los valores que se reinvierten', value: (r) => (r.reinvest ? r.sinceLastBuy : null), text: (r) => (r.reinvest ? eur(r.sinceLastBuy, true) : 'no') }
	];

	// Por defecto, el orden de la cartera (el de las columnas de `Control cartera`); los valores sin él, al final por ticker.
	const DEFAULT = 'order';
	let sortKey = $state(DEFAULT);
	let descending = $state(false);
	const position = (r: Row) => data.order[r.id] ?? null;
	let search = $state('');
	let zone = $state('');
	let sector = $state('');
	let tier = $state('');
	function sortBy(key: string) {
		if (sortKey === key) descending = !descending;
		else {
			sortKey = key;
			descending = key !== 'ticker';
		}
	}
	const options = (pick: (r: Row) => string | null) => [...new Set(data.rows.map(pick).filter((v): v is string => Boolean(v)))].sort();
	const zones = $derived(options((r) => r.zone));
	const sectors = $derived(options((r) => r.sector));
	const tiers = $derived(options((r) => r.tier));
	const visible = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const column = columns.find((c) => c.key === sortKey) ?? { value: position };
		const rows = data.rows.filter((r) => (!zone || r.zone === zone) && (!sector || r.sector === sector) && (!tier || r.tier === tier) && (!q || r.ticker.toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q)));
		// Los valores sin dato van siempre al final, se ordene como se ordene.
		return rows.sort((a, b) => {
			const x = column.value(a);
			const y = column.value(b);
			if (x == null || y == null) return x == null ? (y == null ? a.ticker.localeCompare(b.ticker) : 1) : -1;
			const order = typeof x === 'string' ? x.localeCompare(String(y)) : x - Number(y);
			return descending ? -order : order;
		});
	});
	const filtered = $derived(visible.length !== data.rows.length);
	const sum = (pick: (r: Row) => number | null) => visible.reduce((a, r) => a + (pick(r) ?? 0), 0);

	const t = $derived(data.totals);
	const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
	const forecast = $derived(data.forecast.map((f) => ({ label: capitalize(MONTH_NAMES[f.month - 1]), amount: f.gross, note: `${capitalize(MONTH_NAMES[f.month - 1])}: ${eur(f.gross)} € brutos, ${eur(f.net)} € netos` })));

	let dimension = $state<keyof typeof data.distributions>('Sector');
	let measure = $state<'value' | 'dividend'>('value');
	const LIMIT = 15;
	const shares = $derived.by(() => {
		const all = data.distributions[dimension][measure];
		if (all.length <= LIMIT) return all;
		const rest = all.slice(LIMIT - 1);
		return [...all.slice(0, LIMIT - 1), { label: `Resto (${rest.length})`, amount: rest.reduce((a, r) => a + r.amount, 0), share: rest.reduce((a, r) => a + r.share, 0) }];
	});
</script>

<header class="page">
	<h1>Cartera</h1>
	<span class="muted">
		{#if data.newestQuote}
			Precios del {date(data.newestQuote)}{#if data.oldestQuote !== data.newestQuote}&nbsp;(el más antiguo, del {date(data.oldestQuote!)}){/if}
		{:else}
			Sin precios
		{/if}
		· <a href="/precios">precios y cambios</a>
	</span>
</header>

{#if data.status.pricesError}
	<p class="warning">{data.status.pricesError} Se muestran los últimos precios guardados.</p>
{:else if !data.status.pricesConfigured && data.rows.length}
	<p class="warning">No hay hoja de precios configurada: los precios son los últimos guardados o tecleados a mano en <a href="/precios">Precios</a>.</p>
{/if}
{#if t.unpriced.length}
	<p class="warning">Sin precio o sin tipo de cambio: {t.unpriced.join(', ')}. No cuentan en el valor de mercado.</p>
{/if}
{#if t.unscheduled.length}
	<p class="warning">Sin calendario de dividendos: {t.unscheduled.join(', ')}. Se añade en <a href="/dividendos">Dividendos</a>.</p>
{/if}

<dl class="tiles">
	<div><dt>Valor de mercado</dt><dd>{eur(t.value)} €</dd><dd class="sub">{t.count} valores · coste {eur(t.reducedCost)} €</dd></div>
	<div><dt>P/G de los valores</dt><dd class:neg={t.gain < 0}>{eur(t.gain)} €</dd><dd class="sub">{pct(t.gainPct)} sobre el coste</dd></div>
	<div><dt>Liquidez</dt><dd>{eur(t.liquidity)} €</dd><dd class="sub">{pct(t.liquidityPct)} del total</dd></div>
	<div><dt>Capital aportado</dt><dd>{eur(t.capital)} €</dd><dd class="sub" title="Valor de mercado más liquidez menos capital aportado">resultado total {eur(t.totalGain)} €</dd></div>
	<div><dt>PADI bruto</dt><dd>{eur(t.padiGross)} €</dd><dd class="sub">{eur(t.monthlyGross)} € al mes · RPD {pct(t.yieldGross)}</dd></div>
	<div><dt>PADI neto</dt><dd>{eur(t.padiNet)} €</dd><dd class="sub">{eur(t.monthlyNet)} € al mes · YOC {pct(t.yocNet)} · retenciones {pct(t.taxRate)}</dd></div>
</dl>

{#if data.rows.length === 0}
	<p class="muted">Esta cartera no tiene ningún valor con posición.</p>
{:else}
	<form class="filters" onsubmit={(e) => e.preventDefault()}>
		<label>Buscar <input bind:value={search} placeholder="valor" size="10" /></label>
		{#if zones.length}
			<label>Zona <select bind:value={zone}><option value="">Todas</option>{#each zones as z (z)}<option>{z}</option>{/each}</select></label>
		{/if}
		{#if sectors.length}
			<label>Sector <select bind:value={sector}><option value="">Todos</option>{#each sectors as s (s)}<option>{s}</option>{/each}</select></label>
		{/if}
		{#if tiers.length}
			<label><i>Tier</i> <select bind:value={tier}><option value="">Todos</option>{#each tiers as x (x)}<option>{x}</option>{/each}</select></label>
		{/if}
		<label class="mobile">
			Ordenar por
			<select bind:value={sortKey}><option value={DEFAULT}>Orden de la cartera</option>{#each columns as c (c.key)}<option value={c.key}>{c.label}</option>{/each}</select>
		</label>
		{#if sortKey !== DEFAULT}<button type="button" class="link desktop" onclick={() => ((sortKey = DEFAULT), (descending = false))}>Orden de la cartera</button>{/if}
		{#if filtered}<span class="muted">{visible.length} de {data.rows.length} valores</span>{/if}
		{#if t.equalWeight}<span class="muted">Peso equiponderado: {pct(t.equalWeight)}</span>{/if}
	</form>

	<div class="scroll desktop">
		<table class="holdings">
			<thead>
				<tr>
					{#each columns as c (c.key)}
						<th class:l={c.key === 'ticker'} title={c.title} aria-sort={sortKey === c.key ? (descending ? 'descending' : 'ascending') : undefined}>
							<button type="button" onclick={() => sortBy(c.key)}>{c.label}{sortKey === c.key ? (descending ? ' ▾' : ' ▴') : ''}</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each visible as r (r.id)}
					<tr>
						{#each columns as c (c.key)}
							{@const v = c.value(r)}
							{#if c.key === 'ticker'}
								<th class="l" scope="row" title={[r.name, r.sector, r.country].filter(Boolean).join(' · ')}>{r.ticker}</th>
							{:else}
								<td class:neg={c.signed && typeof v === 'number' && v < 0} title={c.key === 'price' && r.quote ? `Precio del ${date(r.quote.date)}` : undefined}>{c.text(r)}</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<th class="l" scope="row">{filtered ? 'Suma' : 'Total'}</th>
					<td></td>
					<td></td>
					<td>{eur(sum((r) => r.reducedCost))}</td>
					<td></td>
					<td>{eur(sum((r) => r.value))}</td>
					<td class:neg={sum((r) => r.gain) < 0}>{eur(sum((r) => r.gain))}</td>
					<td></td>
					<td>{pct(sum((r) => r.weight))}</td>
					<td></td>
					<td>{eur(sum((r) => r.dividendGross))}</td>
					<td>{eur(sum((r) => r.dividendNet))}</td>
					<td></td>
					<td></td>
					<td></td>
					<td>{pct(sum((r) => r.dividendWeight))}</td>
					<td>{eur(sum((r) => r.received))}</td>
					<td></td>
					<td>{eur(sum((r) => (r.reinvest ? r.sinceLastBuy : 0)))}</td>
				</tr>
			</tfoot>
		</table>
	</div>
	<p class="muted desktop">Importes en €, salvo el precio, que va en la moneda en que cotiza cada valor.</p>

	<ul class="cards mobile">
		{#each visible as r (r.id)}
			<li>
				<details>
					<summary>
						<strong>{r.ticker}</strong>
						<span>{eur(r.value)} €</span>
						<span class:neg={(r.gainPct ?? 0) < 0}>{pct(r.gainPct)}</span>
					</summary>
					<dl>
						{#each columns.slice(1) as c (c.key)}
							{#if c.text(r)}<div><dt>{c.label}</dt><dd>{c.text(r)}</dd></div>{/if}
						{/each}
					</dl>
				</details>
			</li>
		{/each}
	</ul>

	<div class="panels">
		<section>
			<h2>Dividendos previstos, próximos 12 meses</h2>
			<p class="muted">Bruto de cada mes con las acciones de hoy: {eur(t.padiGross)} € en total.</p>
			<BarList items={forecast} caption="Dividendo bruto previsto por mes" />
		</section>
		<section>
			<h2>Distribución</h2>
			<p class="choices">
				{#each Object.keys(data.distributions) as d (d)}
					<button type="button" class:on={dimension === d} aria-pressed={dimension === d} onclick={() => (dimension = d as typeof dimension)}>{d}</button>
				{/each}
				<span class="gap"></span>
				<button type="button" class:on={measure === 'value'} aria-pressed={measure === 'value'} onclick={() => (measure = 'value')}>Valor de mercado</button>
				<button type="button" class:on={measure === 'dividend'} aria-pressed={measure === 'dividend'} onclick={() => (measure = 'dividend')}>Dividendos</button>
			</p>
			<BarList items={shares} caption="{measure === 'value' ? 'Valor de mercado' : 'Dividendo bruto previsto'} por {dimension.toLowerCase()}" />
		</section>
	</div>
{/if}

<style>
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
	.page {
		display: flex;
		gap: 0.3rem 1rem;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 0.6rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	h2 {
		font-size: 1rem;
		margin: 0 0 0.2rem;
	}
	.muted {
		color: var(--muted);
	}
	.muted a {
		color: inherit;
	}
	.warning {
		margin: 0 0 0.5rem;
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--neg);
		background: var(--soft);
		max-width: 60rem;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11.5rem, 1fr));
		gap: 0.6rem;
		margin: 0.6rem 0 1rem;
	}
	.tiles div {
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
	}
	.tiles dt {
		font-size: 12px;
		color: var(--muted);
	}
	.tiles dd {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.tiles dd.sub {
		font-size: 12px;
		font-weight: 400;
		color: var(--muted);
	}
	.filters {
		display: flex;
		gap: 0.5rem 1rem;
		align-items: end;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.filters label {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
	}
	input,
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
		max-height: calc(100vh - 8rem);
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	.holdings {
		border-collapse: collapse;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	.holdings th,
	.holdings td {
		padding: 0.25rem 0.5rem;
		text-align: right;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	.holdings .l {
		text-align: left;
		position: sticky;
		left: 0;
		background: var(--bg);
	}
	.holdings thead th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--soft);
		font-size: 12px;
		padding: 0;
	}
	.holdings thead th.l {
		z-index: 2;
		background: var(--soft);
	}
	.holdings thead button {
		font: inherit;
		font-weight: 600;
		color: var(--muted);
		background: none;
		border: none;
		padding: 0.35rem 0.5rem;
		cursor: pointer;
		width: 100%;
		text-align: inherit;
	}
	.holdings thead button:hover {
		color: var(--fg);
	}
	.holdings tbody tr:hover :is(td, th) {
		background: color-mix(in srgb, var(--accent) 8%, var(--bg));
	}
	.holdings tfoot :is(td, th) {
		position: sticky;
		bottom: 0;
		background: var(--soft);
		font-weight: 600;
		border-bottom: none;
	}
	.neg {
		color: var(--neg);
	}
	.panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1.5rem 2.5rem;
		margin-top: 1.5rem;
	}
	.panels p {
		margin: 0 0 0.5rem;
	}
	.choices {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.choices .gap {
		width: 0.8rem;
	}
	.choices button {
		font: inherit;
		padding: 0.15rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--bg);
		color: var(--muted);
		cursor: pointer;
	}
	.choices button.on {
		border-color: var(--accent);
		color: var(--fg);
		background: color-mix(in srgb, var(--accent) 12%, var(--bg));
	}
	.mobile,
	.filters label.mobile {
		display: none;
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.cards li {
		border-bottom: 1px solid var(--line);
	}
	.cards summary {
		display: grid;
		grid-template-columns: 1fr auto 4.5rem;
		gap: 0.6rem;
		padding: 0.5rem 0.2rem;
		cursor: pointer;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.cards summary strong {
		text-align: left;
	}
	.cards dl {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.2rem 1rem;
		margin: 0;
		padding: 0 0.2rem 0.6rem;
	}
	.cards dl div {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.cards dt {
		color: var(--muted);
	}
	.cards dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 700px) {
		.desktop {
			display: none;
		}
		.mobile {
			display: revert;
		}
		.filters label.mobile {
			display: grid;
		}
		.tiles {
			grid-template-columns: 1fr 1fr;
		}
		.tiles dd {
			font-size: 1.05rem;
		}
	}
</style>

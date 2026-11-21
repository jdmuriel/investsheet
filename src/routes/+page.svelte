<script lang="ts">
	import BarList from '#lib/components/BarList.svelte';
	import { enhance } from '$app/forms';
	import Dialog from '#lib/components/Dialog.svelte';
	import SecurityDialog from '#lib/components/SecurityDialog.svelte';
	import { MONTH_NAMES, MONTH_SHORT } from '#lib/engine/dividends.ts';
	import { date, dateTime, dec2, eur, eurWhole, num, pct, price, symbol } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type Row = (typeof data.rows)[number];

	// Columnas de la tabla: de cada una, el dato por el que se ordena y cómo se pinta.
	const columns: { key: string; label: string; title?: string; value: (r: Row) => number | string | null; text: (r: Row) => string; signed?: boolean; total?: (r: Row) => number | null; percent?: boolean; whole?: boolean }[] = [
		{ key: 'ticker', label: 'Valor', value: (r) => r.ticker, text: (r) => r.ticker },
		{ key: 'shares', label: 'Acciones', value: (r) => r.shares, text: (r) => num(r.shares) },
		{ key: 'averagePrice', label: 'P.\nmedio', title: 'Coste reducido por acción, en euros', value: (r) => r.averagePrice, text: (r) => dec2(r.averagePrice) },
		{ key: 'price', label: 'Precio', title: 'Último precio, en la moneda en que cotiza', value: (r) => r.priceEur, text: (r) => (r.quote ? price(r.quote.price, r.quote.currency) : '') },
		{ key: 'reducedCost', label: 'Coste', title: 'Coste reducido: el de compra menos ventas de derechos y devoluciones de prima', value: (r) => r.reducedCost, text: (r) => eurWhole(r.reducedCost), total: (r) => r.reducedCost, whole: true },
		{ key: 'value', label: 'Valor\nmercado', value: (r) => r.value, text: (r) => eurWhole(r.value), total: (r) => r.value, whole: true },
		{ key: 'gain', label: 'P/G', title: 'Valor de mercado menos coste reducido', value: (r) => r.gain, text: (r) => eurWhole(r.gain), signed: true, total: (r) => r.gain, whole: true },
		{ key: 'gainPct', label: 'P/G %', value: (r) => r.gainPct, text: (r) => pct(r.gainPct), signed: true },
		{ key: 'weight', label: 'Peso', title: 'Parte del valor de mercado de la cartera', value: (r) => r.weight, text: (r) => pct(r.weight), total: (r) => r.weight, percent: true },
		{ key: 'dpaEur', label: 'DPA (€)', title: 'Dividendo anual por acción previsto, en euros', value: (r) => r.dpaEur, text: (r) => dec2(r.dpaEur) },
		{ key: 'dividendGross', label: 'Div.\nbruto', title: 'Dividendo bruto previsto a 12 meses', value: (r) => r.dividendGross, text: (r) => eur(r.dividendGross), total: (r) => r.dividendGross },
		{ key: 'dividendNet', label: 'Div.\nneto', title: 'Tras las retenciones en origen y en destino', value: (r) => r.dividendNet, text: (r) => eur(r.dividendNet), total: (r) => r.dividendNet },
		{ key: 'yieldGross', label: 'RPD', title: 'Dividendo bruto sobre el valor de mercado', value: (r) => r.yieldGross, text: (r) => pct(r.yieldGross) },
		{ key: 'yieldNet', label: 'RPD\nneta', title: 'Dividendo neto sobre el valor de mercado', value: (r) => r.yieldNet, text: (r) => pct(r.yieldNet) },
		{ key: 'yocNet', label: 'YOC', title: 'Dividendo neto sobre el coste reducido', value: (r) => r.yocNet, text: (r) => pct(r.yocNet) },
		{ key: 'dividendWeight', label: 'Peso\ndiv.', title: 'Parte del dividendo bruto previsto de la cartera', value: (r) => r.dividendWeight, text: (r) => pct(r.dividendWeight), total: (r) => r.dividendWeight, percent: true },
		{ key: 'received', label: 'Cobrado', title: 'Dividendos, devoluciones de prima y ventas de derechos cobrados desde siempre, brutos', value: (r) => r.received, text: (r) => eurWhole(r.received, true), total: (r) => r.received, whole: true },
		{ key: 'recovered', label: '%\nrecup.', title: 'Lo cobrado sobre el coste', value: (r) => r.recovered, text: (r) => (r.received ? pct(r.recovered) : '') },
		{ key: 'sinceLastBuy', label: 'Por\nreinvertir', title: 'Cobrado desde la última compra, en los valores que se reinvierten', value: (r) => (r.reinvest ? r.sinceLastBuy : null), text: (r) => (r.reinvest ? eurWhole(r.sinceLastBuy, true) : 'no'), total: (r) => (r.reinvest ? r.sinceLastBuy : 0), whole: true }
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
		if (ordering) return ordering.map((id) => data.rows.find((r) => r.id === id)!).filter(Boolean);
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

	// Columnas de meses (enero a diciembre): ocultas, dividendo por acción o bruto total en euros. Se recuerda en la cookie `meses`.
	type MonthsMode = 'accion' | 'total' | null;
	// svelte-ignore state_referenced_locally
	let monthsMode = $state<MonthsMode>(data.monthsMode);
	function setMonths(mode: MonthsMode) {
		monthsMode = mode;
		document.cookie = `meses=${mode ?? ''}; path=/; max-age=31536000; samesite=lax`;
	}
	const monthLabel = (i: number) => MONTH_SHORT[i][0].toUpperCase() + MONTH_SHORT[i].slice(1);
	const monthShare = (r: Row, i: number) => (r.months && r.months[i] ? price(r.months[i]) : '');
	const monthTotal = (r: Row, i: number) => eur(r.monthly[i], true);

	// Detalle del DPA de un valor en ventana emergente.
	let dpaRow = $state<Row | null>(null);

	// Edición del orden de la cartera: lista de ids en el orden nuevo mientras se edita.
	let ordering = $state<number[] | null>(null);
	let dragging: number | null = null;
	function startOrdering() {
		sortKey = DEFAULT;
		descending = false;
		search = zone = sector = tier = '';
		ordering = [...data.rows].sort((a, b) => (position(a) ?? Infinity) - (position(b) ?? Infinity) || a.ticker.localeCompare(b.ticker)).map((r) => r.id);
	}
	function move(from: number, to: number) {
		if (!ordering || to < 0 || to >= ordering.length || from === to) return;
		const next = [...ordering];
		next.splice(to, 0, ...next.splice(from, 1));
		ordering = next;
	}
	const sum = (pick: (r: Row) => number | null) => visible.reduce((a, r) => a + (pick(r) ?? 0), 0);

	const t = $derived(data.totals);
	let weightInfo = $state(false);

	// Desde cada valor: su ficha en ventana emergente (al guardar se recarga el cuadro) y sus movimientos de todos los años.
	let editing = $state<number | null>(null);
	function edit(e: MouseEvent, id: number) {
		if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		editing = id;
	}
	const editHref = (r: Row) => `/ajustes/valores/${encodeURIComponent(r.ticker)}?volver=/`;
	const movesHref = (r: Row) => `/movimientos?cartera=${data.portfolioId}&periodo=todos&valor=${encodeURIComponent(r.ticker)}`;
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

<svelte:window onclick={() => (weightInfo = false)} onkeydown={(e) => e.key === 'Escape' && (weightInfo = false)} />

<header class="page">
	<h1>Cartera</h1>
	<span class="muted">
		{#if data.status.pricesConfigured && data.status.pricesCheckedAt && !data.status.pricesError}
			Precios actualizados: {dateTime(data.status.pricesCheckedAt)}{#if data.oldestQuote && data.oldestQuote !== data.newestQuote}&nbsp;(el más antiguo, del {date(data.oldestQuote)}){/if}
		{:else if data.newestQuote}
			Precios del {date(data.newestQuote)}{#if data.oldestQuote !== data.newestQuote}&nbsp;(el más antiguo, del {date(data.oldestQuote!)}){/if}
		{:else}
			Sin precios
		{/if}
		· <a href="/precios">gestionar precios y tipos de cambio</a>
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
	<div><dt>PADI bruto</dt><dd>{eur(t.padiGross)} €</dd><dd class="sub">{eur(t.monthlyGross)} € al mes · RPD {pct(t.yieldGross)}</dd></div>
	<div><dt>PADI neto</dt><dd>{eur(t.padiNet)} €</dd><dd class="sub">{eur(t.monthlyNet)} € al mes · YOC {pct(t.yocNet)}</dd></div>
	<div><dt>Liquidez</dt><dd>{eur(t.liquidity)} €</dd><dd class="sub">{pct(t.liquidityPct)} del total</dd></div>
	<div><dt>Valor de mercado</dt><dd>{eur(t.value)} €</dd><dd class="sub">{t.count} valores · coste {eur(t.reducedCost)} €</dd></div>
	<div><dt>Capital aportado y reinvertido</dt><dd>{eur(t.invested)} €</dd><dd class="sub" title="Aportaciones menos retiradas; el resto es el resultado de los años cerrados, que se considera reinvertido">Solo aportación: {eur(t.capital)} €</dd></div>
	<div><dt>Total</dt><dd>{eur(t.value + t.liquidity)} €</dd><dd class="sub" class:neg={t.totalGain < 0} title="Valor de mercado más liquidez menos lo aportado; el porcentaje es sobre lo aportado">resultado total {eur(t.totalGain)}&nbsp;€{#if t.capital > 0}&nbsp;({pct(t.totalGain / t.capital)}){/if}</dd></div>
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
			<select bind:value={sortKey}><option value={DEFAULT}>Orden de la cartera</option>{#each columns as c (c.key)}<option value={c.key}>{c.label.replace('\n', ' ')}</option>{/each}</select>
		</label>
		{#if sortKey !== DEFAULT}<button type="button" class="link desktop" onclick={() => ((sortKey = DEFAULT), (descending = false))}>Orden de la cartera</button>{/if}
		{#if filtered && !ordering}<span class="muted">{visible.length} de {data.rows.length} valores</span>{/if}
		<span class="right desktop">
			{#if !ordering}<button type="button" class="link" onclick={startOrdering}>Cambiar el orden de la cartera</button>{/if}
			<span role="group" aria-label="Columnas de meses">
				<span class="muted">Meses:</span>
				{#each [[null, 'ocultos'], ['accion', 'por acción'], ['total', 'total €']] as [mode, label], i (label)}
					{#if i > 0}<span class="muted">&nbsp;·&nbsp;</span>{/if}
					<button type="button" class="link" class:on={monthsMode === mode} aria-pressed={monthsMode === mode} onclick={() => setMonths(mode as MonthsMode)}>{label}</button>
				{/each}
			</span>
		</span>
	</form>

	{#if ordering}
		<form
			method="POST"
			action="?/orden"
			class="ordering desktop"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'success') ordering = null;
				}}
		>
			<input type="hidden" name="ids" value={ordering.join(',')} />
			<span>Arrastra las filas o usa las flechas para colocar cada valor; el orden se guarda para esta cartera.</span>
			<button>Guardar el orden</button>
			<button type="button" onclick={() => (ordering = null)}>Cancelar</button>
		</form>
	{/if}

	<div class="scroll desktop">
		<table class="holdings">
			<thead>
				<tr>
					{#each columns as c (c.key)}
						<th class:l={c.key === 'ticker'} title={c.title} aria-sort={sortKey === c.key ? (descending ? 'descending' : 'ascending') : undefined}>
							<button type="button" onclick={() => sortBy(c.key)}>{c.label}{sortKey === c.key ? (descending ? ' ▾' : ' ▴') : ''}</button>
							{#if c.key === 'weight' && t.equalWeight}
								<button type="button" class="info" aria-expanded={weightInfo} aria-label="Peso equiponderado" title="Peso equiponderado: {pct(t.equalWeight)}" onclick={(e) => (e.stopPropagation(), (weightInfo = !weightInfo))}>ⓘ</button>
								{#if weightInfo}<span class="tip" role="status">Peso equiponderado: {pct(t.equalWeight)}<br /><small>el que tendría cada uno de los {t.count} valores con todos a partes iguales</small></span>{/if}
							{/if}
						</th>
					{/each}
					{#if monthsMode}
						{#each MONTH_SHORT as _, i (i)}
							<th class="month" class:first={i === 0} title="{monthsMode === 'accion' ? 'Dividendo por acción previsto' : 'Bruto previsto, en euros'} en {MONTH_NAMES[i]}"><button type="button" disabled>{monthLabel(i)}</button></th>
						{/each}
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each visible as r, index (r.id)}
					<tr
						draggable={ordering ? 'true' : undefined}
						class:dragrow={ordering}
						ondragstart={() => (dragging = index)}
						ondragover={(e) => ordering && dragging != null && e.preventDefault()}
						ondrop={(e) => {
							e.preventDefault();
							if (dragging != null) move(dragging, index);
							dragging = null;
						}}
					>
						{#each columns as c (c.key)}
							{@const v = c.value(r)}
							{#if c.key === 'ticker'}
								<th class="l" scope="row">
									{#if ordering}
										<span class="arrows">
											<button type="button" title="Subir" aria-label="Subir {r.ticker}" disabled={index === 0} onclick={() => move(index, index - 1)}>↑</button>
											<button type="button" title="Bajar" aria-label="Bajar {r.ticker}" disabled={index === visible.length - 1} onclick={() => move(index, index + 1)}>↓</button>
										</span>
									{/if}
									<a class="ticker" href={editHref(r)} onclick={(e) => edit(e, r.id)} title="{[r.name, r.sector, r.country].filter(Boolean).join(' · ')}. Editar el valor">{r.ticker}</a>
									<a class="moves" href={movesHref(r)} title="Movimientos de {r.ticker}, todos los años" aria-label="Movimientos de {r.ticker}">☰</a>
								</th>
							{:else if c.key === 'dpaEur' && r.months}
								<td><button type="button" class="cell" title="Ver el dividendo previsto de cada mes" onclick={() => (dpaRow = r)}>{c.text(r)}</button></td>
							{:else}
								<td class:neg={c.signed && typeof v === 'number' && v < 0} title={c.key === 'price' && r.quote ? `Precio del ${date(r.quote.date)}` : undefined}>{c.text(r)}</td>
							{/if}
						{/each}
						{#if monthsMode}
							{#each MONTH_SHORT as _, i (i)}
								<td class="month" class:first={i === 0}>{monthsMode === 'accion' ? monthShare(r, i) : monthTotal(r, i)}</td>
							{/each}
						{/if}
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					<th class="l" scope="row">{filtered ? 'Suma' : 'Total'}</th>
					{#each columns.slice(1) as c (c.key)}
						{@const v = c.total ? sum(c.total) : null}
						<td class:neg={c.signed && v != null && v < 0}>{v == null ? '' : c.percent ? pct(v) : c.whole ? eurWhole(v) : eur(v)}</td>
					{/each}
					{#if monthsMode}
						{#each MONTH_SHORT as _, i (i)}
							<td class="month" class:first={i === 0}>{monthsMode === 'total' ? eur(sum((r) => r.monthly[i])) : ''}</td>
						{/each}
					{/if}
				</tr>
			</tfoot>
		</table>
	</div>
	<p class="muted desktop">Importes en €, salvo el precio, que va en la moneda en que cotiza cada valor{monthsMode === 'accion' ? ', y el dividendo por acción de cada mes, que va en la moneda de su calendario' : ''}. Pulsa el DPA de un valor para ver su previsión mes a mes.</p>

	<ul class="cards mobile">
		{#each visible as r (r.id)}
			<li>
				<details>
					<summary>
						<strong>{r.ticker}</strong>
						<span>{eur(r.value)} €</span>
						<span class:neg={(r.gainPct ?? 0) < 0}>{pct(r.gainPct)}</span>
					</summary>
					<p class="actions">
						<a href={movesHref(r)}>Movimientos</a>
						<a href={editHref(r)} onclick={(e) => edit(e, r.id)}>Editar el valor</a>
						{#if r.months}<button type="button" class="link" onclick={() => (dpaRow = r)}>Dividendo por meses</button>{/if}
					</p>
					<dl>
						{#each columns.slice(1) as c (c.key)}
							{#if c.text(r)}<div><dt>{c.label.replace('\n', ' ')}</dt><dd>{c.text(r)}</dd></div>{/if}
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

{#if dpaRow?.months}
	{@const r = dpaRow}
	<Dialog title="{r.ticker}: dividendo previsto por meses" onclose={() => (dpaRow = null)} fit>
		<table class="dpa">
			<thead>
				<tr><th class="l">Mes</th><th>Por acción ({symbol(r.dpaCurrency)})</th><th>Bruto total (€)</th></tr>
			</thead>
			<tbody>
				{#each MONTH_NAMES as m, i (m)}
					<tr class:empty={!r.months![i]}><th class="l" scope="row">{m[0].toUpperCase() + m.slice(1)}</th><td>{monthShare(r, i)}</td><td>{monthTotal(r, i)}</td></tr>
				{/each}
			</tbody>
			<tfoot>
				<tr><th class="l" scope="row">Año</th><td>{price(r.dpa)}</td><td>{eur(r.dividendGross)}</td></tr>
			</tfoot>
		</table>
		<p class="muted">Con las {num(r.shares)} acciones de hoy. El calendario se cambia en <a href="/dividendos">Dividendos</a>.</p>
	</Dialog>
{/if}

{#if editing != null}
	<SecurityDialog security={editing} onclose={() => (editing = null)} />
{/if}

<style>
	.holdings .month {
		color: var(--muted);
	}
	.holdings .month.first {
		box-shadow: inset 1px 0 0 var(--line);
	}
	.holdings thead .month button {
		cursor: default;
		text-align: right;
	}
	button.cell {
		font: inherit;
		color: inherit;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline dotted var(--muted);
	}
	button.cell:hover {
		color: var(--accent);
	}
	.arrows button {
		font: inherit;
		font-size: 12px;
		padding: 0 0.25rem;
		margin-right: 0.1rem;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
	}
	.arrows button:disabled {
		color: var(--muted);
		cursor: default;
	}
	tr.dragrow {
		cursor: grab;
	}
	.ordering {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-bottom: 0.5rem;
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--accent);
		background: var(--soft);
	}
	.ordering button {
		font: inherit;
		padding: 0.25rem 0.8rem;
	}
	.dpa {
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
		margin-bottom: 0.6rem;
	}
	.dpa :is(th, td) {
		padding: 0.2rem 0.8rem;
		text-align: right;
		border-bottom: 1px solid var(--line);
	}
	.dpa .l {
		text-align: left;
	}
	.dpa thead th {
		font-size: 12px;
		color: var(--muted);
	}
	.dpa tr.empty td {
		color: var(--muted);
	}
	.dpa tfoot :is(th, td) {
		font-weight: 600;
		border-bottom: none;
	}
	.holdings a.ticker {
		color: inherit;
		text-decoration: none;
	}
	.holdings a.ticker:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.holdings a.moves {
		margin-left: 0.3rem;
		color: var(--muted);
		text-decoration: none;
		font-size: 12px;
		font-weight: 400;
	}
	.holdings a.moves:hover {
		color: var(--accent);
	}
	.cards .actions {
		display: flex;
		gap: 1rem;
		margin: 0 0.2rem 0.4rem;
	}
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
	.holdings thead th {
		vertical-align: bottom;
	}
	.holdings thead button {
		white-space: pre-line;
	}
	.filters .right {
		margin-left: auto;
		display: flex;
		gap: 1.2rem;
		align-items: baseline;
	}
	.link.on {
		color: var(--fg);
		font-weight: 600;
		text-decoration: none;
		cursor: default;
	}
	.holdings thead th:has(.info) button:first-child {
		width: auto;
		padding-right: 0.15rem;
	}
	.holdings thead button.info {
		width: auto;
		padding: 0.35rem 0.4rem 0.35rem 0;
		font-weight: 400;
	}
	.tip {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 3;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--bg);
		color: var(--fg);
		font-weight: 400;
		text-align: left;
		white-space: normal;
		width: 14rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
	}
	.tip small {
		color: var(--muted);
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
		.filters .right {
			display: none;
		}
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

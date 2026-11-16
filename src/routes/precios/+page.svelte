<script lang="ts">
	import { date, num, price } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const SOURCES: Record<string, string> = { sheet: 'hoja de precios', manual: 'a mano', legacy: 'hoja antigua' };
	const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(new Date(iso)) : 'nunca');
</script>

<header class="page">
	<h1>Precios y tipos de cambio</h1>
	<a href="/">Volver a Cartera</a>
</header>

{#if form?.errors}
	<ul class="errors">
		{#each form.errors as e (e)}<li>{e}</li>{/each}
	</ul>
{:else if form?.savedId}
	<p class="ok">Precio guardado.</p>
{:else if form?.refreshed}
	<p class="ok">Lectura hecha; el resultado está abajo.</p>
{/if}

<section class="status">
	<p>
		<strong>Hoja de precios:</strong>
		{#if !data.status.pricesConfigured}
			sin configurar (falta el secreto <code>PRICES_CSV_URL</code>).
		{:else if data.status.pricesError}
			<span class="neg">{data.status.pricesError}</span> Último intento: {when(data.status.pricesCheckedAt)}.
		{:else}
			leída el {when(data.status.pricesCheckedAt)}.
		{/if}
	</p>
	<p>
		<strong>Tipos de cambio del BCE:</strong>
		{#if data.status.fxError}<span class="neg">{data.status.fxError}</span> Último intento: {when(data.status.fxCheckedAt)}.{:else}leídos el {when(data.status.fxCheckedAt)}.{/if}
		{#each data.fx as f (f.currency)}
			<span class="rate">{num(f.rate)} {f.currency} por EUR ({date(f.date)})</span>
		{/each}
	</p>
	<form method="POST" action="?/actualizar"><button>Leer ahora</button></form>
</section>

<p class="note">Los precios se leen solos cuando tienen más de una hora. Si la fuente falla o da un precio equivocado, tecléalo aquí: el precio a mano manda durante ese día.</p>

<div class="scroll">
	<table>
		<thead>
			<tr>
				<th>Valor</th>
				<th>Ticker de precios</th>
				<th class="r">Último precio</th>
				<th>Moneda</th>
				<th>Fecha</th>
				<th>Origen</th>
				<th>Precio a mano de hoy</th>
			</tr>
		</thead>
		<tbody>
			{#each data.securities as s (s.id)}
				{@const f = `precio-${s.id}`}
				<tr class:idle={!s.held}>
					<td title={s.name ?? undefined}><strong>{s.ticker}</strong></td>
					<td>{s.priceTicker ?? ''}</td>
					<td class="r">{price(s.quote?.price)}</td>
					<td>{s.quote?.currency ?? s.currency ?? ''}</td>
					<td class:old={s.quote && s.quote.date < data.today}>{s.quote ? date(s.quote.date) : 'sin precio'}</td>
					<td>{s.quote ? SOURCES[s.quote.source] : ''}</td>
					<td>
						<form id={f} method="POST" action="?/guardar">
							<input type="hidden" name="id" value={s.id} />
							<input name="price" inputmode="decimal" autocomplete="off" size="9" value={form?.errors && form.id === s.id ? form.raw.price : ''} aria-label="Precio de {s.ticker} en {s.currency ?? 'su moneda'}" />
							<button>Guardar</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="note">En gris, los valores sin posición en esta cartera. El ticker de precios y la moneda de cada valor se cambian en <a href="/ajustes/valores">Ajustes → Valores</a>.</p>

<style>
	.page {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		flex-wrap: wrap;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	.status p {
		margin: 0 0 0.3rem;
	}
	.rate {
		margin-left: 0.8rem;
		white-space: nowrap;
	}
	.note {
		max-width: 50rem;
		color: var(--muted);
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0.25rem 0.5rem;
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	th {
		font-size: 12px;
		color: var(--muted);
	}
	.r {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tr.idle td {
		color: var(--muted);
	}
	.old {
		color: var(--muted);
	}
	td form {
		display: flex;
		gap: 0.3rem;
	}
	input,
	button {
		font: inherit;
		padding: 0.2rem 0.4rem;
	}
	input {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
		text-align: right;
	}
	.errors,
	.neg {
		color: var(--neg);
	}
	.ok {
		color: var(--accent);
	}
</style>

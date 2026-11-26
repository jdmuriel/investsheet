<script lang="ts">
	import { page } from '$app/state';
	import { MONTH_SHORT } from '#lib/engine/dividends.ts';
	import type { Cell } from '#lib/engine/history.ts';
	import { eur, num, price } from '#lib/format.ts';
	import { link } from './link.ts';
	import type { PageData } from './$types';

	/** Todos los cobros de un valor: un año por fila y los meses en columnas. */
	let { data }: { data: Extract<PageData, { view: 'valor' }> } = $props();
	const ticker = $derived(data.securities.find((s) => s.id === data.securityId)?.ticker ?? '');
	const money = $derived(data.measure === 'neto' ? 'net' : 'gross');
	const max = $derived(Math.max(1, ...data.rows.map((r) => r[money])));
	const show = (c: Cell | null) => (!c ? '' : data.measure === 'dpa' ? price(c.dps, c.currency) : eur(c[money]));
	const tip = (c: Cell | null) => (c ? `${c.shares == null ? '?' : num(c.shares)} acciones × ${price(c.dps, c.currency)} = ${eur(c.gross)} € bruto, ${eur(c.net)} € neto${c.count > 1 ? ` (${c.count} cobros)` : ''}` : undefined);
</script>

<form method="GET" class="filters">
	<input type="hidden" name="cartera" value={data.portfolioId} />
	<input type="hidden" name="vista" value="historial" />
	<input type="hidden" name="ver" value="valor" />
	<label>
		Valor
		<select name="valor" onchange={(ev) => ev.currentTarget.form?.requestSubmit()}>
			<optgroup label="En cartera">
				{#each data.securities.filter((s) => s.held) as s (s.id)}<option value={s.id} selected={s.id === data.securityId}>{s.ticker}</option>{/each}
			</optgroup>
			<optgroup label="Sin posición">
				{#each data.securities.filter((s) => !s.held) as s (s.id)}<option value={s.id} selected={s.id === data.securityId}>{s.ticker}</option>{/each}
			</optgroup>
		</select>
	</label>
	{#if data.securityId != null}<a href="/dividendos/{data.securityId}">Calendario y cambios de {ticker}</a>{/if}
</form>

{#if data.rows.length}
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th class="l">Año</th>
					{#each MONTH_SHORT as m (m)}<th>{m}</th>{/each}
					<th>{data.measure === 'dpa' ? 'Por acción' : 'Total'}</th>
					<th>Acciones</th>
					<th class="l bar-col"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.year)}
					<tr>
						<td class="l"><a href={link(page.url, { ver: 'evolucion', anio: r.year, valor: null })}>{r.year}</a></td>
						{#each r.months as c, i (i)}
							<td title={tip(c)}>
								{#if c}<a href={link(page.url, { ver: 'mes', mes: `${r.year}-${String(i + 1).padStart(2, '0')}`, valor: null })}>{show(c)}</a>{/if}
							</td>
						{/each}
						<td class="total">{data.measure === 'dpa' ? price(r.dps, r.currency) : eur(r[money])}</td>
						<td>{r.shares == null ? '' : num(r.shares)}</td>
						<td class="l bar-col"><span class="bar" style:width="{(r[money] / max) * 100}%"></span></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="muted">
		{data.measure === 'dpa' ? 'Lo cobrado por acción en cada mes, en la moneda del valor.' : `Importes ${data.measure === 'neto' ? 'netos' : 'brutos'} en €.`} Acciones del último cobro del año. Pulsa un importe para ver ese mes valor a valor.
	</p>
{/if}

<style>
	.total {
		font-weight: 600;
	}
	.bar-col {
		min-width: 6rem;
	}
	.bar {
		display: block;
		height: 0.7rem;
		background: var(--accent);
		border-radius: 2px;
		opacity: 0.7;
	}
	td a {
		color: inherit;
		text-decoration: none;
	}
	td a:hover {
		text-decoration: underline;
	}
</style>

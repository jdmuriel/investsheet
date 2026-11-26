<script lang="ts">
	import { MONTH_SHORT } from '#lib/engine/dividends.ts';
	import { eur, num, price } from '#lib/format.ts';
	import type { PageData } from './$types';

	/** Solapa «Calendario previsto»: dividendo por meses de los valores con posición, con las acciones de hoy (RF-16). */
	let { data }: { data: Extract<PageData, { tab: 'calendario' }> } = $props();
	const monthTotals = $derived(MONTH_SHORT.map((_, m) => data.calendar.reduce((a, r) => a + r.monthly[m], 0)));
</script>

<section>
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

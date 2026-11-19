<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const s = $derived(data.security);
	const pct = (fraction: number | null | undefined) => (fraction == null ? '' : String(Math.round(fraction * 1e4) / 100).replace('.', ','));
	/** Lo tecleado si el envío se rechazó, o lo guardado. */
	const value = (key: string, saved: string | number | null | undefined) => String(form?.raw ? (form.raw[key] ?? '') : (saved ?? ''));
	const checked = (key: string, saved: number | undefined) => (form?.raw ? form.raw[key] === '1' : saved !== 0);
</script>

<header class="page">
	<h1>{s ? s.ticker : 'Nuevo valor'}</h1>
	<a href="/ajustes/valores">Volver a Valores</a>
</header>

{#if form?.errors}
	<ul class="errors">
		{#each form.errors as e (e)}<li>{e}</li>{/each}
	</ul>
{/if}

<form method="POST" action="?/guardar">
	<div class="grid">
		<label>
			Ticker
			<input name="ticker" value={value('ticker', s?.ticker)} maxlength="12" required autocapitalize="characters" />
			{#if s && s.uses > 0}<small>Lo usan {s.uses} operaciones y efectos: cambiarlo lo renombra en todas.</small>{/if}
		</label>
		<label>
			Nombre
			<input name="name" value={value('name', s?.name)} />
		</label>
		<label>
			Ticker de precios
			<input name="priceTicker" value={value('priceTicker', s?.priceTicker)} placeholder="BME:SAN" />
			<small>Con el prefijo de mercado que usa la hoja de precios.</small>
		</label>
		<label>
			País
			<input name="country" value={value('country', s?.country)} maxlength="12" />
		</label>
		<label>
			Moneda
			<select name="currency" value={value('currency', s?.currency)}>
				<option value="">—</option>
				{#each data.currencies as c (c)}<option>{c}</option>{/each}
			</select>
		</label>
		<label>
			Sector
			<input name="sector" value={value('sector', s?.sector)} />
		</label>
		<label>
			Supersector
			<input name="supersector" value={value('supersector', s?.supersector)} />
		</label>
		<label>
			Zona
			<input name="zone" value={value('zone', s?.zone)} />
		</label>
		<label>
			<i>Tier</i>
			<input name="tier" value={value('tier', s?.tier)} />
		</label>
		<label>
			Retención en origen (%)
			<input name="whtSourcePct" value={value('whtSourcePct', pct(s?.whtSourcePct))} inputmode="decimal" placeholder="15" />
		</label>
		<label>
			Retención en destino (%)
			<input name="whtDestPct" value={value('whtDestPct', pct(s?.whtDestPct))} inputmode="decimal" placeholder="19" />
			<small>Con las dos se proponen las retenciones al anotar un dividendo.</small>
		</label>
	</div>
	<label class="check"><input type="checkbox" name="reinvest" value="1" checked={checked('reinvest', s?.reinvest)} /> Reinvertir sus dividendos</label>
	<label class="check"><input type="checkbox" name="active" value="1" checked={checked('active', s?.active)} /> Activo (se ofrece al dar de alta movimientos aunque no haya posición)</label>
	<p><button>Guardar</button></p>
</form>

{#if s && s.uses === 0}
	<form method="POST" action="?/borrar" class="delete">
		<p>
			Ningún movimiento usa este valor.
			<button onclick={(e) => confirm(`¿Borrar ${s.ticker} con sus precios y dividendos previstos? No se puede deshacer.`) || e.preventDefault()}>Borrar el valor</button>
		</p>
	</form>
{/if}

<style>
	.page {
		display: flex;
		gap: 1rem;
		align-items: baseline;
		margin-bottom: 0.75rem;
	}
	h1 {
		font-size: 1.3rem;
		margin: 0;
	}
	form {
		max-width: 46rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	label {
		display: grid;
		gap: 0.15rem;
		font-size: 12px;
		color: var(--muted);
		align-content: start;
	}
	label.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: inherit;
		color: inherit;
		margin-bottom: 0.4rem;
	}
	input:not([type='checkbox']),
	select {
		font: inherit;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
	}
	button {
		font: inherit;
		padding: 0.35rem 1rem;
	}
	.errors {
		color: var(--neg);
	}
</style>

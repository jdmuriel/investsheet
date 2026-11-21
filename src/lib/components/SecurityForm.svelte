<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import type { SecurityRecord } from '#lib/server/masters.ts';

	// Formulario de alta y edición de un valor; lo usan su página y la ventana emergente (`SecurityDialog`).
	interface Props {
		security: SecurityRecord | null;
		currencies: readonly string[];
		zones: readonly string[];
		tiers: readonly string[];
		/** Ruta del valor (`/ajustes/valores/5` o `/ajustes/valores/nuevo`): las acciones se envían ahí. */
		action: string;
		back?: string | null;
		/** Lo tecleado y los errores de un envío rechazado sin JavaScript. */
		failed?: { errors: string[]; raw: Record<string, string> | null } | null;
		/** Si se da, al guardar o borrar se llama con el destino en vez de navegar a él. */
		ondone?: (location: string) => void;
	}
	let { security: s, currencies, zones, tiers, action, back = null, failed = null, ondone }: Props = $props();

	// svelte-ignore state_referenced_locally
	let errors = $state<string[] | null>(failed?.errors ?? null);
	// svelte-ignore state_referenced_locally
	let raw = $state<Record<string, string> | null>(failed?.raw ?? null);

	const submit: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'failure') {
			errors = (result.data?.errors as string[]) ?? null;
			raw = (result.data?.raw as Record<string, string> | null) ?? raw;
		} else if (result.type === 'redirect' && ondone) ondone(result.location);
		else await update();
	};

	const num4 = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 1e4) / 1e4).replace('.', ','));
	const pct = (fraction: number | null | undefined) => (fraction == null ? '' : String(Math.round(fraction * 1e4) / 100).replace('.', ','));
	/** Lo tecleado si el envío se rechazó, o lo guardado. */
	const value = (key: string, saved: string | number | null | undefined) => String(raw ? (raw[key] ?? '') : (saved ?? ''));
	const checked = (key: string, saved: number | undefined) => (raw ? raw[key] === '1' : saved !== 0);
</script>

{#if errors}
	<ul class="errors">
		{#each errors as e (e)}<li>{e}</li>{/each}
	</ul>
{/if}

<form method="POST" action="{action}?/guardar{back ? `&volver=${encodeURIComponent(back)}` : ''}" use:enhance={submit}>
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
				{#each currencies as c (c)}<option>{c}</option>{/each}
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
			<select name="zone" value={value('zone', s?.zone)}>
				<option value="">—</option>
				{#each zones as z (z)}<option>{z}</option>{/each}
			</select>
			<small>España, EE. UU. o resto del mundo: decide la lista de la selección y su inversión máxima.</small>
		</label>
		<label>
			<i>Tier</i>
			<select name="tier" value={value('tier', s?.tier)}>
				<option value="">Sin tier</option>
				{#each tiers as t (t)}<option>{t}</option>{/each}
			</select>
		</label>
		<label>
			Precio objetivo
			<input name="targetPrice" value={value('targetPrice', num4(s?.targetPrice))} inputmode="decimal" />
			<small>En la moneda del valor.</small>
		</label>
		<label>
			Dividendo anual estimado
			<input name="dividendEstimate" value={value('dividendEstimate', num4(s?.dividendEstimate))} inputmode="decimal" />
			<small>Por acción y en su moneda. Solo se usa para la RPD si el valor no tiene calendario de dividendos.</small>
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
	<form method="POST" action="{action}?/borrar" class="delete" use:enhance={submit}>
		<p>
			Ningún movimiento usa este valor.
			<button onclick={(e) => confirm(`¿Borrar ${s.ticker} con sus precios y dividendos previstos? No se puede deshacer.`) || e.preventDefault()}>Borrar el valor</button>
		</p>
	</form>
{/if}

<style>
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

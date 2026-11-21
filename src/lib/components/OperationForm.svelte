<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { parseDecimal, parseInput, type RawInput } from '#lib/engine/form.ts';
	import { buildOperation, isOperationType, OPERATION_TYPES, typeDefinition, type FieldName, type OperationType } from '#lib/engine/operations.ts';
	import { MICRO } from '#lib/engine/types.ts';
	import { eur, num } from '#lib/format.ts';

	interface Props {
		accounts: { id: number; code: string; name: string; currency: string; closed?: number }[];
		securities: { id: number; ticker: string; name: string | null; currency: string | null; whtSourcePct: number | null; whtDestPct: number | null; active?: number }[];
		/** Acciones por valor y saldo por cuenta, sin contar la operación que se edita. */
		holdings: Record<number, number>;
		balances: Record<number, number>;
		initial: RawInput;
		/** Resultado de un envío rechazado. */
		rejected?: { errors: string[]; warnings: string[]; raw?: RawInput } | null;
		/** Operación importada: sus efectos se conservan salvo que se marque recalcular. */
		imported?: boolean;
		/** Tipo con formulario; los tipos antiguos sin él solo admiten cambiar fecha, descripción y notas. */
		supported?: boolean;
		action?: string;
		allowAnother?: boolean;
		/** Copia de otra operación: se adapta a la posición actual y los importes derivados se recalculan. */
		duplicate?: boolean;
		/** Envío sin recargar la página (ventana emergente): quien lo da decide qué hacer con la respuesta. */
		submit?: SubmitFunction;
	}
	let { accounts, securities, holdings, balances, initial, rejected = null, imported = false, supported = true, action = '', allowAnother = false, duplicate = false, submit }: Props = $props();
	const enhanceIf = (node: HTMLFormElement, fn: SubmitFunction | undefined) => (fn ? enhance(node, fn) : undefined);

	const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'DKK', 'SEK', 'NOK'];
	const NEW = 'nuevo';
	const PREVIEW_ID = 2 ** 40;

	// svelte-ignore state_referenced_locally
	const start: RawInput = { ...initial, ...(rejected?.raw ?? {}) };
	let raw = $state<RawInput>({
		type: 'DIVIDENDOS', date: '', account: '', toAccount: '', security: '', toSecurity: '', newTicker: '', newToTicker: '', quantity: '', price: '', currency: '', fxRate: '',
		amount: '', amountTo: '', whtSource: '', whtDest: '', fees: '', cashTotal: '', ratioNew: '', ratioOld: '', sharesAfter: '', costMoved: '', description: '', notes: '',
		...start
	});
	// svelte-ignore state_referenced_locally
	let recalc = $state(supported && (!imported || (rejected?.raw != null && rejected.raw.keepEffects !== '1')));
	// svelte-ignore state_referenced_locally
	let whtTouched = $state(Boolean(start.whtSource || start.whtDest));

	const type = $derived(isOperationType(raw.type) ? (raw.type as OperationType) : null);
	const fields = $derived(type && recalc ? (Object.entries(typeDefinition(type).fields) as [FieldName, string][]) : []);
	const has = (field: FieldName) => fields.some(([f]) => f === field);
	const account = $derived(accounts.find((a) => String(a.id) === raw.account));
	const toAccount = $derived(accounts.find((a) => String(a.id) === raw.toAccount));
	const security = $derived(securities.find((s) => String(s.id) === raw.security));
	const currency = $derived((has('currency') && raw.currency) || account?.currency || 'EUR');
	const needsFx = $derived(recalc && type !== 'CAMBIO' && currency !== 'EUR');
	const held = $derived(security ? (holdings[security.id] ?? 0) : 0);
	const computedAmount = $derived.by(() => {
		const q = parseDecimal(raw.quantity);
		const p = parseDecimal(raw.price);
		return q && p ? Math.round(q * p * 100) / 100 : null;
	});
	const text = (n: number) => n.toFixed(2).replace('.', ',');

	/** Porcentajes de retención de la operación copiada, cuando difieren de los del valor. */
	let copiedRates = $state<{ source: number; dest: number } | null>(null);
	// svelte-ignore state_referenced_locally
	if (duplicate && !rejected) {
		// Lo que salía de una cuenta (acciones × dividendo, retención por porcentaje) vuelve a calcularse solo al tocar los campos.
		const amount = parseDecimal(raw.amount);
		const sameAmount = amount != null && computedAmount != null && Math.abs(amount - computedAmount) < 0.006;
		if (type === 'DIVIDENDOS' && security && amount) {
			// Si las retenciones copiadas no son las del valor (cada broker retiene distinto), se mantiene su proporción.
			const matches = (value: string, pct: number | null) => Math.abs((parseDecimal(value) ?? 0) - amount * (pct ?? 0)) < 0.011;
			const rate = (value: string) => Math.round(((parseDecimal(value) ?? 0) / amount) * 1000) / 1000;
			if (!(matches(raw.whtSource, security.whtSourcePct) && matches(raw.whtDest, security.whtDestPct))) copiedRates = { source: rate(raw.whtSource), dest: rate(raw.whtDest) };
			whtTouched = false;
		}
		if (sameAmount) raw.amount = '';
		// Los gastos de una renta suelen ser el ajuste de céntimos de aquel cobro: no se copian.
		if (type === 'DIVIDENDOS' || type === 'INTERESES') raw.fees = raw.cashTotal = '';
		if (type === 'DIVIDENDOS' && held > 0 && raw.quantity) {
			raw.quantity = String(held / MICRO).replace('.', ',');
			suggestWithholding();
		}
	}

	// Tipo de cambio: se puede teclear al revés (euros por unidad de la moneda), pero siempre se guarda «moneda por euro».
	const FX_KEY = 'tipo-de-cambio-inverso';
	const invert = (value: string) => {
		const n = parseDecimal(value);
		return n && Number.isFinite(n) && n > 0 ? String(Math.round(1e9 / n) / 1e9).replace('.', ',') : '';
	};
	let fxInverse = $state(false);
	// svelte-ignore state_referenced_locally
	let fxText = $state(raw.fxRate);
	function setFxInverse(value: boolean) {
		if (value === fxInverse) return;
		fxInverse = value;
		fxText = value ? invert(raw.fxRate) : raw.fxRate;
		try {
			localStorage.setItem(FX_KEY, value ? '1' : '');
		} catch {
			// Sin almacenamiento local solo se pierde la preferencia.
		}
	}
	function fxTyped() {
		raw.fxRate = fxInverse ? invert(fxText) : fxText;
	}
	$effect(() => {
		try {
			if (localStorage.getItem(FX_KEY) === '1') setFxInverse(true);
		} catch {
			// Igual que arriba.
		}
	});

	// Cambio oficial de la fecha (RF-03): se sugiere y, si el campo está vacío, se rellena; siempre se puede cambiar.
	let fxOfficial = $state<{ rate: number; date: string } | null>(null);
	const fxOfficialText = $derived(fxOfficial ? String(fxOfficial.rate).replace('.', ',') : '');
	function useOfficial() {
		if (!fxOfficial) return;
		raw.fxRate = fxOfficialText;
		fxText = fxInverse ? invert(raw.fxRate) : raw.fxRate;
	}
	$effect(() => {
		const [moneda, fecha] = [currency, raw.date];
		fxOfficial = null;
		if (!needsFx || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
		let stale = false;
		fetch(`/movimientos/cambio?moneda=${moneda}&fecha=${fecha}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((found: { rate: number; date: string } | null) => {
				if (stale || !found) return;
				fxOfficial = found;
				if (!raw.fxRate) useOfficial();
			})
			.catch(() => {
				// Sin sugerencia: el cambio se teclea a mano, como siempre.
			});
		return () => {
			stale = true;
		};
	});

	function securityChanged() {
		if (!security) return;
		copiedRates = null;
		if (has('currency')) raw.currency = security.currency ?? account?.currency ?? 'EUR';
		if (type === 'DIVIDENDOS' && !raw.quantity && held > 0) raw.quantity = String(held / MICRO).replace('.', ',');
		suggestWithholding();
	}
	function accountChanged() {
		if (has('currency') && !raw.currency) raw.currency = account?.currency ?? 'EUR';
	}
	/** Retenciones del dividendo según los porcentajes del valor, mientras no se hayan tecleado. */
	function suggestWithholding() {
		if (type !== 'DIVIDENDOS' || whtTouched || !security) return;
		const amount = parseDecimal(raw.amount) ?? computedAmount;
		if (!amount) return;
		const source = copiedRates?.source ?? security.whtSourcePct;
		const dest = copiedRates?.dest ?? security.whtDestPct;
		raw.whtSource = source ? text(amount * source) : '';
		raw.whtDest = dest ? text(amount * dest) : '';
	}

	// Vista previa: el mismo generador que usa el servidor, con los saldos y acciones actuales.
	const preview = $derived.by(() => {
		if (!type || !recalc) return null;
		const copy: RawInput = { ...raw };
		const preview_securities = new Map(securities.map((s) => [s.id, s as { ticker: string }]));
		if (copy.security === NEW) {
			copy.security = String(PREVIEW_ID);
			preview_securities.set(PREVIEW_ID, { ticker: raw.newTicker.toUpperCase() || 'NUEVO' });
		}
		if (copy.toSecurity === NEW) {
			copy.toSecurity = String(PREVIEW_ID + 1);
			preview_securities.set(PREVIEW_ID + 1, { ticker: raw.newToTicker.toUpperCase() || 'NUEVO' });
		}
		const { input, errors } = parseInput(copy);
		if (!input) return { errors, operation: null };
		const result = buildOperation(input, { accounts: new Map(accounts.map((a) => [a.id, a])), securities: preview_securities, sharesHeld: (id) => holdings[id] ?? 0 });
		return result.ok ? { errors: [], operation: result.operation } : { errors: result.errors, operation: null };
	});
	const frequent = Object.entries(OPERATION_TYPES).filter(([, d]) => 'frequent' in d && d.frequent);
	const others = Object.entries(OPERATION_TYPES).filter(([, d]) => !('frequent' in d && d.frequent));
</script>

<form method="POST" {action} class="operation" use:enhanceIf={submit}>
	{#if rejected?.errors.length}
		<ul class="errors">
			{#each rejected.errors as e (e)}<li>{e}</li>{/each}
		</ul>
	{/if}
	{#if rejected?.warnings.length}
		<div class="warnings">
			<ul>
				{#each rejected.warnings as w (w)}<li>{w}</li>{/each}
			</ul>
			{#if !rejected.errors.length}
				<label class="check"><input type="checkbox" name="confirm" value="1" required /> Guardar de todos modos</label>
			{/if}
		</div>
	{/if}

	<div class="grid">
		<label>
			Tipo
			{#if supported}
				<select name="type" bind:value={raw.type} disabled={!recalc}>
					<optgroup label="Frecuentes">
						{#each frequent as [code, d] (code)}<option value={code}>{d.label}</option>{/each}
					</optgroup>
					<optgroup label="Otros">
						{#each others as [code, d] (code)}<option value={code}>{d.label}</option>{/each}
					</optgroup>
				</select>
			{:else}
				<input value={raw.type} disabled />
			{/if}
			{#if !recalc}<input type="hidden" name="type" value={raw.type} />{/if}
		</label>
		<label>
			Fecha
			<input type="date" name="date" bind:value={raw.date} required />
		</label>
	</div>

	{#if imported}
		<p class="note">
			Operación importada de la hoja antigua: al guardar solo cambian la fecha, la descripción y las notas, y sus efectos se conservan tal como se importaron.
		</p>
		{#if supported}
			<label class="check"><input type="checkbox" bind:checked={recalc} /> Recalcular sus efectos con el formulario (revisa antes los campos propuestos)</label>
		{/if}
		{#if !recalc}<input type="hidden" name="keepEffects" value="1" />{/if}
	{/if}

	{#if fields.length}
		<div class="grid">
			{#each fields as [field, label] (field)}
				{#if field === 'account' || field === 'toAccount'}
					<label>
						{label}
						<select name={field} bind:value={raw[field]} onchange={accountChanged}>
							<option value="">—</option>
							{#each accounts.filter((a) => !a.closed || String(a.id) === raw[field]) as a (a.id)}<option value={String(a.id)}>{a.name} ({a.currency})</option>{/each}
						</select>
						{#if field === 'account' && account}<small>Saldo actual: {eur(balances[account.id] ?? 0)} {account.currency}</small>{/if}
					</label>
				{:else if field === 'security' || field === 'toSecurity'}
					{@const tickerField = field === 'security' ? 'newTicker' : 'newToTicker'}
					<label>
						{label}
						<select name={field} bind:value={raw[field]} onchange={field === 'security' ? securityChanged : undefined}>
							<option value="">—</option>
							<option value={NEW}>Valor nuevo…</option>
							{#each securities.filter((s) => s.active !== 0 || holdings[s.id] || String(s.id) === raw[field]) as s (s.id)}<option value={String(s.id)}>{s.ticker}{s.name ? ` · ${s.name}` : ''}</option>{/each}
						</select>
						{#if raw[field] === NEW}
							<input name={tickerField} bind:value={raw[tickerField]} placeholder="Ticker" maxlength="12" autocapitalize="characters" />
						{:else if field === 'security' && security}
							<small>En cartera: {num(held / MICRO)} acciones</small>
						{/if}
					</label>
				{:else if field === 'currency'}
					<label>
						{label}
						<select name="currency" bind:value={raw.currency}>
							{#each CURRENCIES as c (c)}<option>{c}</option>{/each}
						</select>
					</label>
				{:else if field === 'ratio'}
					<label>
						{label}
						<span class="ratio">
							<input name="ratioNew" bind:value={raw.ratioNew} inputmode="decimal" placeholder="nuevas" />
							por cada
							<input name="ratioOld" bind:value={raw.ratioOld} inputmode="decimal" placeholder="antiguas" />
						</span>
					</label>
				{:else}
					<label>
						{label}
						<input
							name={field}
							bind:value={raw[field]}
							inputmode="decimal"
							autocomplete="off"
							placeholder={field === 'amount' && computedAmount != null ? text(computedAmount) : ''}
							oninput={field === 'whtSource' || field === 'whtDest' ? () => (whtTouched = true) : suggestWithholding}
						/>
						{#if (field === 'amount' || field === 'whtSource' || field === 'whtDest') && (type !== 'CAMBIO' || account)}<small>en {type === 'CAMBIO' ? account?.currency : currency}</small>{/if}
						{#if field === 'fees' && type !== 'CAMBIO' && account}<small>en {account.currency}</small>{/if}
						{#if field === 'amountTo' && toAccount}<small>en {toAccount.currency}</small>{/if}
						{#if field === 'cashTotal'}<small>si se indica, los gastos son la diferencia</small>{/if}
					</label>
				{/if}
			{/each}
			{#if needsFx}
				<label>
					Tipo de cambio
					<span class="fx">
						<input bind:value={fxText} oninput={fxTyped} inputmode="decimal" autocomplete="off" required aria-label="Tipo de cambio, {fxInverse ? `euros por ${currency}` : `${currency} por euro`}" />
						<button type="button" onclick={() => setFxInverse(!fxInverse)} title="Teclear el cambio al revés">⇄ {fxInverse ? `EUR por ${currency}` : `${currency} por EUR`}</button>
					</span>
					<input type="hidden" name="fxRate" value={raw.fxRate} />
					<small>
						{#if fxInverse}euros por {currency}; se guarda {raw.fxRate || '…'} {currency} por euro{:else}{currency} por euro{/if}
						{#if fxOfficial}
							· cambio de referencia del {fxOfficial.date.slice(8, 10)}/{fxOfficial.date.slice(5, 7)}: {fxOfficialText}
							{#if raw.fxRate !== fxOfficialText}<button type="button" class="hint" onclick={useOfficial}>usar</button>{/if}
						{/if}
					</small>
				</label>
			{/if}
		</div>
	{/if}

	<div class="grid wide">
		<label>
			Descripción
			<input name="description" bind:value={raw.description} placeholder={preview?.operation?.description ?? ''} />
			{#if recalc}<small>vacía: se genera sola</small>{/if}
		</label>
		<label>
			Notas
			<input name="notes" bind:value={raw.notes} />
		</label>
	</div>

	{#if preview}
		<section class="preview">
			{#if preview.operation}
				{@const op = preview.operation}
				<strong>{op.description}</strong>
				<dl>
					{#each op.cash as leg (leg.accountId)}
						{@const a = accounts.find((x) => x.id === leg.accountId)}
						<div>
							<dt>{a?.name}</dt>
							<dd class:neg={leg.amount < 0}>{leg.amount > 0 ? '+' : ''}{eur(leg.amount)} {a?.currency}</dd>
							<dd class="after" class:neg={(balances[leg.accountId] ?? 0) + leg.amount < 0}>saldo {eur((balances[leg.accountId] ?? 0) + leg.amount)}</dd>
						</div>
					{/each}
					{#if op.grossEur}<div><dt>Bruto</dt><dd>{eur(op.grossEur)} EUR</dd></div>{/if}
					{#if op.taxEur}<div><dt>Retenciones</dt><dd>{eur(op.taxEur)} EUR</dd></div>{/if}
					{#if op.feesEur}<div><dt>Gastos</dt><dd>{eur(op.feesEur)} EUR</dd></div>{/if}
					{#if op.purchaseEur}<div><dt>{op.purchaseEur > 0 ? 'Compra' : 'Venta'}</dt><dd>{eur(Math.abs(op.purchaseEur))} EUR</dd></div>{/if}
					{#if op.capitalInEur || op.capitalOutEur}<div><dt>Capital</dt><dd>{eur(op.capitalInEur - op.capitalOutEur)} EUR</dd></div>{/if}
					{#if op.grossEur || op.taxEur || op.feesEur}<div><dt>Resultado</dt><dd class:neg={op.grossEur - op.taxEur - op.feesEur < 0}>{eur(op.grossEur - op.taxEur - op.feesEur)} EUR</dd></div>{/if}
					{#each op.positions as leg, i (i)}
						{@const s = securities.find((x) => x.id === leg.securityId)}
						<div>
							<dt>{s?.ticker ?? 'Valor nuevo'}</dt>
							<dd>
								{#if leg.kind === 'sell'}−{num(leg.shares / MICRO)} acciones{:else if leg.kind === 'convert'}pasa al valor nuevo{:else}
									{#if leg.shares}{leg.shares > 0 ? '+' : ''}{num(leg.shares / MICRO)} acciones{/if}
									{#if leg.cost}coste {leg.cost > 0 ? '+' : ''}{eur(leg.cost)} EUR{:else if leg.reducedCost}coste reducido {eur(leg.reducedCost)} EUR{/if}
								{/if}
							</dd>
						</div>
					{/each}
				</dl>
				<small>Saldos calculados con el registro actual; si la operación no es la última, el saldo de su fila será otro.</small>
			{:else}
				<span class="pending">{preview.errors[0]}</span>
			{/if}
		</section>
	{/if}

	<div class="buttons">
		<button class="primary">Guardar</button>
		{#if allowAnother}<button name="next" value="otra">Guardar y añadir otra</button>{/if}
	</div>
</form>

<style>
	.operation {
		display: grid;
		gap: 0.9rem;
		max-width: 46rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: 0.7rem 1rem;
	}
	.grid.wide {
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
	}
	label {
		display: grid;
		gap: 0.2rem;
		font-size: 12px;
		color: var(--muted);
		align-content: start;
	}
	label.check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 14px;
		color: var(--fg);
	}
	select,
	input:not([type='checkbox']) {
		font: inherit;
		font-size: 16px;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--bg);
		color: var(--fg);
		min-width: 0;
		box-sizing: border-box;
		width: 100%;
	}
	select:disabled,
	input:disabled {
		color: var(--muted);
		background: var(--soft);
	}
	small {
		color: var(--muted);
	}
	.fx {
		display: flex;
		gap: 0.4rem;
	}
	button.hint {
		font: inherit;
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}
	.fx button {
		padding: 0.3rem 0.5rem;
		font-size: 12px;
		white-space: nowrap;
	}
	.ratio {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		white-space: nowrap;
	}
	.note {
		margin: 0;
		color: var(--muted);
	}
	.errors,
	.warnings {
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 6px;
		border: 1px solid var(--neg);
	}
	.errors {
		color: var(--neg);
		list-style: none;
	}
	.warnings ul {
		margin: 0 0 0.5rem;
		padding: 0;
		list-style: none;
	}
	.preview {
		display: grid;
		gap: 0.5rem;
		padding: 0.7rem 0.9rem;
		background: var(--soft);
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	dl {
		display: grid;
		gap: 0.2rem;
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	dl div {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	dt {
		color: var(--muted);
		min-width: 8rem;
	}
	dd {
		margin: 0;
	}
	dd.after {
		color: var(--muted);
	}
	.neg,
	dd.after.neg {
		color: var(--neg);
	}
	.pending {
		color: var(--muted);
	}
	.buttons {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	button {
		font: inherit;
		padding: 0.45rem 1rem;
		border-radius: 4px;
		border: 1px solid var(--line);
		background: var(--bg);
		color: var(--fg);
		cursor: pointer;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--bg);
		font-weight: 600;
	}
</style>

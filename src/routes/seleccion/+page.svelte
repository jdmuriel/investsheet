<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import PriceChart from '#lib/components/PriceChart.svelte';
	import SecurityDialog from '#lib/components/SecurityDialog.svelte';
	import { lastMonths, purchasesIn, reviewVariations, type ReviewVariation } from '#lib/engine/selection.ts';
	import { date, eurWhole, kilo, pct, price } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	type Item = (typeof data.lists)[number]['rows'][number];

	// Orden de trabajo de cada lista: se cambia arrastrando o con las flechas y se guarda con un botón.
	// Al recargar los datos (editar un valor, quitarlo, añadir otro) se conserva el orden sin guardar: los valores
	// que siguen en su lista quedan donde estaban y los que llegan entran en el puesto que trae el servidor.
	let order = $state<Record<string, number[]>>({});
	$effect(() => {
		const lists = data.lists;
		const prev = untrack(() => order);
		order = Object.fromEntries(
			lists.map((l) => {
				const ids = l.rows.map((r) => r.id);
				const kept = (prev[l.key] ?? []).filter((id) => ids.includes(id));
				ids.forEach((id, i) => kept.includes(id) || kept.splice(Math.min(i, kept.length), 0, id));
				return [l.key, kept];
			})
		);
	});
	const byId = $derived(new Map(data.lists.flatMap((l) => l.rows).map((r) => [r.id, r])));
	const rowsOf = (key: string) => (order[key] ?? []).map((id) => byId.get(id)).filter((r): r is Item => r != null);
	const dirty = $derived(data.lists.some((l) => (order[l.key] ?? []).join() !== l.rows.map((r) => r.id).join()));
	const allIds = $derived(data.lists.flatMap((l) => order[l.key] ?? []).join(','));

	function move(key: string, from: number, to: number) {
		const ids = [...(order[key] ?? [])];
		if (to < 0 || to >= ids.length) return;
		const [id] = ids.splice(from, 1);
		ids.splice(to, 0, id);
		order[key] = ids;
	}
	let dragging: { key: string; index: number } | null = null;
	/** Hueco donde caería la fila arrastrada: 0 es antes de la primera, `n` después de la fila `n - 1`. */
	let dropGap = $state<{ key: string; gap: number } | null>(null);
	function dragOver(e: DragEvent, key: string, index: number, detail: boolean) {
		if (dragging?.key !== key) return;
		e.preventDefault();
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const gap = detail || e.clientY > box.top + box.height / 2 ? index + 1 : index;
		if (dropGap?.key !== key || dropGap.gap !== gap) dropGap = { key, gap };
	}
	function drop(e: DragEvent, key: string) {
		e.preventDefault();
		if (dragging?.key === key && dropGap?.key === key) {
			const to = dropGap.gap > dragging.index ? dropGap.gap - 1 : dropGap.gap;
			move(key, dragging.index, to);
		}
		dragEnd();
	}
	function dragEnd() {
		dragging = null;
		dropGap = null;
	}
	const dropAfter = (key: string, i: number) => dropGap?.key === key && dropGap.gap === i + 1;

	let copied = $state('');
	async function copy(text: string, what: string) {
		await navigator.clipboard.writeText(text);
		copied = what;
		setTimeout(() => (copied = ''), 1500);
	}
	const listText = (key: string) => rowsOf(key).map((r) => r.summary).join('\n');
	const allText = $derived(data.lists.map((l) => `${l.label}\n${listText(l.key)}`).join('\n\n'));

	// Valores con el gráfico de evolución desplegado.
	let open = $state(new Set<number>());
	function toggle(id: number) {
		const next = new Set(open);
		if (!next.delete(id)) next.add(id);
		open = next;
	}
	// Manejo con el teclado: j y k cambian de fila, Ctrl+j y Ctrl+k la mueven, c copia su línea y g abre su gráfico.
	let selected = $state<number | null>(null);
	const flat = $derived(data.lists.flatMap((l) => order[l.key] ?? []));
	async function reveal(id: number) {
		await tick();
		document.getElementById(`fila-${id}`)?.scrollIntoView({ block: 'nearest' });
	}
	// Ficha del valor en ventana emergente, para no salir de la página y perder el orden sin guardar.
	let editing = $state<number | null>(null);
	function edit(e: MouseEvent, id: number) {
		if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
		e.preventDefault();
		selected = id;
		editing = id;
	}

	function onKey(e: KeyboardEvent) {
		if (editing != null || e.altKey || e.metaKey || e.defaultPrevented) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
		const k = e.key.toLowerCase();
		if (k === 'escape') return void (selected = null);
		if (!['j', 'k', 'c', 'g', 'e'].includes(k)) return;
		if (e.ctrlKey && k !== 'j' && k !== 'k') return;
		const row = selected == null ? null : byId.get(selected);
		if (k === 'j' || k === 'k') {
			e.preventDefault();
			const step = k === 'j' ? 1 : -1;
			if (!row) {
				if (e.ctrlKey || !flat.length) return;
				selected = step > 0 ? flat[0] : flat[flat.length - 1];
			} else if (e.ctrlKey) {
				const ids = order[row.list] ?? [];
				const i = ids.indexOf(row.id);
				move(row.list, i, i + step);
			} else {
				const i = flat.indexOf(row.id);
				selected = flat[Math.min(Math.max(i + step, 0), flat.length - 1)];
			}
			if (selected != null) reveal(selected);
			return;
		}
		if (!row) return;
		e.preventDefault();
		if (k === 'c') copy(row.summary, `l${row.id}`);
		else if (k === 'e') editing = row.id;
		else if (lastMonths(row.history, 60).length > 1) {
			toggle(row.id);
			reveal(row.id);
		}
	}

	const toneClass = (tone: string | null) => (tone ? tone.replace(' ', '-') : '');

	/** Variaciones de revisión a revisión en filas de doce, para la tabla bajo el gráfico grande. */
	const chunks = (vs: ReviewVariation[]) => Array.from({ length: Math.ceil(vs.length / 12) }, (_, k) => vs.slice(k * 12, k * 12 + 12));
	const monthLabel = (v: ReviewVariation) => (v.today ? 'hoy' : `${v.date.slice(5, 7)}/${v.date.slice(2, 4)}`);

	const signedPct = (v: number | null) => (v == null ? '' : `${v > 0 ? '+' : ''}${pct(v)}`);
	const p = $derived(data.params);
	const pctInput = (v: number) => String(Math.round(v * 1e4) / 100).replace('.', ',');
	const kInput = (v: number) => String(v).replace('.', ',');
</script>

<svelte:window onkeydown={onKey} />

{#if editing != null}
	<SecurityDialog security={editing} onclose={() => (editing = null)} onsaved={() => selected != null && reveal(selected)} />
{/if}

<header class="page">
	<h1>Selección</h1>
	<p class="muted">
		{#if data.lastReview}Variación desde la revisión del {date(data.lastReview.date)}.{:else}Sin revisiones anteriores.{/if}
		<button type="button" class="link" onclick={() => copy(allText, 'todo')}>{copied === 'todo' ? 'Copiado' : 'Copiar todas las líneas'}</button>
	</p>
	<p class="muted keys">Pulsa una fila para seleccionarla. Teclado: <kbd>j</kbd> <kbd>k</kbd> fila siguiente o anterior, <kbd>Ctrl</kbd>+<kbd>j</kbd> <kbd>Ctrl</kbd>+<kbd>k</kbd> bajarla o subirla, <kbd>c</kbd> copiar su línea, <kbd>g</kbd> ver u ocultar su gráfico, <kbd>e</kbd> editar el valor, <kbd>Esc</kbd> quitar la selección.</p>
</header>

{#if form?.errors}
	<ul class="errors">{#each form.errors as e (e)}<li>{e}</li>{/each}</ul>
{:else if form?.saved === 'cerrar'}
	<p class="ok">Revisión cerrada con el precio de {form.items} valores.</p>
{/if}

<form method="POST" action="?/orden" use:enhance class="save" class:visible={dirty}>
	<input type="hidden" name="ids" value={allIds} />
	<span>Has cambiado el orden.</span>
	<button>Guardar el orden</button>
	<button type="button" onclick={() => (order = Object.fromEntries(data.lists.map((l) => [l.key, l.rows.map((r) => r.id)])))}>Deshacer</button>
</form>

{#each data.lists as list (list.key)}
	{@const rows = rowsOf(list.key)}
	<section>
		<h2>
			{list.label} <span class="muted">({rows.length})</span>
			{#if rows.length}<button type="button" class="link" onclick={() => copy(listText(list.key), list.key)}>{copied === list.key ? 'Copiada' : 'Copiar la lista'}</button>{/if}
		</h2>
		{#if rows.length}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th></th>
							<th class="l">Valor</th>
							<th><i>Tier</i></th>
							<th title="Coste reducido de la posición, en naranja cerca del máximo por tier y zona y en rojo por encima">Invertido</th>
							<th title="Dividendo bruto anual sobre el precio de hoy">RPD</th>
							<th>Precio</th>
							<th>Objetivo</th>
							<th title="Precio sobre objetivo">Distancia</th>
							<th title="Desde la última revisión">Var.</th>
							<th class="l" title="Precio en cada revisión; pulsa para ver el gráfico">Evolución</th>
							<th class="l">Línea</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r, i (r.id)}
							{@const small = lastMonths(r.history, 24)}
							{@const big = lastMonths(r.history, 60)}
							{@const vars = open.has(r.id) ? reviewVariations(r.history, p) : []}
							<tr
								id="fila-{r.id}"
								draggable="true"
								class:selected={selected === r.id}
								class:drop-before={dropGap?.key === list.key && dropGap.gap === 0 && i === 0}
								class:drop-after={dropAfter(list.key, i) && !open.has(r.id)}
								onclick={() => (selected = r.id)}
								ondragstart={() => {
									dragging = { key: list.key, index: i };
									selected = r.id;
								}}
								ondragover={(e) => dragOver(e, list.key, i, false)}
								ondrop={(e) => drop(e, list.key)}
								ondragend={dragEnd}
							>
								<td class="handle">
									<span class="muted pos">{i + 1}</span>
									<button type="button" title="Subir" onclick={() => move(list.key, i, i - 1)} disabled={i === 0}>↑</button>
									<button type="button" title="Bajar" onclick={() => move(list.key, i, i + 1)} disabled={i === rows.length - 1}>↓</button>
								</td>
								<th class="l" scope="row"><a href="/ajustes/valores/{r.id}?volver=/seleccion" onclick={(e) => edit(e, r.id)} title={[r.name, r.country].filter(Boolean).join(' · ')}>{r.ticker}</a></th>
								<td>{r.tier ?? ''}</td>
								<td class:warn={r.status === 'cerca'} class:neg={r.status === 'superado'} title={r.max == null ? undefined : `${r.status === 'cerca' ? 'Cerca del máximo' : r.status === 'superado' ? 'Por encima del máximo' : 'Máximo'}: ${eurWhole(r.max)}`}>{kilo(r.invested, true)}</td>
								<td class:high={r.rpd != null && r.rpd > 0.05} title={r.rpd != null && r.rpd > 0.05 ? 'Más del 5 %' : undefined}>{pct(r.rpd)}</td>
								<td title={r.priceDate ? `Precio del ${date(r.priceDate)}` : 'Sin precio'}>{price(r.price, r.currency)}</td>
								<td>{price(r.target, r.currency)}</td>
								<td>{signedPct(r.distance)}</td>
								<td class="var {toneClass(r.tone)}" title={r.tone ? `${r.description[0].toUpperCase()}${r.description.slice(1)}` : undefined}>{signedPct(r.variation)}</td>
								<td class="l evo">
									{#if small.length > 1}
										<button type="button" class="spark" aria-expanded={open.has(r.id)} title="{open.has(r.id) ? 'Ocultar' : 'Ver'} la evolución del precio de {r.ticker}" onclick={() => toggle(r.id)}>
											<PriceChart small points={small} purchases={purchasesIn(r.purchases, small)} tone={r.tone} label="Evolución del precio de {r.ticker}" />
										</button>
									{/if}
								</td>
								<td class="l line">
									<div>
										<span>{r.summary}</span>
										<button type="button" class="copy" title="Copiar esta línea (c)" onclick={() => copy(r.summary, `l${r.id}`)}>{copied === `l${r.id}` ? 'copiada' : 'copiar'}</button>
									</div>
								</td>
								<td>
									<form method="POST" action="?/quitar" use:enhance>
										<input type="hidden" name="security" value={r.id} />
										<button title="Quitar de la selección" onclick={(e) => confirm(`¿Quitar ${r.ticker} de la selección?`) || e.preventDefault()}>×</button>
									</form>
								</td>
							</tr>
							{#if open.has(r.id)}
								<tr class="detail" class:drop-after={dropAfter(list.key, i)} ondragover={(e) => dragOver(e, list.key, i, true)} ondrop={(e) => drop(e, list.key)}>
									<td colspan="12">
										<div class="detail-box">
											<p>
												<strong>{r.ticker}</strong>{r.name ? ` · ${r.name}` : ''}
												<span class="muted">· {big.filter((h) => !h.today).length} revisiones desde el {date(big[0].date)}</span>
												<button type="button" class="link" onclick={() => toggle(r.id)}>Cerrar</button>
											</p>
											<PriceChart points={big} purchases={purchasesIn(r.purchases, big)} currency={r.currency} target={r.target} tone={r.tone} label="Evolución del precio de {r.ticker} en las revisiones" />
											{#if vars.length}
												<div class="scroll">
													<table class="vars">
														{#each chunks(vars) as chunk, k (k)}
															<tbody>
																<tr>{#each chunk as v (v.date)}<th title={v.today ? `Hasta hoy, ${date(v.date)}` : `Revisión del ${date(v.date)}`}>{monthLabel(v)}</th>{/each}</tr>
																<tr>{#each chunk as v (v.date)}<td class="var {toneClass(v.tone)}">{signedPct(v.variation)}</td>{/each}</tr>
															</tbody>
														{/each}
													</table>
												</div>
											{/if}
										</div>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="muted">Ningún valor.</p>
		{/if}
	</section>
{/each}

<section class="tools">
	<form method="POST" action="?/anadir" use:enhance>
		<label>
			Añadir a la selección
			<select name="security" required>
				<option value="">—</option>
				{#each data.candidates as c (c.id)}<option value={c.id}>{c.ticker}{c.name ? ` · ${c.name}` : ''}</option>{/each}
			</select>
		</label>
		<button>Añadir</button>
		<small class="muted">Entra al final de la lista que le toca por su zona y tier (se cambian en la ficha del valor).</small>
	</form>
</section>

<section>
	<h2>Cerrar la revisión</h2>
	<p class="muted">Guarda el orden de las listas y el precio de hoy de cada valor: la próxima revisión medirá la variación desde aquí. Cerrarla otra vez el mismo día la sustituye.</p>
	<form method="POST" action="?/cerrar" use:enhance class="review">
		<label>Fecha <input type="date" name="date" value={data.today} max={data.today} /></label>
		<label>Propuestas <textarea name="proposals" rows="3" placeholder="Valores candidatos y por qué"></textarea></label>
		<label>Elección <textarea name="choice" rows="2" placeholder="Qué se compra"></textarea></label>
		<button disabled={dirty} title={dirty ? 'Guarda antes el orden' : undefined}>Cerrar la revisión</button>
	</form>
</section>

{#if data.reviews.length}
	<section>
		<h2>Revisiones</h2>
		<div class="scroll">
			<table class="reviews">
				<thead><tr><th class="l">Fecha</th><th>Valores</th><th class="l">Propuestas y elección</th></tr></thead>
				<tbody>
					{#each data.reviews as rv (rv.id)}
						<tr>
							<th class="l" scope="row">{date(rv.date)}{rv.source === 'legacy' ? ' (hoja)' : ''}</th>
							<td>{rv.items}</td>
							<td class="l">
								<details>
									<summary>{rv.choice ?? rv.proposals ?? 'Sin anotar'}</summary>
									<form method="POST" action="?/notas" use:enhance class="review">
										<input type="hidden" name="review" value={rv.id} />
										<label>Propuestas <textarea name="proposals" rows="3">{rv.proposals ?? ''}</textarea></label>
										<label>Elección <textarea name="choice" rows="2">{rv.choice ?? ''}</textarea></label>
										<button>Guardar</button>
									</form>
								</details>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

<section>
	<details>
		<summary>Parámetros</summary>
		<form method="POST" action="?/parametros" use:enhance class="params">
			<p class="muted">Inversión máxima por valor, en miles de euros.</p>
			<div class="grid">
				{#each ['T1', 'T2', 'T3'] as const as t (t)}
					<label>{t}, resto <input name={t} value={kInput(p.limits[t].other)} inputmode="decimal" /></label>
					<label>{t}, España <input name="{t}E" value={kInput(p.limits[t].spain)} inputmode="decimal" /></label>
				{/each}
				<label>Variación reseñable (%) <input name="significant" value={pctInput(p.significant)} inputmode="decimal" /></label>
				<label>Variación grande (%) <input name="high" value={pctInput(p.high)} inputmode="decimal" /></label>
			</div>
			<button>Guardar</button>
		</form>
	</details>
</section>

<style>
	section {
		margin: 1.5rem 0;
	}
	h2 {
		font-size: 1.1rem;
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.15rem 0.5rem;
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}
	.l {
		text-align: left;
	}
	td.line {
		white-space: normal;
		min-width: 22rem;
	}
	td.line div {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		justify-content: space-between;
	}
	.copy {
		flex: none;
		background: none;
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 0 0.4rem;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		font-size: 0.85em;
	}
	tr[draggable='true'] {
		cursor: grab;
		scroll-margin: 4rem 0 1rem;
	}
	tr.selected > * {
		background: var(--soft);
	}
	tr.selected > :first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}
	/* Raya donde caerá la fila arrastrada. */
	tr.drop-after > * {
		box-shadow: inset 0 -3px 0 var(--accent);
	}
	tr.drop-before > * {
		box-shadow: inset 0 3px 0 var(--accent);
	}
	tr.selected.drop-after > :first-child {
		box-shadow: inset 3px 0 0 var(--accent), inset 0 -3px 0 var(--accent);
	}
	tr.selected.drop-before > :first-child {
		box-shadow: inset 3px 0 0 var(--accent), inset 0 3px 0 var(--accent);
	}
	.keys {
		font-size: 0.85rem;
	}
	kbd {
		font: inherit;
		font-size: 0.9em;
		padding: 0 0.3rem;
		border: 1px solid var(--line);
		border-radius: 3px;
	}
	.handle {
		text-align: left;
	}
	.handle .pos {
		display: inline-block;
		min-width: 1.6em;
		text-align: right;
		margin-right: 0.3rem;
	}
	.handle button {
		background: none;
		border: 1px solid var(--line);
		border-radius: 4px;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		line-height: 1.2;
		padding: 0 0.3rem;
	}
	.handle button:disabled {
		color: var(--muted);
		opacity: 0.4;
		cursor: default;
	}
	td form button {
		border: none;
		background: none;
		cursor: pointer;
		padding: 0 0.2rem;
	}
	td.high {
		font-weight: 700;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	.neg {
		color: var(--neg);
	}
	/* Variación desde la última revisión: verde si sube, rojo si baja; claro si es reseñable, oscuro si es grande. */
	td.var {
		font-weight: 600;
	}
	td.var.sube {
		background: var(--up-soft);
		color: var(--up-fg);
	}
	td.var.baja {
		background: var(--down-soft);
		color: var(--down-fg);
	}
	td.var.sube-fuerte {
		background: var(--up-strong);
		color: var(--on-strong);
	}
	td.var.baja-fuerte {
		background: var(--down-strong);
		color: var(--on-strong);
	}
	td.evo {
		padding-block: 0;
	}
	.spark {
		display: block;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 4px;
		background: none;
		cursor: pointer;
	}
	.spark:hover,
	.spark[aria-expanded='true'] {
		border-color: var(--line);
		background: var(--soft);
	}
	tr.detail > td {
		text-align: left;
		white-space: normal;
		background: var(--soft);
	}
	.detail-box {
		position: sticky;
		left: 0.5rem;
		max-width: min(58rem, calc(100vw - 3rem));
		padding: 0.25rem 0 0.5rem;
	}
	.detail-box p {
		margin: 0 0 0.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: baseline;
	}
	table.vars {
		margin-top: 0.75rem;
		width: auto;
		background: var(--bg);
	}
	table.vars th {
		font-weight: normal;
		color: var(--muted);
		font-size: 0.85em;
		padding-bottom: 0.1rem;
		border-bottom: none;
	}
	table.vars td {
		min-width: 3.2rem;
		padding-inline: 0.4rem;
	}
	table.vars tbody + tbody th {
		padding-top: 0.6rem;
	}
	.warn {
		color: var(--warn, #b26b00);
	}
	.save {
		display: none;
		position: sticky;
		top: 0;
		z-index: 2;
		gap: 0.75rem;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: var(--bg, white);
		border: 1px solid var(--accent);
		border-radius: 6px;
	}
	.save.visible {
		display: flex;
	}
	.review,
	.params,
	.tools form {
		display: grid;
		gap: 0.5rem;
		max-width: 40rem;
	}
	.review label {
		display: grid;
		gap: 0.25rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.5rem;
	}
	.grid label {
		display: grid;
	}
	.ok {
		color: var(--accent);
	}
	.errors {
		color: var(--neg);
	}
</style>

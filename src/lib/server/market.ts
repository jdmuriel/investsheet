/** Precios y tipos de cambio (RF-43 a RF-46): lo guardado, y su puesta al día desde la hoja de precios y el BCE. */
import type { DatabaseSync } from 'node:sqlite';
import { parseDecimal } from '../engine/form.ts';
import { parseEcbXml, parsePriceCsv } from '../engine/market.ts';
import type { Quote } from '../engine/portfolio.ts';

export type PriceSource = 'sheet' | 'manual' | 'legacy';
export interface StoredQuote extends Quote {
	source: PriceSource;
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
const isDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));

export function getSetting(db: DatabaseSync, key: string): string | null {
	return (db.prepare('SELECT value FROM setting WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}
export function setSetting(db: DatabaseSync, key: string, value: string): void {
	db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ---------- Precios ----------

/** Último precio conocido de cada valor. */
export function latestQuotes(db: DatabaseSync): Map<number, StoredQuote> {
	const rows = db
		.prepare('SELECT p.security_id AS id, p.date, p.price, p.currency, p.source FROM price p WHERE p.date = (SELECT max(date) FROM price WHERE security_id = p.security_id)')
		.all() as unknown as ({ id: number } & StoredQuote)[];
	return new Map(rows.map(({ id, ...quote }) => [id, quote]));
}

/**
 * Guarda el precio de un valor en una fecha. Un precio leído de una fuente no pisa uno tecleado
 * a mano ese mismo día: así una corrección manual aguanta hasta el día siguiente.
 */
export function savePrice(db: DatabaseSync, securityId: number, date: string, price: number, currency: string, source: PriceSource): boolean {
	const existing = db.prepare('SELECT source FROM price WHERE security_id = ? AND date = ?').get(securityId, date) as { source: string } | undefined;
	if (existing?.source === 'manual' && source !== 'manual') return false;
	db.prepare(
		`INSERT INTO price (security_id, date, price, currency, source) VALUES (?,?,?,?,?)
		ON CONFLICT (security_id, date) DO UPDATE SET price = excluded.price, currency = excluded.currency, source = excluded.source, fetched_at = datetime('now')`
	).run(securityId, date, price, currency, source);
	return true;
}

export type PriceResult = { ok: true } | { ok: false; errors: string[] };

/** Precio tecleado a mano (RF-46), en la moneda del valor. En blanco borra el precio manual de esa fecha. */
export function saveManualPrice(db: DatabaseSync, securityId: number, fields: { price?: string; date?: string; currency?: string }): PriceResult {
	const security = db.prepare('SELECT ticker, currency FROM security WHERE id = ?').get(securityId) as { ticker: string; currency: string | null } | undefined;
	if (!security) return { ok: false, errors: ['El valor no existe.'] };
	const date = fields.date || today();
	if (!isDate(date) || date > today()) return { ok: false, errors: ['La fecha no es válida.'] };
	if ((fields.price ?? '').trim() === '') {
		db.prepare(`DELETE FROM price WHERE security_id = ? AND date = ? AND source = 'manual'`).run(securityId, date);
		return { ok: true };
	}
	const price = parseDecimal(fields.price);
	if (price == null || !Number.isFinite(price) || price <= 0) return { ok: false, errors: [`El precio de ${security.ticker} no es un número válido.`] };
	const currency = (fields.currency || security.currency || '').trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, errors: [`${security.ticker} no tiene moneda: indícala en Ajustes → Valores.`] };
	savePrice(db, securityId, date, price, currency, 'manual');
	return { ok: true };
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

async function download(fetcher: Fetch, url: string): Promise<string> {
	const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`respuesta ${response.status}`);
	return response.text();
}

export interface RefreshResult {
	ok: boolean;
	updated: number;
	/** Tickers de la hoja que no corresponden a ningún valor. */
	unknown: string[];
	error?: string;
}

/**
 * Lee la pestaña `actual` de la hoja de precios (`PRICES_CSV_URL`) y guarda el precio de cada valor.
 * La hoja identifica los valores por su ticker de precios (`BME:ACME`) o, en su defecto, por el ticker.
 */
export async function refreshPrices(db: DatabaseSync, options: { url?: string; fetch?: Fetch; today?: string } = {}): Promise<RefreshResult> {
	const url = options.url ?? process.env.PRICES_CSV_URL;
	const finish = (result: RefreshResult): RefreshResult => {
		setSetting(db, 'prices_checked_at', new Date().toISOString());
		setSetting(db, 'prices_error', result.error ?? '');
		return result;
	};
	if (!url) return { ok: false, updated: 0, unknown: [], error: 'No hay hoja de precios configurada (falta PRICES_CSV_URL).' };
	let text: string;
	try {
		text = await download(options.fetch ?? (fetch as Fetch), url);
	} catch (e) {
		return finish({ ok: false, updated: 0, unknown: [], error: `No se ha podido leer la hoja de precios: ${e instanceof Error ? e.message : e}.` });
	}
	const prices = parsePriceCsv(text);
	if (prices.length === 0) return finish({ ok: false, updated: 0, unknown: [], error: 'La hoja de precios no trae ningún precio válido.' });

	const securities = db.prepare('SELECT id, ticker, price_ticker AS priceTicker, currency FROM security').all() as { id: number; ticker: string; priceTicker: string | null; currency: string | null }[];
	const byTicker = new Map<string, (typeof securities)[number]>();
	for (const s of securities) byTicker.set(s.ticker.toUpperCase(), s);
	for (const s of securities) if (s.priceTicker) byTicker.set(s.priceTicker.toUpperCase(), s);
	const date = options.today ?? today();
	const unknown: string[] = [];
	let updated = 0;
	db.exec('BEGIN IMMEDIATE');
	try {
		for (const p of prices) {
			const security = byTicker.get(p.ticker) ?? byTicker.get(p.ticker.split(':').pop()!);
			const currency = p.currency ?? security?.currency;
			if (!security || !currency) {
				unknown.push(p.ticker);
				continue;
			}
			// Una fecha futura o disparatada en la hoja no debe tapar los precios siguientes.
			if (savePrice(db, security.id, p.date && p.date <= date ? p.date : date, p.price, currency, 'sheet')) updated++;
		}
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
	return finish({ ok: true, updated, unknown });
}

// ---------- Tipos de cambio ----------

/** Cambio de cada moneda (unidades por euro) en `date` o, si no lo hay, el del último día anterior. */
export function latestFx(db: DatabaseSync, date = '9999-12-31'): Map<string, { rate: number; date: string }> {
	const rows = db.prepare('SELECT f.currency, f.date, f.rate FROM fx_rate f WHERE f.date = (SELECT max(date) FROM fx_rate WHERE currency = f.currency AND date <= ?)').all(date) as { currency: string; date: string; rate: number }[];
	return new Map(rows.map((r) => [r.currency, { rate: r.rate, date: r.date }]));
}

export function fxOn(db: DatabaseSync, currency: string, date: string): { rate: number; date: string } | null {
	if (currency === 'EUR') return { rate: 1, date };
	return (db.prepare('SELECT rate, date FROM fx_rate WHERE currency = ? AND date <= ? ORDER BY date DESC LIMIT 1').get(currency, date) as { rate: number; date: string } | undefined) ?? null;
}

const ECB = 'https://www.ecb.europa.eu/stats/eurofxref/';

/** Monedas que usa la aplicación: las de cuentas, valores, operaciones y calendarios. */
function currenciesInUse(db: DatabaseSync): Set<string> {
	const rows = db.prepare('SELECT currency FROM account UNION SELECT currency FROM security UNION SELECT currency FROM operation UNION SELECT currency FROM dividend_schedule').all() as { currency: string | null }[];
	return new Set(['USD', 'GBP', ...rows.map((r) => r.currency ?? '').filter((c) => /^[A-Z]{3}$/.test(c) && c !== 'EUR')]);
}

/**
 * Descarga los cambios de referencia del BCE que falten: el histórico completo la primera vez
 * (o si hace más de 90 días de la última lectura) y los últimos 90 días después.
 */
export async function refreshFx(db: DatabaseSync, options: { fetch?: Fetch } = {}): Promise<RefreshResult> {
	const last = (db.prepare(`SELECT max(date) AS date FROM fx_rate WHERE source = 'ecb'`).get() as { date: string | null }).date;
	const recent = last != null && Date.now() - Date.parse(last) < 80 * 86400000;
	let rates;
	try {
		rates = parseEcbXml(await download(options.fetch ?? (fetch as Fetch), ECB + (recent ? 'eurofxref-hist-90d.xml' : 'eurofxref-hist.xml')), currenciesInUse(db));
	} catch (e) {
		const error = `No se han podido leer los tipos de cambio del BCE: ${e instanceof Error ? e.message : e}.`;
		setSetting(db, 'fx_checked_at', new Date().toISOString());
		setSetting(db, 'fx_error', error);
		return { ok: false, updated: 0, unknown: [], error };
	}
	const insert = db.prepare(`INSERT INTO fx_rate (currency, date, rate, source) VALUES (?,?,?,'ecb') ON CONFLICT (currency, date) DO UPDATE SET rate = excluded.rate, source = 'ecb'`);
	db.exec('BEGIN IMMEDIATE');
	try {
		for (const r of rates) if (!last || r.date >= last || !recent) insert.run(r.currency, r.date, r.rate);
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
	setSetting(db, 'fx_checked_at', new Date().toISOString());
	setSetting(db, 'fx_error', rates.length ? '' : 'El fichero del BCE no trae ningún cambio.');
	return { ok: rates.length > 0, updated: rates.length, unknown: [] };
}

// ---------- Puesta al día ----------

const stale = (db: DatabaseSync, key: string, minutes: number) => {
	const at = getSetting(db, key);
	return !at || Date.now() - Date.parse(at) > minutes * 60_000;
};

let running: Promise<void> | null = null;

/**
 * Pone al día precios (si tienen más de 60 minutos) y tipos de cambio (cada 6 horas). Nunca falla:
 * los errores quedan anotados en `setting` y se sigue con lo último guardado. Las llamadas simultáneas comparten la misma lectura.
 */
export function refreshMarketIfStale(db: DatabaseSync, options: { fetch?: Fetch; force?: boolean } = {}): Promise<void> {
	running ??= (async () => {
		try {
			if (process.env.PRICES_CSV_URL && (options.force || stale(db, 'prices_checked_at', 60))) await refreshPrices(db, options);
			if (options.force || stale(db, 'fx_checked_at', 360)) await refreshFx(db, options);
		} catch (e) {
			console.error('Fallo al actualizar precios o tipos de cambio:', e);
		} finally {
			running = null;
		}
	})();
	return running;
}

export interface MarketStatus {
	pricesConfigured: boolean;
	pricesCheckedAt: string | null;
	pricesError: string | null;
	fxCheckedAt: string | null;
	fxError: string | null;
}

export function marketStatus(db: DatabaseSync): MarketStatus {
	return { pricesConfigured: Boolean(process.env.PRICES_CSV_URL), pricesCheckedAt: getSetting(db, 'prices_checked_at'), pricesError: getSetting(db, 'prices_error') || null, fxCheckedAt: getSetting(db, 'fx_checked_at'), fxError: getSetting(db, 'fx_error') || null };
}

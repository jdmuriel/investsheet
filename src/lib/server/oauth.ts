/**
 * Servidor de autorización OAuth 2.1 del conector MCP (`/mcp`), para un solo usuario.
 *
 * - Descubrimiento: metadatos del recurso protegido (RFC 9728) y del servidor de autorización (RFC 8414).
 * - Clientes públicos por registro dinámico (RFC 7591), sin secreto; solo se aceptan direcciones de
 *   vuelta de Claude (`https://claude.ai/api/mcp/auth_callback`, `claude.com`) y de bucle local (Claude Code).
 * - Código de autorización con PKCE S256 obligatorio; la autorización la da el propietario con su sesión.
 * - Token de acceso de una hora y de refresco de 90 días que rota en cada uso. Se guardan solo sus hashes.
 *
 * Funciones puras sobre la base de datos: las rutas solo traducen HTTP.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const ACCESS_TTL = 3600;
export const REFRESH_TTL = 90 * 86400;
const CODE_TTL = 600;
/** Clientes registrados que nunca llegaron a autorizarse: se borran pasado un día. */
const UNUSED_CLIENT_TTL = 86400;
const MAX_CLIENTS = 100;
export const SCOPE = 'investsheet';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
const seconds = (now: number) => Math.floor(now / 1000);

export interface HttpReply {
	status: number;
	body: Record<string, unknown>;
}

export const resourceUrl = (origin: string) => `${origin}/mcp`;

/** RFC 9728: qué servidor de autorización protege `/mcp`. */
export function protectedResourceMetadata(origin: string) {
	return { resource: resourceUrl(origin), authorization_servers: [origin], bearer_methods_supported: ['header'], scopes_supported: [SCOPE], resource_name: 'investsheet' };
}

/** RFC 8414. Sin `client_id_metadata_document_supported`: los clientes se registran por DCR. */
export function authorizationServerMetadata(origin: string) {
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [SCOPE, 'offline_access'],
		authorization_response_iss_parameter_supported: true
	};
}

/** Cabecera de un 401 en `/mcp`, que lleva al cliente a los metadatos del recurso. */
export const wwwAuthenticate = (origin: string, error?: string) =>
	`Bearer ${error ? `error="${error}", ` : ''}resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const CLAUDE_HOSTS = ['claude.ai', 'claude.com'];

/** Hosts aceptados como vuelta: los de Claude y los de `MCP_REDIRECT_HOSTS` (separados por comas). */
function allowedHosts(): string[] {
	return [...CLAUDE_HOSTS, ...(process.env.MCP_REDIRECT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)];
}

/** Dirección de vuelta aceptable: HTTPS en un host de Claude, o HTTP en bucle local (RFC 8252). */
export function redirectAllowed(uri: string): boolean {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return false;
	}
	if (url.hash || url.username || url.password) return false;
	if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
	return url.protocol === 'https:' && allowedHosts().includes(url.hostname);
}

/** Igualdad exacta; en bucle local, sin tener en cuenta el puerto (RFC 8252 §7.3). */
export function redirectMatches(registered: string, given: string): boolean {
	if (registered === given) return true;
	try {
		const a = new URL(registered);
		const b = new URL(given);
		return a.protocol === 'http:' && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.protocol === b.protocol && a.pathname === b.pathname && a.search === b.search;
	} catch {
		return false;
	}
}

interface ClientRow {
	id: string;
	name: string;
	redirect_uris: string;
}

export function getClient(db: DatabaseSync, id: string): { id: string; name: string; redirectUris: string[] } | null {
	const row = db.prepare('SELECT id, name, redirect_uris FROM oauth_client WHERE id = ?').get(id) as unknown as ClientRow | undefined;
	return row ? { id: row.id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as string[] } : null;
}

/** Borra los clientes registrados que no tienen ninguna autorización y llevan más de un día. */
function pruneClients(db: DatabaseSync, now: number) {
	const cutoff = new Date(now - UNUSED_CLIENT_TTL * 1000).toISOString().replace('T', ' ').slice(0, 19);
	db.prepare('DELETE FROM oauth_client WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_grant)').run(cutoff);
	db.prepare('DELETE FROM oauth_code WHERE expires_at < ?').run(seconds(now));
	db.prepare('DELETE FROM oauth_token WHERE expires_at < ?').run(seconds(now));
}

const oauthError = (status: number, error: string, description: string): HttpReply => ({ status, body: { error, error_description: description } });

/** RFC 7591: alta de un cliente público. */
export function registerClient(db: DatabaseSync, body: unknown, now = Date.now()): HttpReply {
	if (body == null || typeof body !== 'object' || Array.isArray(body)) return oauthError(400, 'invalid_client_metadata', 'El cuerpo debe ser un objeto JSON.');
	const meta = body as Record<string, unknown>;
	const uris = meta.redirect_uris;
	if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === 'string')) return oauthError(400, 'invalid_redirect_uri', 'Faltan las direcciones de vuelta (redirect_uris).');
	const refused = (uris as string[]).filter((u) => !redirectAllowed(u));
	if (refused.length) return oauthError(400, 'invalid_redirect_uri', `Dirección de vuelta no permitida: ${refused.join(', ')}.`);
	const method = meta.token_endpoint_auth_method ?? 'none';
	if (method !== 'none') return oauthError(400, 'invalid_client_metadata', 'Solo se admiten clientes públicos (token_endpoint_auth_method "none").');
	const grants = Array.isArray(meta.grant_types) ? meta.grant_types : ['authorization_code', 'refresh_token'];
	if (grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) return oauthError(400, 'invalid_client_metadata', 'Solo se admiten authorization_code y refresh_token.');

	pruneClients(db, now);
	const count = (db.prepare('SELECT count(*) AS n FROM oauth_client').get() as { n: number }).n;
	if (count >= MAX_CLIENTS) return oauthError(400, 'invalid_client_metadata', 'Hay demasiados clientes registrados; revoca los que no se usen en Ajustes → Conectores.');
	const name = typeof meta.client_name === 'string' && meta.client_name.trim() ? meta.client_name.trim().slice(0, 100) : 'Cliente MCP';
	const id = randomBytes(16).toString('base64url');
	db.prepare('INSERT INTO oauth_client (id, name, redirect_uris) VALUES (?, ?, ?)').run(id, name, JSON.stringify(uris));
	return {
		status: 201,
		body: { client_id: id, client_id_issued_at: seconds(now), client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: grants, response_types: ['code'] }
	};
}

export interface AuthorizeRequest {
	clientId: string;
	clientName: string;
	redirectUri: string;
	state: string | null;
	codeChallenge: string;
}

export type AuthorizeCheck =
	| { ok: true; request: AuthorizeRequest }
	/** Error que no se puede devolver al cliente (no hay una dirección de vuelta fiable): se enseña. */
	| { ok: false; message: string }
	/** Error que se devuelve al cliente en su dirección de vuelta. */
	| { ok: false; redirect: string };

function withParams(uri: string, params: Record<string, string | null>): string {
	const url = new URL(uri);
	for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
	return url.toString();
}

/** Comprueba una petición a `/oauth/authorize` (RFC 6749 §4.1.1 con PKCE y `resource`). */
export function checkAuthorize(db: DatabaseSync, params: URLSearchParams, origin: string): AuthorizeCheck {
	const client = getClient(db, params.get('client_id') ?? '');
	if (!client) return { ok: false, message: 'Cliente desconocido: vuelve a añadir el conector desde Claude.' };
	const given = params.get('redirect_uri');
	const redirectUri = given ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
	if (!redirectUri || !client.redirectUris.some((r) => redirectMatches(r, redirectUri))) return { ok: false, message: 'La dirección de vuelta no es la registrada para este cliente.' };
	const state = params.get('state');
	const fail = (error: string, description: string): AuthorizeCheck => ({ ok: false, redirect: withParams(redirectUri, { error, error_description: description, state, iss: origin }) });
	if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Solo response_type=code.');
	const challenge = params.get('code_challenge');
	if (!challenge || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail('invalid_request', 'PKCE con S256 es obligatorio.');
	const resource = params.get('resource');
	if (resource && resource !== resourceUrl(origin) && resource !== origin) return fail('invalid_target', `El único recurso es ${resourceUrl(origin)}.`);
	return { ok: true, request: { clientId: client.id, clientName: client.name, redirectUri, state, codeChallenge: challenge } };
}

/** Autorización concedida: guarda el código y devuelve la dirección de vuelta con él. */
export function approve(db: DatabaseSync, req: AuthorizeRequest, origin: string, now = Date.now()): string {
	const code = secret('isc');
	db.prepare('INSERT INTO oauth_code (hash, client_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?)').run(hash(code), req.clientId, req.redirectUri, req.codeChallenge, seconds(now) + CODE_TTL);
	return withParams(req.redirectUri, { code, state: req.state, iss: origin });
}

export const deny = (req: AuthorizeRequest, origin: string) => withParams(req.redirectUri, { error: 'access_denied', error_description: 'El propietario no ha dado acceso.', state: req.state, iss: origin });

function issueTokens(db: DatabaseSync, grantId: number, now: number): HttpReply {
	const access = secret('isa');
	const refresh = secret('isr');
	const insert = db.prepare('INSERT INTO oauth_token (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)');
	insert.run(hash(access), grantId, 'access', seconds(now) + ACCESS_TTL);
	insert.run(hash(refresh), grantId, 'refresh', seconds(now) + REFRESH_TTL);
	return { status: 200, body: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: SCOPE } };
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** `POST /oauth/token`: canje del código (con PKCE) o del token de refresco, que rota. */
export function tokenRequest(db: DatabaseSync, form: URLSearchParams, origin: string, now = Date.now()): HttpReply {
	const grantType = form.get('grant_type');
	const resource = form.get('resource');
	if (resource && resource !== resourceUrl(origin) && resource !== origin) return oauthError(400, 'invalid_target', `El único recurso es ${resourceUrl(origin)}.`);

	if (grantType === 'authorization_code') {
		const code = form.get('code') ?? '';
		const row = db.prepare('SELECT client_id, redirect_uri, code_challenge, expires_at FROM oauth_code WHERE hash = ?').get(hash(code)) as
			| { client_id: string; redirect_uri: string; code_challenge: string; expires_at: number }
			| undefined;
		// Un solo uso: se borra antes de comprobar nada más.
		db.prepare('DELETE FROM oauth_code WHERE hash = ?').run(hash(code));
		if (!row || row.expires_at < seconds(now)) return oauthError(400, 'invalid_grant', 'Código no válido o caducado.');
		if (form.get('client_id') !== row.client_id) return oauthError(400, 'invalid_grant', 'El código es de otro cliente.');
		const redirectUri = form.get('redirect_uri');
		if (redirectUri != null && redirectUri !== row.redirect_uri) return oauthError(400, 'invalid_grant', 'La dirección de vuelta no coincide.');
		const verifier = form.get('code_verifier') ?? '';
		if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !sameText(s256(verifier), row.code_challenge)) return oauthError(400, 'invalid_grant', 'La verificación PKCE ha fallado.');
		const grant = db.prepare('INSERT INTO oauth_grant (client_id, last_used_at) VALUES (?, datetime(\'now\'))').run(row.client_id);
		return issueTokens(db, Number(grant.lastInsertRowid), now);
	}

	if (grantType === 'refresh_token') {
		const token = form.get('refresh_token') ?? '';
		const row = db
			.prepare("SELECT t.grant_id, t.expires_at, g.client_id FROM oauth_token t JOIN oauth_grant g ON g.id = t.grant_id WHERE t.hash = ? AND t.kind = 'refresh'")
			.get(hash(token)) as { grant_id: number; expires_at: number; client_id: string } | undefined;
		if (!row || row.expires_at < seconds(now)) return oauthError(400, 'invalid_grant', 'Token de refresco no válido o caducado.');
		const clientId = form.get('client_id');
		if (clientId != null && clientId !== row.client_id) return oauthError(400, 'invalid_grant', 'El token es de otro cliente.');
		// Rotación: el token usado deja de valer y se emite un par nuevo para la misma autorización.
		db.prepare('DELETE FROM oauth_token WHERE hash = ?').run(hash(token));
		return issueTokens(db, row.grant_id, now);
	}

	return oauthError(400, 'unsupported_grant_type', 'Solo authorization_code y refresh_token.');
}

/** Autorización a la que pertenece un token de acceso vigente, o `null`. */
export function verifyAccessToken(db: DatabaseSync, header: string | null, now = Date.now()): number | null {
	if (!header?.startsWith('Bearer ')) return null;
	const token = header.slice(7).trim();
	if (!token.startsWith('isa_')) return null;
	const row = db.prepare("SELECT grant_id, expires_at FROM oauth_token WHERE hash = ? AND kind = 'access'").get(hash(token)) as { grant_id: number; expires_at: number } | undefined;
	if (!row || row.expires_at < seconds(now)) return null;
	db.prepare("UPDATE oauth_grant SET last_used_at = datetime('now') WHERE id = ?").run(row.grant_id);
	return row.grant_id;
}

export interface GrantInfo {
	id: number;
	client: string;
	redirectHosts: string;
	createdAt: string;
	lastUsedAt: string | null;
}

export function listGrants(db: DatabaseSync): GrantInfo[] {
	const rows = db
		.prepare('SELECT g.id, c.name, c.redirect_uris, g.created_at, g.last_used_at FROM oauth_grant g JOIN oauth_client c ON c.id = g.client_id ORDER BY g.last_used_at DESC, g.id DESC')
		.all() as unknown as { id: number; name: string; redirect_uris: string; created_at: string; last_used_at: string | null }[];
	return rows.map((r) => ({
		id: r.id,
		client: r.name,
		redirectHosts: [...new Set((JSON.parse(r.redirect_uris) as string[]).map((u) => new URL(u).hostname))].join(', '),
		createdAt: r.created_at,
		lastUsedAt: r.last_used_at
	}));
}

/** Revoca una autorización con todos sus tokens. */
export function revokeGrant(db: DatabaseSync, id: number): boolean {
	return Number(db.prepare('DELETE FROM oauth_grant WHERE id = ?').run(id).changes) > 0;
}

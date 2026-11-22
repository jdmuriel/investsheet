import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { crossSiteForbidden, safeReturnPath } from './auth.ts';
import { openDatabase } from './db.ts';
import { approve, checkAuthorize, listGrants, redirectAllowed, redirectMatches, registerClient, revokeGrant, tokenRequest, verifyAccessToken, type AuthorizeRequest } from './oauth.ts';

const ORIGIN = 'https://invest.example';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'v'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');

let db: DatabaseSync;
beforeEach(() => {
	db = openDatabase(':memory:');
});

const register = (uris = [CALLBACK]) => (registerClient(db, { client_name: 'Claude', redirect_uris: uris }).body as { client_id: string }).client_id;
const authorizeParams = (clientId: string, extra: Record<string, string> = {}) =>
	new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: `${ORIGIN}/mcp`, ...extra });

function authorize(clientId: string): string {
	const check = checkAuthorize(db, authorizeParams(clientId), ORIGIN);
	if (!check.ok) throw new Error('no autorizado');
	return new URL(approve(db, check.request, ORIGIN)).searchParams.get('code')!;
}
const exchange = (clientId: string, code: string, v = verifier) =>
	tokenRequest(db, new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: CALLBACK, code_verifier: v, resource: `${ORIGIN}/mcp` }), ORIGIN);

describe('direcciones de vuelta', () => {
	it('solo Claude por HTTPS y el bucle local', () => {
		expect(redirectAllowed(CALLBACK)).toBe(true);
		expect(redirectAllowed('https://claude.com/api/mcp/auth_callback')).toBe(true);
		expect(redirectAllowed('http://localhost:4567/callback')).toBe(true);
		expect(redirectAllowed('http://claude.ai/api/mcp/auth_callback')).toBe(false);
		expect(redirectAllowed('https://evil.example/cb')).toBe(false);
		expect(redirectAllowed('https://claude.ai.evil.example/cb')).toBe(false);
	});
	it('en bucle local no cuenta el puerto', () => {
		expect(redirectMatches('http://localhost/callback', 'http://localhost:3118/callback')).toBe(true);
		expect(redirectMatches('http://localhost/callback', 'http://localhost:3118/otra')).toBe(false);
		expect(redirectMatches(CALLBACK, `${CALLBACK}?x=1`)).toBe(false);
	});
});

describe('registro', () => {
	it('da de alta un cliente público y rechaza vueltas ajenas o clientes con secreto', () => {
		const ok = registerClient(db, { client_name: 'Claude', redirect_uris: [CALLBACK] });
		expect(ok.status).toBe(201);
		expect(ok.body).toMatchObject({ token_endpoint_auth_method: 'none', redirect_uris: [CALLBACK] });
		expect(registerClient(db, { redirect_uris: ['https://evil.example/cb'] }).status).toBe(400);
		expect(registerClient(db, { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }).status).toBe(400);
		expect(registerClient(db, null).status).toBe(400);
	});
});

describe('autorización y tokens', () => {
	it('flujo completo: código con PKCE, acceso, refresco con rotación y revocación', () => {
		const client = register();
		const code = authorize(client);
		const tokens = exchange(client, code);
		expect(tokens.status).toBe(200);
		const { access_token, refresh_token } = tokens.body as { access_token: string; refresh_token: string };
		const grant = verifyAccessToken(db, `Bearer ${access_token}`);
		expect(grant).not.toBeNull();
		// El código no se puede usar dos veces.
		expect(exchange(client, code).body).toMatchObject({ error: 'invalid_grant' });

		const refreshed = tokenRequest(db, new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: client }), ORIGIN);
		expect(refreshed.status).toBe(200);
		expect((refreshed.body as { refresh_token: string }).refresh_token).not.toBe(refresh_token);
		// El de refresco usado ya no vale.
		expect(tokenRequest(db, new URLSearchParams({ grant_type: 'refresh_token', refresh_token }), ORIGIN).body).toMatchObject({ error: 'invalid_grant' });

		expect(listGrants(db)).toHaveLength(1);
		expect(revokeGrant(db, grant!)).toBe(true);
		expect(verifyAccessToken(db, `Bearer ${access_token}`)).toBeNull();
		expect(verifyAccessToken(db, `Bearer ${(refreshed.body as { access_token: string }).access_token}`)).toBeNull();
	});

	it('rechaza un verificador PKCE erróneo, otro cliente o un código caducado', () => {
		const client = register();
		expect(exchange(client, authorize(client), 'w'.repeat(50)).body).toMatchObject({ error: 'invalid_grant' });
		const other = register();
		expect(exchange(other, authorize(client)).body).toMatchObject({ error: 'invalid_grant' });
		const code = authorize(client);
		const late = tokenRequest(db, new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client, code_verifier: verifier }), ORIGIN, Date.now() + 11 * 60_000);
		expect(late.body).toMatchObject({ error: 'invalid_grant' });
	});

	it('el token de acceso caduca a la hora', () => {
		const client = register();
		const { access_token } = exchange(client, authorize(client)).body as { access_token: string };
		expect(verifyAccessToken(db, `Bearer ${access_token}`, Date.now() + 3601_000)).toBeNull();
	});

	it('comprueba la petición de autorización', () => {
		const client = register();
		expect(checkAuthorize(db, authorizeParams('nadie'), ORIGIN)).toMatchObject({ ok: false, message: expect.any(String) });
		expect(checkAuthorize(db, authorizeParams(client, { redirect_uri: 'https://claude.ai/otra' }), ORIGIN)).toMatchObject({ ok: false, message: expect.any(String) });
		const noPkce = checkAuthorize(db, authorizeParams(client, { code_challenge_method: 'plain' }), ORIGIN);
		expect(noPkce.ok === false && 'redirect' in noPkce && noPkce.redirect).toContain('error=invalid_request');
		const wrongResource = checkAuthorize(db, authorizeParams(client, { resource: 'https://otro.example/mcp' }), ORIGIN);
		expect(wrongResource.ok === false && 'redirect' in wrongResource && wrongResource.redirect).toContain('error=invalid_target');
		const ok = checkAuthorize(db, authorizeParams(client), ORIGIN);
		expect(ok.ok && (ok.request as AuthorizeRequest).state).toBe('xyz');
	});

	it('el código vuelve con el estado y el emisor', () => {
		const client = register();
		const check = checkAuthorize(db, authorizeParams(client), ORIGIN);
		const url = new URL(approve(db, (check as { request: AuthorizeRequest }).request, ORIGIN));
		expect(url.origin + url.pathname).toBe(CALLBACK);
		expect(url.searchParams.get('state')).toBe('xyz');
		expect(url.searchParams.get('iss')).toBe(ORIGIN);
	});
});

describe('origen y vuelta', () => {
	const req = (method: string, type: string | null, origin: string | null) =>
		new Request(`${ORIGIN}/x`, { method, headers: { ...(type ? { 'content-type': type } : {}), ...(origin ? { origin } : {}) } });
	it('rechaza formularios de otro origen', () => {
		expect(crossSiteForbidden(req('POST', 'application/x-www-form-urlencoded', 'https://evil.example'), ORIGIN)).toBe(true);
		expect(crossSiteForbidden(req('POST', 'multipart/form-data; boundary=x', null), ORIGIN)).toBe(true);
		expect(crossSiteForbidden(req('POST', 'application/x-www-form-urlencoded', ORIGIN), ORIGIN)).toBe(false);
		expect(crossSiteForbidden(req('POST', 'application/json', null), ORIGIN)).toBe(false);
		expect(crossSiteForbidden(req('GET', null, null), ORIGIN)).toBe(false);
	});
	it('solo vuelve a rutas internas', () => {
		expect(safeReturnPath('/oauth/authorize?x=1')).toBe('/oauth/authorize?x=1');
		expect(safeReturnPath('//evil.example')).toBe('/');
		expect(safeReturnPath('https://evil.example')).toBe('/');
		expect(safeReturnPath(null)).toBe('/');
	});
});

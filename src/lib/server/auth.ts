import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'sesion';
export const STATE_COOKIE = 'oauth_state';
const SESSION_DAYS = 30;

export interface AuthConfig {
	clientId: string;
	clientSecret: string;
	allowedEmail: string;
	sessionSecret: string;
}

/** Configuración de acceso tomada del entorno; `null` si falta algún valor. */
export function authConfig(): AuthConfig | null {
	const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_EMAIL, SESSION_SECRET } = process.env;
	if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !ALLOWED_EMAIL || !SESSION_SECRET) return null;
	return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, allowedEmail: ALLOWED_EMAIL.trim().toLowerCase(), sessionSecret: SESSION_SECRET };
}

const b64 = (data: string | Buffer) => Buffer.from(data).toString('base64url');

function sign(payload: string, secret: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Valor firmado `payload.firma`; el payload lleva correo y caducidad. */
export function createSession(email: string, secret: string, now = Date.now()): string {
	const payload = b64(JSON.stringify({ email, exp: now + SESSION_DAYS * 86400_000 }));
	return `${payload}.${sign(payload, secret)}`;
}

export function readSession(value: string | undefined, secret: string, now = Date.now()): string | null {
	if (!value) return null;
	const [payload, signature] = value.split('.');
	if (!payload || !signature) return null;
	const expected = Buffer.from(sign(payload, secret));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
	try {
		const { email, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email: string; exp: number };
		return typeof email === 'string' && typeof exp === 'number' && exp > now ? email : null;
	} catch {
		return null;
	}
}

export const sessionMaxAge = SESSION_DAYS * 86400;
export const randomToken = () => randomBytes(24).toString('base64url');

export function googleAuthUrl(config: AuthConfig, redirectUri: string, state: string, nonce: string): string {
	const params = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: 'openid email',
		state,
		nonce,
		prompt: 'select_account'
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Canjea el código por el `id_token` y devuelve el correo verificado. El token llega directamente
 * de Google por TLS, así que basta comprobar sus campos (emisor, audiencia, caducidad y nonce).
 */
export async function exchangeCode(config: AuthConfig, code: string, redirectUri: string, nonce: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
	const response = await fetchFn('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
	});
	if (!response.ok) return null;
	const { id_token } = (await response.json()) as { id_token?: string };
	const claims = id_token?.split('.')[1];
	if (!claims) return null;
	const c = JSON.parse(Buffer.from(claims, 'base64url').toString()) as { iss?: string; aud?: string; exp?: number; nonce?: string; email?: string; email_verified?: boolean };
	const issuerOk = c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com';
	if (!issuerOk || c.aud !== config.clientId || !c.exp || c.exp * 1000 < Date.now() || c.nonce !== nonce || !c.email || c.email_verified !== true) return null;
	return c.email.toLowerCase();
}

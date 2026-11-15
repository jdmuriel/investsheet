import { error, redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, STATE_COOKIE, authConfig, createSession, exchangeCode, sessionMaxAge } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, url, fetch }) => {
	const config = authConfig();
	if (!config) error(503, 'Acceso no configurado');
	const [state, nonce] = (cookies.get(STATE_COOKIE) ?? '').split('.');
	cookies.delete(STATE_COOKIE, { path: '/auth' });
	const code = url.searchParams.get('code');
	if (!state || !nonce || !code || url.searchParams.get('state') !== state) error(400, 'Inicio de sesión no válido o caducado. Vuelve a intentarlo.');

	const email = await exchangeCode(config, code, `${url.origin}/auth/callback`, nonce, fetch);
	if (email !== config.allowedEmail) error(403, 'Esta cuenta no tiene acceso.');

	cookies.set(SESSION_COOKIE, createSession(email, config.sessionSecret), { path: '/', httpOnly: true, secure: url.protocol === 'https:', sameSite: 'lax', maxAge: sessionMaxAge });
	redirect(303, '/');
};

import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { SESSION_COOKIE, apiTokenValid, authConfig, crossSiteForbidden, readSession } from '#lib/server/auth.ts';
import { verifyAccessToken, wwwAuthenticate } from '#lib/server/oauth.ts';
import { getDb, listPortfolios } from '#lib/server/store.ts';

const PORTFOLIO_COOKIE = 'cartera';

/**
 * La cartera queda fija entre visitas: se recuerda en una *cookie* y se cambia desde la barra superior.
 * Un parámetro `cartera` en la dirección manda sobre ella (y pasa a ser la recordada), para que un
 * formulario abierto en una pestaña guarde siempre en la cartera que mostraba.
 */
function choosePortfolio(event: Parameters<Handle>[0]['event']): void {
	const ids = listPortfolios().map((p) => p.id);
	if (ids.length === 0) return;
	const remembered = Number(event.cookies.get(PORTFOLIO_COOKIE));
	const asked = Number(event.url.searchParams.get('cartera'));
	const chosen = ids.includes(asked) ? asked : ids.includes(remembered) ? remembered : ids[0];
	if (chosen !== remembered) event.cookies.set(PORTFOLIO_COOKIE, String(chosen), { path: '/', maxAge: 365 * 86400, httpOnly: true, sameSite: 'lax', secure: !dev });
	event.locals.portfolioId = chosen;
}

const PUBLIC = ['/auth/', '/health', '/.well-known/'];
/** Puntos del servidor OAuth que llaman los clientes desde fuera: sin sesión ni comprobación de origen. */
const OAUTH_PUBLIC = ['/oauth/register', '/oauth/token'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (OAUTH_PUBLIC.includes(path)) return resolve(event);
	// La comprobación de origen de SvelteKit está desactivada (vite.config.ts) para que el canje de tokens
	// OAuth, que llega como formulario sin cabecera Origin, funcione; esta la sustituye en todo lo demás.
	if (!dev && crossSiteForbidden(event.request, event.url.origin)) return new Response(`Cross-site ${event.request.method} form submissions are forbidden`, { status: 403 });
	if (PUBLIC.some((p) => path === p || path.startsWith(p))) return resolve(event);

	// El servidor MCP acepta un token OAuth emitido por esta aplicación o el de la API.
	if (path === '/mcp') {
		const header = event.request.headers.get('authorization');
		if (dev && !process.env.API_TOKEN && !authConfig()) return resolve(event);
		if (apiTokenValid(header, process.env.API_TOKEN) || verifyAccessToken(getDb(), header) != null) return resolve(event);
		return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'Hace falta autorización.' }), {
			status: 401,
			headers: { 'content-type': 'application/json', 'www-authenticate': wwwAuthenticate(event.url.origin, header ? 'invalid_token' : undefined) }
		});
	}

	// La API no usa la sesión del navegador: solo vale su propio token.
	if (path === '/api' || path.startsWith('/api/')) {
		const token = process.env.API_TOKEN;
		if (!token && dev) return resolve(event);
		const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json' } });
		if (!token) return json(503, 'La API no está activada: falta el secreto API_TOKEN.');
		if (!apiTokenValid(event.request.headers.get('authorization'), token)) return json(401, 'Token no válido.');
		return resolve(event);
	}

	const config = authConfig();
	if (!config) {
		// Sin configuración de acceso solo se permite trabajar en desarrollo local.
		if (dev) {
			choosePortfolio(event);
			return resolve(event);
		}
		return new Response('Acceso no configurado', { status: 503 });
	}
	const email = readSession(event.cookies.get(SESSION_COOKIE), config.sessionSecret);
	if (email !== config.allowedEmail) {
		// Tras iniciar sesión se vuelve a donde se iba (por ejemplo, a la autorización de un conector).
		if (event.request.method === 'GET') redirect(303, path === '/' ? '/auth/login' : `/auth/login?volver=${encodeURIComponent(path + event.url.search)}`);
		return new Response('No autorizado', { status: 401 });
	}
	event.locals.email = email;
	choosePortfolio(event);
	return resolve(event);
};

import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { SESSION_COOKIE, authConfig, readSession } from '#lib/server/auth.ts';

const PUBLIC = ['/auth/', '/health'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (PUBLIC.some((p) => path === p || path.startsWith(p))) return resolve(event);

	const config = authConfig();
	if (!config) {
		// Sin configuración de acceso solo se permite trabajar en desarrollo local.
		if (dev) return resolve(event);
		return new Response('Acceso no configurado', { status: 503 });
	}
	const email = readSession(event.cookies.get(SESSION_COOKIE), config.sessionSecret);
	if (email !== config.allowedEmail) {
		if (event.request.method === 'GET') redirect(303, '/auth/login');
		return new Response('No autorizado', { status: 401 });
	}
	event.locals.email = email;
	return resolve(event);
};

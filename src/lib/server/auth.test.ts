import { describe, expect, it } from 'vitest';
import { createSession, exchangeCode, readSession } from './auth.ts';

const secret = 'secreto-de-prueba';
const config = { clientId: 'cliente', clientSecret: 'x', allowedEmail: 'yo@example.com', sessionSecret: secret };

function fakeGoogle(claims: Record<string, unknown>): typeof fetch {
	const token = ['h', Buffer.from(JSON.stringify(claims)).toString('base64url'), 's'].join('.');
	return (async () => new Response(JSON.stringify({ id_token: token }), { status: 200 })) as typeof fetch;
}
const good = { iss: 'https://accounts.google.com', aud: 'cliente', exp: Date.now() / 1000 + 600, nonce: 'n', email: 'Yo@Example.com', email_verified: true };

describe('sesión', () => {
	it('acepta una sesión válida y rechaza las manipuladas o caducadas', () => {
		const value = createSession('yo@example.com', secret, 1000);
		expect(readSession(value, secret, 2000)).toBe('yo@example.com');
		expect(readSession(value, 'otro-secreto', 2000)).toBeNull();
		expect(readSession(value.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), secret, 2000)).toBeNull();
		expect(readSession(value, secret, 1000 + 31 * 86400_000)).toBeNull();
		expect(readSession(undefined, secret)).toBeNull();
		const forged = Buffer.from(JSON.stringify({ email: 'otro@example.com', exp: 9e15 })).toString('base64url') + '.' + value.split('.')[1];
		expect(readSession(forged, secret, 2000)).toBeNull();
	});
});

describe('canje del código de Google', () => {
	it('devuelve el correo si el token es correcto', async () => {
		expect(await exchangeCode(config, 'c', 'http://x/auth/callback', 'n', fakeGoogle(good))).toBe('yo@example.com');
	});
	it.each([
		['otra audiencia', { aud: 'otro-cliente' }],
		['otro emisor', { iss: 'https://evil.example' }],
		['caducado', { exp: 1 }],
		['nonce distinto', { nonce: 'otro' }],
		['correo sin verificar', { email_verified: false }]
	])('rechaza un token con %s', async (_, change) => {
		expect(await exchangeCode(config, 'c', 'http://x/auth/callback', 'n', fakeGoogle({ ...good, ...change }))).toBeNull();
	});
	it('rechaza si Google responde con error', async () => {
		expect(await exchangeCode(config, 'c', 'u', 'n', (async () => new Response('no', { status: 400 })) as typeof fetch)).toBeNull();
	});
});

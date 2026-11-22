import { protectedResourceMetadata } from '#lib/server/oauth.ts';
import type { RequestHandler } from './$types';

// RFC 9728: Claude prueba primero `/.well-known/oauth-protected-resource/mcp` y después la raíz.
export const GET: RequestHandler = ({ url }) => Response.json(protectedResourceMetadata(url.origin), { headers: { 'access-control-allow-origin': '*' } });

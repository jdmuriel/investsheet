import type { RequestHandler } from './$types';

/** Comprobación de salud para Fly: no toca la base de datos ni devuelve datos. */
export const GET: RequestHandler = () => new Response('ok');

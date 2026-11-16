// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			email?: string;
			/** Cartera con la que se trabaja: la del parámetro `cartera` o, si no viene, la recordada en la *cookie*. */
			portfolioId?: number;
		}
	}
}

export {};

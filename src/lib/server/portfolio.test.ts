import { describe, expect, it } from 'vitest';
import { openDatabase } from './db.ts';
import { savePortfolioOrder } from './portfolio.ts';

// Datos inventados.
describe('orden de la cartera', () => {
	it('guarda el orden nuevo de los valores que se ven y conserva el de las demás carteras', () => {
		const db = openDatabase(':memory:');
		db.exec(`
			INSERT INTO portfolio (id, name) VALUES (1, 'Prueba'), (2, 'Otra');
			INSERT INTO security (id, ticker) VALUES (1, 'AAA'), (2, 'BBB'), (3, 'CCC'), (4, 'DDD');
			INSERT INTO portfolio_security (portfolio_id, security_id, sort_order) VALUES (1, 1, 0), (1, 2, 1), (1, 3, 2), (2, 3, 0), (2, 1, 1);
		`);
		savePortfolioOrder(db, 1, [3, 4, 1, 99]);
		const order = (p: number) => (db.prepare('SELECT security_id AS id FROM portfolio_security WHERE portfolio_id = ? ORDER BY sort_order').all(p) as { id: number }[]).map((r) => r.id);
		expect(order(1)).toEqual([3, 2, 4, 1]);
		expect(order(2)).toEqual([3, 1]);
	});
});

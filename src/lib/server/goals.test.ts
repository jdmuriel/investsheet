import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db.ts';
import { goalYears, loadGoals, saveGoals } from './goals.ts';

// Todos los datos de estas pruebas son inventados.
let db: DatabaseSync;

beforeEach(() => {
	db = openDatabase(':memory:');
	db.exec(`INSERT INTO portfolio (id, name) VALUES (1, 'Prueba'), (2, 'Otra')`);
});

const audits = () => db.prepare(`SELECT action, before_json AS before, after_json AS after FROM audit_log WHERE entity = 'goal' ORDER BY id`).all() as { action: string; before: string | null; after: string }[];

describe('objetivos anuales', () => {
	it('guarda los objetivos tecleados, por cartera y año, con auditoría', () => {
		const result = saveGoals(db, 1, 2031, { capital: '1.200,50', netYield: '480', fees: '', desconocida: '7' });
		expect(result).toEqual({ ok: true, goals: { capital: 120050, netYield: 48000 } });
		expect(loadGoals(db, 1, 2031)).toEqual({ capital: 120050, netYield: 48000 });
		expect(loadGoals(db, 1, 2030)).toEqual({});
		expect(loadGoals(db, 2, 2031)).toEqual({});
		expect(audits()).toEqual([{ action: 'create', before: null, after: JSON.stringify({ year: 2031, capital: 120050, netYield: 48000 }) }]);
	});

	it('al volver a guardar sustituye los del año: un campo en blanco quita el objetivo', () => {
		saveGoals(db, 1, 2031, { capital: '1000', gross: '300' });
		saveGoals(db, 1, 2032, { gross: '350' });
		saveGoals(db, 1, 2031, { capital: '', gross: '320', purchases: '0' });
		expect(loadGoals(db, 1, 2031)).toEqual({ gross: 32000, purchases: 0 });
		expect(loadGoals(db, 1, 2032)).toEqual({ gross: 35000 });
		expect(goalYears(db, 1)).toEqual([2032, 2031]);
		expect(audits().at(-1)).toMatchObject({ action: 'update', before: JSON.stringify({ year: 2031, capital: 100000, gross: 30000 }) });
	});

	it('guardar sin cambios no deja rastro', () => {
		saveGoals(db, 1, 2031, { gross: '300' });
		saveGoals(db, 1, 2031, { gross: '300,00' });
		expect(audits()).toHaveLength(1);
	});

	it('rechaza importes que no se entienden o negativos, sin tocar lo guardado', () => {
		saveGoals(db, 1, 2031, { gross: '300' });
		const result = saveGoals(db, 1, 2031, { gross: 'mucho', fees: '-5' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors).toHaveLength(2);
		expect(loadGoals(db, 1, 2031)).toEqual({ gross: 30000 });
		expect(saveGoals(db, 9, 2031, { gross: '1' }).ok).toBe(false);
		expect(saveGoals(db, 1, 31, { gross: '1' }).ok).toBe(false);
	});
});

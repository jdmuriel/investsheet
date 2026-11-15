import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './migrations.ts';

/** Aplica las migraciones pendientes; la versión aplicada se guarda en `PRAGMA user_version`. */
export function migrate(db: DatabaseSync): void {
	const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
	for (const { version, sql } of MIGRATIONS) {
		if (version <= current) continue;
		db.exec('BEGIN');
		try {
			db.exec(sql);
			db.exec(`PRAGMA user_version = ${version}`);
			db.exec('COMMIT');
		} catch (e) {
			db.exec('ROLLBACK');
			throw e;
		}
	}
}

export function openDatabase(path: string): DatabaseSync {
	if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
	migrate(db);
	return db;
}

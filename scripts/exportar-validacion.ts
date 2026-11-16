/**
 * Genera la exportación de validación (RF-49) sin pasar por la aplicación.
 *
 *   node scripts/exportar-validacion.ts data/invest.db salida.xlsx [legacy/Inversión.xlsx] [desde AAAA-MM-DD]
 *
 * Con la hoja antigua como tercer argumento añade la solapa de diferencias. El libro generado
 * contiene datos reales: no se versiona.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { openDatabase } from '../src/lib/server/db.ts';
import { exportValidation, readReference } from '../src/lib/server/validation.ts';

const [, , dbPath, outPath, referencePath, from] = process.argv;
if (!dbPath || !outPath || !existsSync(dbPath)) {
	console.error('Uso: node scripts/exportar-validacion.ts <base.db> <salida.xlsx> [hoja.xlsx] [desde AAAA-MM-DD]');
	process.exit(1);
}
const db = openDatabase(dbPath);
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date());
const reference = referencePath ? await readReference(referencePath) : undefined;
const { data, result } = await exportValidation(db, { reference, from, today });
db.close();
writeFileSync(outPath, data);
for (const m of result.models) console.log(`${m.layout.sheet}: ${m.rows.length} filas`);
for (const c of result.comparisons) console.log(`${c.sheet}: ${c.differences.length} diferencias (${c.checkpoints} cierres de día comparados, ${c.skippedDates} fechas sin comparar acumulados)`);
for (const n of result.notes) console.log(n);
console.log(`Libro: ${outPath}`);

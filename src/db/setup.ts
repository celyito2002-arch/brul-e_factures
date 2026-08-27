/**
 * Script de configuració de la base de dades.
 * Ús: `npm run setup`
 * Crea les taules SQLite a partir de `schema.sql` (idempotent).
 */
import { db, DB_PATH, initSchema, closeDb } from './db.js';

function main(): void {
  console.log(`🗄️  Inicialitzant la base de dades a "${DB_PATH}"…`);
  initSchema();

  const taules = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  console.log(`✅ Base de dades preparada. Taules: ${taules.map((t) => t.name).join(', ')}`);
  closeDb();
}

main();

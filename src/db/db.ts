import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Ruta del fitxer SQLite (font de veritat). Configurable via `.env`. */
export const DB_PATH = process.env.DB_PATH ?? './brulee.sqlite';

/** Connexió única compartida a tota l'aplicació. */
export const db: Database.Database = new Database(resolve(process.cwd(), DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Localitza `schema.sql`. En dev (`tsx`) viu al costat d'aquest mòdul (`src/db`);
 * en producció (`dist/db`) `tsc` no copia els `.sql`, així que caiem cap a `src/db`.
 */
function schemaPath(): string {
  const candidats = [
    resolve(__dirname, 'schema.sql'),
    resolve(process.cwd(), 'src/db/schema.sql'),
  ];
  const trobat = candidats.find((p) => existsSync(p));
  if (!trobat) throw new Error(`No s'ha trobat schema.sql. Cercat a: ${candidats.join(', ')}`);
  return trobat;
}

/**
 * Migracions lleugeres per a bases de dades ja existents. SQLite no permet
 * `ADD COLUMN IF NOT EXISTS`, així que comprovem amb `PRAGMA table_info`.
 * Idempotent.
 */
function assegurarColumnes(): void {
  const cols = db.prepare('PRAGMA table_info(emails_processats)').all() as { name: string }[];
  const noms = new Set(cols.map((c) => c.name));
  if (!noms.has('subject')) db.exec('ALTER TABLE emails_processats ADD COLUMN subject TEXT');
  if (!noms.has('fromAddress')) db.exec('ALTER TABLE emails_processats ADD COLUMN fromAddress TEXT');
}

/**
 * Crea totes les taules si no existeixen executant `schema.sql` i aplica les
 * migracions de columnes. Idempotent — es pot cridar cada arrencada sense perill.
 */
export function initSchema(): void {
  const schema = readFileSync(schemaPath(), 'utf-8');
  db.exec(schema);
  assegurarColumnes();
}

/** Tanca la connexió de forma neta (útil per a scripts puntuals). */
export function closeDb(): void {
  db.close();
}

// Assegura l'esquema en importar el mòdul: així els `db.prepare(...)` de nivell
// superior d'altres mòduls (ingest.ts, gmail.ts…) tenen sempre les taules i
// columnes disponibles, independentment de l'ordre d'imports. Idempotent.
initSchema();

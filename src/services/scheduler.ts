import cron from 'node-cron';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema, closeDb } from '../db/db.js';
import { processarCicleGmail } from './gmail.js';

// ============================================================
//  Scheduler · polling de Gmail cada 15 minuts (node-cron).
//  Ús com a script: `npm run sync` (mode --once, un sol cicle).
// ============================================================

const CRON_CADA_15_MIN = '*/15 * * * *';

let executant = false;

/** Executa un cicle protegit contra solapaments. */
async function cicleSegur(): Promise<void> {
  if (executant) {
    console.log('⏭️  Cicle anterior encara en curs, s\'omet aquest.');
    return;
  }
  executant = true;
  try {
    await processarCicleGmail();
  } catch (err) {
    console.error('✗ Error al cicle de Gmail:', err);
  } finally {
    executant = false;
  }
}

/** Registra el cron de polling (cada 15 min). El crida el servidor a l'arrencar. */
export function iniciarScheduler(): void {
  cron.schedule(CRON_CADA_15_MIN, cicleSegur);
  console.log(`⏰ Scheduler Gmail actiu (cada 15 min: "${CRON_CADA_15_MIN}").`);
}

// ---- Execució directa: `tsx src/services/scheduler.ts --once` ----------

/** Cert si aquest mòdul s'ha executat directament (no importat). */
function esScriptPrincipal(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const norm = (p: string): string => resolve(p).replace(/\\/g, '/').toLowerCase();
  try {
    return norm(realpathSync(argv1)) === norm(fileURLToPath(import.meta.url));
  } catch {
    return norm(argv1) === norm(fileURLToPath(import.meta.url));
  }
}

if (esScriptPrincipal()) {
  const once = process.argv.includes('--once');
  initSchema(); // assegura que les taules existeixen
  if (once) {
    console.log('▶️  Executant un únic cicle de sincronització de Gmail…');
    processarCicleGmail()
      .then((r) => {
        console.log(`✅ Fet: ${r.processats} processats, ${r.errors} errors.`);
        closeDb();
        process.exit(0);
      })
      .catch((err) => {
        console.error('✗ Error:', err);
        closeDb();
        process.exit(1);
      });
  } else {
    iniciarScheduler();
    // Un primer cicle immediat, després el cron s'encarrega.
    void cicleSegur();
  }
}

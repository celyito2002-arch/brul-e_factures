import express, { type NextFunction, type Request, type Response } from 'express';
import { MulterError } from 'multer';
import { resolve } from 'node:path';
import 'dotenv/config';
import { initSchema } from './db/db.js';
import { facturesRouter, pendentsRouter } from './routes/factures.js';
import { emesesRouter } from './routes/emeses.js';
import { statsRouter } from './routes/stats.js';
import { syncRouter } from './routes/sync.js';
import { iniciarScheduler } from './services/scheduler.js';

// ============================================================
//  Brulée — Gestió de Factures · servidor Express
// ============================================================

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), 'public');

// 1) Assegura les taules SQLite (idempotent).
initSchema();

const app = express();
app.use(express.json());

// 2) Frontend estàtic.
app.use(express.static(PUBLIC_DIR));

// 3) API.
app.use('/api/factures', facturesRouter);
app.use('/api/pendents', pendentsRouter);
app.use('/api/factures-emeses', emesesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/sync', syncRouter);

// 4) 404 per a rutes /api desconegudes.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint no trobat.' });
});

// 5) Gestió d'errors centralitzada (inclou errors de Multer).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    const missatge =
      err.code === 'LIMIT_FILE_SIZE' ? 'El fitxer supera el límit de 20 MB.' : err.message;
    return res.status(400).json({ error: missatge });
  }
  console.error('✗ Error no controlat:', err);
  return res.status(500).json({ error: 'Error intern del servidor.' });
});

// 6) Arrenca el servidor.
app.listen(PORT, () => {
  console.log(`🥐 Brulée Factures en marxa a http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/`);

  // 7) Scheduler de Gmail: només si hi ha credencials configurades.
  const gmailConfigurat =
    process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
  if (gmailConfigurat) {
    iniciarScheduler();
  } else {
    console.log('ℹ️  Scheduler de Gmail desactivat (falten credencials al .env).');
  }
});

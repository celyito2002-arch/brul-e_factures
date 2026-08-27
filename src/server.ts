import express, { type NextFunction, type Request, type Response } from 'express';
import { MulterError } from 'multer';
import { resolve } from 'node:path';
import 'dotenv/config';
import { facturesRouter, pendentsRouter } from './routes/factures.js';
import { emesesRouter } from './routes/emeses.js';
import { statsRouter } from './routes/stats.js';
import { syncRouter } from './routes/sync.js';
import { iniciarScheduler } from './services/scheduler.js';

// ============================================================
//  Brulée — Gestió de Factures · servidor Express
//  Dades i fitxers a Supabase; l'app no manté cap estat local, de manera
//  que el mateix mòdul serveix per a `npm run dev` i per a Vercel.
// ============================================================

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = resolve(process.cwd(), 'public');

/** A Vercel cada petició arriba a una funció efímera: ni `listen` ni cron. */
const A_VERCEL = Boolean(process.env.VERCEL);

const app = express();
app.use(express.json());

// 1) Frontend estàtic.
app.use(express.static(PUBLIC_DIR));

// 2) API.
app.use('/api/factures', facturesRouter);
app.use('/api/pendents', pendentsRouter);
app.use('/api/factures-emeses', emesesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/sync', syncRouter);

// 3) 404 per a rutes /api desconegudes.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint no trobat.' });
});

// 4) Gestió d'errors centralitzada (inclou errors de Multer).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof MulterError) {
    const missatge =
      err.code === 'LIMIT_FILE_SIZE' ? 'El fitxer supera el límit de 20 MB.' : err.message;
    return res.status(400).json({ error: missatge });
  }
  console.error('✗ Error no controlat:', err);
  return res.status(500).json({ error: 'Error intern del servidor.' });
});

// 5) Arrenca el servidor només en local: a Vercel el runtime importa l'app.
if (!A_VERCEL) {
  app.listen(PORT, () => {
    console.log(`🥐 Brulée Factures en marxa a http://localhost:${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}/`);

    // 6) Scheduler de Gmail: només si hi ha credencials configurades.
    //    A Vercel el polling l'ha de fer un Cron Job cridant /api/sync/gmail.
    const gmailConfigurat =
      process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN;
    if (gmailConfigurat) {
      iniciarScheduler();
    } else {
      console.log('ℹ️  Scheduler de Gmail desactivat (falten credencials al .env).');
    }
  });
}

// Handler per a `@vercel/node`: una app d'Express ja és `(req, res) => void`.
export default app;

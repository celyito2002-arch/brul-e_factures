import { Router, type Request, type Response } from 'express';
import { processarCicleGmail } from '../services/gmail.js';

// ============================================================
//  /api/sync · trigger manual de sincronització amb Gmail
// ============================================================

export const syncRouter = Router();

// ---- POST /api/sync/gmail ---------------------------------------------

syncRouter.post('/gmail', async (_req: Request, res: Response) => {
  try {
    const resultat = await processarCicleGmail();
    res.json(resultat);
  } catch (err) {
    console.error('✗ Error en la sincronització manual de Gmail:', err);
    res.status(500).json({ error: 'Error sincronitzant amb Gmail.', detall: String(err) });
  }
});

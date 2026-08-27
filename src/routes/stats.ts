import { Router, type Request, type Response } from 'express';
import { db } from '../db/db.js';
import { MESOS_CA } from '../services/drive.js';
import type { StatsMensual, StatsProveidor, StatsResum } from '../types.js';

// ============================================================
//  /api/stats · resum, gràfic mensual i top proveïdors
// ============================================================

export const statsRouter = Router();

// ---- GET /api/stats/resum ---------------------------------------------

statsRouter.get('/resum', (_req: Request, res: Response) => {
  const totalPendent = (
    db
      .prepare("SELECT COALESCE(SUM(total),0) AS s FROM factures WHERE estat = 'pendent'")
      .get() as { s: number }
  ).s;

  const vencen7dies = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total),0) AS s FROM factures
         WHERE estat = 'pendent' AND dataVenciment IS NOT NULL
           AND dataVenciment >= date('now')
           AND dataVenciment <= date('now','+7 days')`,
      )
      .get() as { s: number }
  ).s;

  const facturesMes = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM factures WHERE strftime('%Y-%m', dataDocument) = strftime('%Y-%m','now')",
      )
      .get() as { n: number }
  ).n;

  const pagadaMes = (
    db
      .prepare(
        `SELECT COALESCE(SUM(total),0) AS s FROM factures
         WHERE estat = 'pagada' AND strftime('%Y-%m', dataDocument) = strftime('%Y-%m','now')`,
      )
      .get() as { s: number }
  ).s;

  const resposta: StatsResum = { totalPendent, vencen7dies, facturesMes, pagadaMes };
  res.json(resposta);
});

// ---- GET /api/stats/mensual (any actual) ------------------------------

statsRouter.get('/mensual', (_req: Request, res: Response) => {
  const any = String(new Date().getFullYear());

  const rebudesRaw = db
    .prepare(
      `SELECT strftime('%m', dataDocument) AS mm, COALESCE(SUM(total),0) AS s
       FROM factures WHERE strftime('%Y', dataDocument) = ? GROUP BY mm`,
    )
    .all(any) as { mm: string; s: number }[];

  const emesesRaw = db
    .prepare(
      `SELECT strftime('%m', dataDocument) AS mm, COALESCE(SUM(total),0) AS s
       FROM factures_emeses WHERE strftime('%Y', dataDocument) = ? GROUP BY mm`,
    )
    .all(any) as { mm: string; s: number }[];

  const mapa = (rows: { mm: string; s: number }[]): Record<string, number> =>
    Object.fromEntries(rows.map((r) => [r.mm, r.s]));
  const reb = mapa(rebudesRaw);
  const eme = mapa(emesesRaw);

  const resposta: StatsMensual[] = MESOS_CA.map((_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { mes: `${any}-${mm}`, rebudes: reb[mm] ?? 0, emeses: eme[mm] ?? 0 };
  });
  res.json(resposta);
});

// ---- GET /api/stats/proveidors (top 5 per import) ---------------------

statsRouter.get('/proveidors', (_req: Request, res: Response) => {
  const totalGlobal = (
    db
      .prepare('SELECT COALESCE(SUM(total),0) AS s FROM factures WHERE proveidorNom IS NOT NULL')
      .get() as { s: number }
  ).s;

  const top = db
    .prepare(
      `SELECT proveidorNom AS nom, COALESCE(SUM(total),0) AS total
       FROM factures WHERE proveidorNom IS NOT NULL
       GROUP BY proveidorNom ORDER BY total DESC LIMIT 5`,
    )
    .all() as { nom: string; total: number }[];

  const resposta: StatsProveidor[] = top.map((r) => ({
    nom: r.nom,
    total: r.total,
    percentatge: totalGlobal > 0 ? Math.round((r.total / totalGlobal) * 100) : 0,
  }));
  res.json(resposta);
});

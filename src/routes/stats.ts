import { Router, type Request, type Response } from 'express';
import { supabase } from '../db/supabase.js';
import { MESOS_CA } from '../services/drive.js';
import type { StatsMensual, StatsProveidor, StatsResum } from '../types.js';

// ============================================================
//  /api/stats · resum, gràfic mensual i top proveïdors
//
//  PostgREST no fa SUM/GROUP BY sense una vista o una funció RPC, així que
//  demanem només les columnes necessàries i agreguem a JS. El volum és el
//  d'una fleca (centenars de files l'any), no compensa mantenir vistes.
// ============================================================

export const statsRouter = Router();

/** Missatge llegible d'un error de Supabase o de qualsevol excepció. */
function missatgeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Suma la columna `total` d'un conjunt de files, ignorant els nuls. */
function suma(files: { total: number | null }[]): number {
  return files.reduce((acc, f) => acc + (Number(f.total) || 0), 0);
}

/** Data d'avui en format `YYYY-MM-DD` (les dates es desen com a text). */
function avui(desplacamentDies = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + desplacamentDies);
  return d.toISOString().slice(0, 10);
}

// ---- GET /api/stats/resum ---------------------------------------------

statsRouter.get('/resum', async (_req: Request, res: Response) => {
  const mesActual = avui().slice(0, 7); // 'YYYY-MM'

  try {
    const [pendents, venciments, delMes] = await Promise.all([
      supabase.from('factures').select('total').eq('estat', 'pendent'),
      supabase
        .from('factures')
        .select('total')
        .eq('estat', 'pendent')
        .not('dataVenciment', 'is', null)
        .gte('dataVenciment', avui())
        .lte('dataVenciment', avui(7)),
      supabase.from('factures').select('total, estat').like('dataDocument', `${mesActual}%`),
    ]);

    for (const r of [pendents, venciments, delMes]) {
      if (r.error) throw new Error(r.error.message);
    }

    const filesMes = (delMes.data ?? []) as { total: number | null; estat: string }[];

    const resposta: StatsResum = {
      totalPendent: suma(pendents.data ?? []),
      vencen7dies: suma(venciments.data ?? []),
      facturesMes: filesMes.length,
      pagadaMes: suma(filesMes.filter((f) => f.estat === 'pagada')),
    };
    return res.json(resposta);
  } catch (err) {
    console.error('✗ Error calculant el resum:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- GET /api/stats/mensual (any actual) ------------------------------

statsRouter.get('/mensual', async (_req: Request, res: Response) => {
  const any = String(new Date().getFullYear());

  /** Acumula els totals per mes ('01'…'12') a partir de la data del document. */
  function perMes(files: { dataDocument: string | null; total: number | null }[]): Record<string, number> {
    const acc: Record<string, number> = {};
    for (const f of files) {
      if (!f.dataDocument) continue;
      const mm = f.dataDocument.slice(5, 7);
      acc[mm] = (acc[mm] ?? 0) + (Number(f.total) || 0);
    }
    return acc;
  }

  try {
    const [rebudes, emeses] = await Promise.all([
      supabase.from('factures').select('dataDocument, total').like('dataDocument', `${any}%`),
      supabase.from('factures_emeses').select('dataDocument, total').like('dataDocument', `${any}%`),
    ]);

    if (rebudes.error) throw new Error(rebudes.error.message);
    if (emeses.error) throw new Error(emeses.error.message);

    const reb = perMes(rebudes.data ?? []);
    const eme = perMes(emeses.data ?? []);

    const resposta: StatsMensual[] = MESOS_CA.map((_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return { mes: `${any}-${mm}`, rebudes: reb[mm] ?? 0, emeses: eme[mm] ?? 0 };
    });
    return res.json(resposta);
  } catch (err) {
    console.error('✗ Error calculant el gràfic mensual:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- GET /api/stats/proveidors (top 5 per import) ---------------------

statsRouter.get('/proveidors', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('factures')
      .select('proveidorNom, total')
      .not('proveidorNom', 'is', null);

    if (error) throw new Error(error.message);

    const files = (data ?? []) as { proveidorNom: string; total: number | null }[];

    const perProveidor = new Map<string, number>();
    for (const f of files) {
      perProveidor.set(f.proveidorNom, (perProveidor.get(f.proveidorNom) ?? 0) + (Number(f.total) || 0));
    }

    const totalGlobal = suma(files);

    const resposta: StatsProveidor[] = [...perProveidor.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nom, total]) => ({
        nom,
        total,
        percentatge: totalGlobal > 0 ? Math.round((total / totalGlobal) * 100) : 0,
      }));

    return res.json(resposta);
  } catch (err) {
    console.error('✗ Error calculant el top de proveïdors:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

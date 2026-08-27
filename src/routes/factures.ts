import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { extname } from 'node:path';
import { supabase } from '../db/supabase.js';
import { desarFitxer, llegirFitxer, mimeDe } from '../db/storage.js';
import { ingestarFactura } from '../services/ingest.js';
import {
  ESTAT_FACTURA,
  TIPUS_FACTURA,
  type Factura,
  type GastPendent,
  type Paginacio,
} from '../types.js';

// ============================================================
//  /api/factures · llista, detall, canvi d'estat, importació manual
//  Dades a Postgres (Supabase); originals al bucket `factures`.
// ============================================================

export const facturesRouter = Router();

/** Missatge llegible d'un error de Supabase o de qualsevol excepció. */
function missatgeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---- GET /api/factures (llista paginada + filtres) --------------------

facturesRouter.get('/', async (req: Request, res: Response) => {
  const { estat, tipus, mes, proveidorNom } = req.query;

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const offset = (page - 1) * limit;

  try {
    let q = supabase.from('factures').select('*', { count: 'exact' });

    if (typeof estat === 'string' && (ESTAT_FACTURA as readonly string[]).includes(estat)) {
      q = q.eq('estat', estat);
    }
    if (typeof tipus === 'string' && (TIPUS_FACTURA as readonly string[]).includes(tipus)) {
      q = q.eq('tipus', tipus);
    }
    if (typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes)) {
      q = q.like('dataDocument', `${mes}%`);
    }
    if (typeof proveidorNom === 'string' && proveidorNom.trim()) {
      q = q.ilike('proveidorNom', `%${proveidorNom.trim()}%`);
    }

    // Equival a `COALESCE(dataDocument, createdAt) DESC, id DESC`: PostgREST no
    // té COALESCE dins d'`order`, així que les factures sense data van al final.
    const { data, count, error } = await q
      .order('dataDocument', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);

    const total = count ?? 0;
    const resposta: Paginacio<Factura> = {
      dades: (data ?? []) as Factura[],
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
    return res.json(resposta);
  } catch (err) {
    console.error('✗ Error llistant factures:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- GET /api/factures/:id (detall + rawExtractJson) ------------------

facturesRouter.get('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  try {
    const { data, error } = await supabase
      .from('factures')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Factura no trobada.' });

    return res.json(data as Factura);
  } catch (err) {
    console.error('✗ Error llegint la factura:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- PATCH /api/factures/:id/estat ------------------------------------

facturesRouter.patch('/:id/estat', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  const { estat } = req.body ?? {};
  if (typeof estat !== 'string' || !(ESTAT_FACTURA as readonly string[]).includes(estat)) {
    return res.status(400).json({
      error: `Estat no vàlid. Valors permesos: ${ESTAT_FACTURA.join(', ')}.`,
    });
  }

  try {
    // A SQLite un trigger mantenia `updatedAt`; a Postgres el posem aquí.
    const { data, error } = await supabase
      .from('factures')
      .update({ estat, updatedAt: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Factura no trobada.' });

    return res.json(data as Factura);
  } catch (err) {
    console.error('✗ Error actualitzant l\'estat:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- GET /api/factures/:id/pdf (descàrrega del fitxer original) -------

facturesRouter.get('/:id/pdf', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  try {
    const { data: factura, error } = await supabase
      .from('factures')
      .select('fitxerLocal, proveidorNom, dataDocument')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!factura) return res.status(404).json({ error: 'Factura no trobada.' });
    if (!factura.fitxerLocal) {
      return res.status(404).json({ error: 'Aquesta factura no té fitxer adjunt.' });
    }

    const buffer = await llegirFitxer(factura.fitxerLocal);

    const ext = extname(factura.fitxerLocal) || '.pdf';
    const nomNet = `${factura.proveidorNom ?? 'factura'}_${factura.dataDocument ?? 'sense-data'}${ext}`
      .replace(/["\r\n]/g, '')
      .replace(/\s+/g, '_');

    res.setHeader('Content-Type', mimeDe(factura.fitxerLocal));
    res.setHeader('Content-Disposition', `attachment; filename="${nomNet}"`);
    return res.send(buffer);
  } catch (err) {
    console.error('✗ Error descarregant el fitxer:', err);
    return res.status(404).json({ error: 'Fitxer no trobat al bucket.' });
  }
});

// ---- POST /api/factures/import (multipart: file) ----------------------

const EXTENSIONS_VALIDES = /\.(pdf|jpe?g|png)$/i;

// A memòria, no a disc: a Vercel el filesystem és efímer i el fitxer va
// directe al bucket de Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (EXTENSIONS_VALIDES.test(file.originalname)) cb(null, true);
    else cb(new Error('Format no suportat. Només PDF, JPG o PNG.'));
  },
});

facturesRouter.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Cap fitxer rebut (camp "file").' });

  try {
    const ext = extname(req.file.originalname).toLowerCase() || '.pdf';
    const ruta = await desarFitxer(req.file.buffer, `manual_${Date.now()}${ext}`);
    const resultat = await ingestarFactura(ruta, 'manual');
    return res.status(201).json(resultat);
  } catch (err) {
    console.error('✗ Error en la importació manual:', err);
    return res.status(500).json({ error: 'No s\'ha pogut processar el fitxer.', detall: String(err) });
  }
});

// ============================================================
//  /api/pendents · safata de revisió (taula `gastos_pendents`)
//  Tot el que entra per Gmail o per importació manual hi aterra primer.
//  Confirmar → crea la factura a `factures` i buida la fila de la safata.
//  Descartar → esborra només la fila; l'original es conserva al bucket.
// ============================================================

export const pendentsRouter = Router();

/** Mapeja una fila de `gastos_pendents` als camps de `factures`. */
function pendentAFactura(p: GastPendent): Record<string, unknown> {
  const tipus = (TIPUS_FACTURA as readonly string[]).includes(p.categoria ?? '')
    ? (p.categoria as string)
    : 'desconegut';

  return {
    tipus,
    numero: null,
    proveidorNom: p.proveidor,
    proveidorNif: p.nrt,
    dataDocument: p.data,
    dataVenciment: null,
    baseImposable: p.baseImposable,
    iva: p.quotaIgi,
    total: p.import,
    moneda: 'EUR',
    concepte: p.concepte,
    estat: 'pendent',
    fontEntrada: p.remitent ? 'email' : 'manual',
    fitxerLocal: p.adjuntPath,
    driveId: null,
    drivePath: null,
    confian_ia: null,
    rawExtractJson: null,
  };
}

// ---- GET /api/pendents (safata sencera, més recents primer) ----------

pendentsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('gastos_pendents')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) throw new Error(error.message);
    return res.json({ dades: (data ?? []) as GastPendent[], total: data?.length ?? 0 });
  } catch (err) {
    console.error('✗ Error llegint la safata de revisió:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- POST /api/pendents/:id/confirmar --------------------------------

pendentsRouter.post('/:id/confirmar', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  try {
    const { data: pendent, error: errLectura } = await supabase
      .from('gastos_pendents')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (errLectura) throw new Error(errLectura.message);
    if (!pendent) return res.status(404).json({ error: 'Despesa pendent no trobada.' });

    // Camps editats a la safata abans de confirmar (tots opcionals).
    const edicions = (req.body ?? {}) as Partial<GastPendent>;
    const fila = pendentAFactura({ ...(pendent as GastPendent), ...edicions });

    const { data: factura, error: errInsercio } = await supabase
      .from('factures')
      .insert(fila)
      .select('*')
      .single();

    if (errInsercio) throw new Error(errInsercio.message);

    // Només buidem la safata un cop la factura ja existeix.
    const { error: errEsborrat } = await supabase.from('gastos_pendents').delete().eq('id', id);
    if (errEsborrat) {
      console.warn(
        `⚠️  Factura #${factura.id} creada però la pendent #${id} no s'ha esborrat:`,
        errEsborrat.message,
      );
    }

    return res.status(201).json(factura as Factura);
  } catch (err) {
    console.error('✗ Error confirmant la despesa pendent:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- DELETE /api/pendents/:id (descartar) ----------------------------

pendentsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  try {
    const { data, error } = await supabase
      .from('gastos_pendents')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Despesa pendent no trobada.' });
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error('✗ Error descartant la despesa pendent:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

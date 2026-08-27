import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { db } from '../db/db.js';
import { getSupabase, ingestarFactura } from '../services/ingest.js';
import {
  ESTAT_FACTURA,
  TIPUS_FACTURA,
  type Factura,
  type GastPendent,
  type Paginacio,
} from '../types.js';

// ============================================================
//  /api/factures · llista, detall, canvi d'estat, importació manual
// ============================================================

export const facturesRouter = Router();

// ---- GET /api/factures (llista paginada + filtres) --------------------

facturesRouter.get('/', (req: Request, res: Response) => {
  const { estat, tipus, mes, proveidorNom } = req.query;

  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (typeof estat === 'string' && (ESTAT_FACTURA as readonly string[]).includes(estat)) {
    where.push('estat = @estat');
    params.estat = estat;
  }
  if (typeof tipus === 'string' && (TIPUS_FACTURA as readonly string[]).includes(tipus)) {
    where.push('tipus = @tipus');
    params.tipus = tipus;
  }
  if (typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes)) {
    where.push("dataDocument LIKE @mes || '%'");
    params.mes = mes;
  }
  if (typeof proveidorNom === 'string' && proveidorNom.trim()) {
    where.push('proveidorNom LIKE @proveidorNom');
    params.proveidorNom = `%${proveidorNom.trim()}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const offset = (page - 1) * limit;

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM factures ${whereSql}`).get(params) as { n: number }
  ).n;

  const dades = db
    .prepare(
      `SELECT * FROM factures ${whereSql}
       ORDER BY COALESCE(dataDocument, createdAt) DESC, id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as Factura[];

  const resposta: Paginacio<Factura> = {
    dades,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
  res.json(resposta);
});

// ---- GET /api/factures/:id (detall + rawExtractJson) ------------------

facturesRouter.get('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  const factura = db.prepare('SELECT * FROM factures WHERE id = ?').get(id) as Factura | undefined;
  if (!factura) return res.status(404).json({ error: 'Factura no trobada.' });

  return res.json(factura);
});

// ---- PATCH /api/factures/:id/estat ------------------------------------

facturesRouter.patch('/:id/estat', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  const { estat } = req.body ?? {};
  if (typeof estat !== 'string' || !(ESTAT_FACTURA as readonly string[]).includes(estat)) {
    return res.status(400).json({
      error: `Estat no vàlid. Valors permesos: ${ESTAT_FACTURA.join(', ')}.`,
    });
  }

  const info = db.prepare('UPDATE factures SET estat = ? WHERE id = ?').run(estat, id);
  if (info.changes === 0) return res.status(404).json({ error: 'Factura no trobada.' });

  const factura = db.prepare('SELECT * FROM factures WHERE id = ?').get(id) as Factura;
  return res.json(factura);
});

// ---- GET /api/factures/:id/pdf (descàrrega del fitxer original) -------

facturesRouter.get('/:id/pdf', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  const factura = db
    .prepare('SELECT fitxerLocal, proveidorNom, dataDocument FROM factures WHERE id = ?')
    .get(id) as { fitxerLocal: string | null; proveidorNom: string | null; dataDocument: string | null } | undefined;

  if (!factura) return res.status(404).json({ error: 'Factura no trobada.' });
  if (!factura.fitxerLocal) return res.status(404).json({ error: 'Aquesta factura no té fitxer adjunt.' });
  if (!existsSync(factura.fitxerLocal)) return res.status(404).json({ error: 'Fitxer no trobat al disc.' });

  const ext = extname(factura.fitxerLocal) || '.pdf';
  const nomNet = `${factura.proveidorNom ?? 'factura'}_${factura.dataDocument ?? 'sense-data'}${ext}`
    .replace(/["\r\n]/g, '')
    .replace(/\s+/g, '_');

  res.setHeader('Content-Disposition', `attachment; filename="${nomNet}"`);
  return res.sendFile(factura.fitxerLocal);
});

// ---- POST /api/factures/import (multipart: file) ----------------------

const UPLOADS_DIR = resolve(process.cwd(), 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const EXTENSIONS_VALIDES = /\.(pdf|jpe?g|png)$/i;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase() || '.pdf';
    cb(null, `manual_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (EXTENSIONS_VALIDES.test(file.originalname)) cb(null, true);
    else cb(new Error('Format no suportat. Només PDF, JPG o PNG.'));
  },
});

facturesRouter.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Cap fitxer rebut (camp "file").' });

  try {
    const resultat = await ingestarFactura(req.file.path, 'manual');
    return res.status(201).json(resultat);
  } catch (err) {
    console.error('✗ Error en la importació manual:', err);
    return res.status(500).json({ error: 'No s\'ha pogut processar el fitxer.', detall: String(err) });
  }
});

// ============================================================
//  /api/pendents · safata de revisió (taula `gastos_pendents` a Supabase)
//  Tot el que entra per Gmail o per importació manual hi aterra primer.
//  Confirmar → crea la factura a SQLite i buida la fila de la safata.
//  Descartar → només esborra la fila (el fitxer resta a `uploads/`).
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

const insertFacturaConfirmada = db.prepare(`
  INSERT INTO factures (
    tipus, numero, proveidorNom, proveidorNif, dataDocument, dataVenciment,
    baseImposable, iva, total, moneda, concepte, estat, fontEntrada,
    fitxerLocal, driveId, drivePath, confian_ia, rawExtractJson
  ) VALUES (
    @tipus, @numero, @proveidorNom, @proveidorNif, @dataDocument, @dataVenciment,
    @baseImposable, @iva, @total, @moneda, @concepte, @estat, @fontEntrada,
    @fitxerLocal, @driveId, @drivePath, @confian_ia, @rawExtractJson
  )
`);

// ---- GET /api/pendents (safata sencera, més recents primer) ----------

pendentsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('gastos_pendents')
      .select('*')
      .order('createdAt', { ascending: false });

    if (error) throw new Error(error.message);
    return res.json({ dades: (data ?? []) as GastPendent[], total: data?.length ?? 0 });
  } catch (err) {
    console.error('✗ Error llegint la safata de revisió:', err);
    return res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ---- POST /api/pendents/:id/confirmar --------------------------------

pendentsRouter.post('/:id/confirmar', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  try {
    const supabase = await getSupabase();

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

    const info = insertFacturaConfirmada.run(fila);
    const factura = db
      .prepare('SELECT * FROM factures WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as Factura;

    // Només buidem la safata un cop la factura ja és a SQLite.
    const { error: errEsborrat } = await supabase.from('gastos_pendents').delete().eq('id', id);
    if (errEsborrat) {
      console.warn(`⚠️  Factura #${factura.id} creada però la pendent #${id} no s'ha esborrat:`, errEsborrat.message);
    }

    return res.status(201).json(factura);
  } catch (err) {
    console.error('✗ Error confirmant la despesa pendent:', err);
    return res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// ---- DELETE /api/pendents/:id (descartar) ----------------------------

pendentsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('gastos_pendents')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return res.status(404).json({ error: 'Despesa pendent no trobada.' });

    return res.json({ ok: true, id });
  } catch (err) {
    console.error('✗ Error descartant la despesa pendent:', err);
    return res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

import { Router, type Request, type Response } from 'express';
import { db } from '../db/db.js';
import { ESTAT_EMESA, type FacturaEmesa, type Paginacio } from '../types.js';

// ============================================================
//  /api/factures-emeses · factures emeses (clients)
//  Llista, creació manual i canvi d'estat.
// ============================================================

export const emesesRouter = Router();

// ---- GET /api/factures-emeses (llista paginada + filtres) -------------

emesesRouter.get('/', (req: Request, res: Response) => {
  const { estat, mes, clientNom } = req.query;

  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (typeof estat === 'string' && (ESTAT_EMESA as readonly string[]).includes(estat)) {
    where.push('estat = @estat');
    params.estat = estat;
  }
  if (typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes)) {
    where.push("dataDocument LIKE @mes || '%'");
    params.mes = mes;
  }
  if (typeof clientNom === 'string' && clientNom.trim()) {
    where.push('clientNom LIKE @clientNom');
    params.clientNom = `%${clientNom.trim()}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const offset = (page - 1) * limit;

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM factures_emeses ${whereSql}`).get(params) as { n: number }
  ).n;

  const dades = db
    .prepare(
      `SELECT * FROM factures_emeses ${whereSql}
       ORDER BY COALESCE(dataDocument, createdAt) DESC, id DESC
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as FacturaEmesa[];

  const resposta: Paginacio<FacturaEmesa> = {
    dades,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
  res.json(resposta);
});

// ---- POST /api/factures-emeses (creació manual) -----------------------

emesesRouter.post('/', (req: Request, res: Response) => {
  const b = req.body ?? {};

  if (typeof b.numero !== 'string' || !b.numero.trim()) {
    return res.status(400).json({ error: 'El camp "numero" és obligatori.' });
  }

  const total = Number(b.total) || 0;
  const iva = b.iva != null ? Number(b.iva) : null;
  const baseImposable = b.baseImposable != null ? Number(b.baseImposable) : total && iva != null ? total - iva : null;

  try {
    const info = db
      .prepare(
        `INSERT INTO factures_emeses
           (numero, clientNom, clientNif, dataDocument, dataVenciment, baseImposable, iva, total, concepte, estat)
         VALUES (@numero, @clientNom, @clientNif, @dataDocument, @dataVenciment, @baseImposable, @iva, @total, @concepte, 'pendent')`,
      )
      .run({
        numero: b.numero.trim(),
        clientNom: b.clientNom ?? null,
        clientNif: b.clientNif ?? null,
        dataDocument: typeof b.dataDocument === 'string' ? b.dataDocument : null,
        dataVenciment: typeof b.dataVenciment === 'string' ? b.dataVenciment : null,
        baseImposable,
        iva,
        total,
        concepte: b.concepte ?? null,
      });

    const creada = db
      .prepare('SELECT * FROM factures_emeses WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as FacturaEmesa;
    return res.status(201).json(creada);
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: `Ja existeix una factura emesa amb el número "${b.numero}".` });
    }
    console.error('✗ Error creant factura emesa:', err);
    return res.status(500).json({ error: 'No s\'ha pogut crear la factura emesa.' });
  }
});

// ---- PATCH /api/factures-emeses/:id/estat -----------------------------

emesesRouter.patch('/:id/estat', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  const { estat } = req.body ?? {};
  if (typeof estat !== 'string' || !(ESTAT_EMESA as readonly string[]).includes(estat)) {
    return res.status(400).json({ error: `Estat no vàlid. Valors permesos: ${ESTAT_EMESA.join(', ')}.` });
  }

  const info = db.prepare('UPDATE factures_emeses SET estat = ? WHERE id = ?').run(estat, id);
  if (info.changes === 0) return res.status(404).json({ error: 'Factura emesa no trobada.' });

  const factura = db.prepare('SELECT * FROM factures_emeses WHERE id = ?').get(id) as FacturaEmesa;
  return res.json(factura);
});

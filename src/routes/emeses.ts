import { Router, type Request, type Response } from 'express';
import { supabase } from '../db/supabase.js';
import { ESTAT_EMESA, type FacturaEmesa, type Paginacio } from '../types.js';

// ============================================================
//  /api/factures-emeses · factures emeses (clients)
//  Llista, creació manual i canvi d'estat. Dades a Postgres (Supabase).
// ============================================================

export const emesesRouter = Router();

/** Missatge llegible d'un error de Supabase o de qualsevol excepció. */
function missatgeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---- GET /api/factures-emeses (llista paginada + filtres) -------------

emesesRouter.get('/', async (req: Request, res: Response) => {
  const { estat, mes, clientNom } = req.query;

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const offset = (page - 1) * limit;

  try {
    let q = supabase.from('factures_emeses').select('*', { count: 'exact' });

    if (typeof estat === 'string' && (ESTAT_EMESA as readonly string[]).includes(estat)) {
      q = q.eq('estat', estat);
    }
    if (typeof mes === 'string' && /^\d{4}-\d{2}$/.test(mes)) {
      q = q.like('dataDocument', `${mes}%`);
    }
    if (typeof clientNom === 'string' && clientNom.trim()) {
      q = q.ilike('clientNom', `%${clientNom.trim()}%`);
    }

    // Com a `factures`: sense data al final, desempat per `id`.
    const { data, count, error } = await q
      .order('dataDocument', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    const total = count ?? 0;
    const resposta: Paginacio<FacturaEmesa> = {
      dades: (data ?? []) as FacturaEmesa[],
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
    return res.json(resposta);
  } catch (err) {
    console.error('✗ Error llistant factures emeses:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

// ---- POST /api/factures-emeses (creació manual) -----------------------

emesesRouter.post('/', async (req: Request, res: Response) => {
  const b = req.body ?? {};

  if (typeof b.numero !== 'string' || !b.numero.trim()) {
    return res.status(400).json({ error: 'El camp "numero" és obligatori.' });
  }

  const total = Number(b.total) || 0;
  const iva = b.iva != null ? Number(b.iva) : null;
  const baseImposable =
    b.baseImposable != null ? Number(b.baseImposable) : total && iva != null ? total - iva : null;

  try {
    const { data, error } = await supabase
      .from('factures_emeses')
      .insert({
        numero: b.numero.trim(),
        clientNom: b.clientNom ?? null,
        clientNif: b.clientNif ?? null,
        dataDocument: typeof b.dataDocument === 'string' ? b.dataDocument : null,
        dataVenciment: typeof b.dataVenciment === 'string' ? b.dataVenciment : null,
        baseImposable,
        iva,
        total,
        concepte: b.concepte ?? null,
        estat: 'pendent',
      })
      .select('*')
      .single();

    // 23505 = unique_violation sobre `numero`.
    if (error?.code === '23505') {
      return res
        .status(409)
        .json({ error: `Ja existeix una factura emesa amb el número "${b.numero}".` });
    }
    if (error) throw new Error(error.message);

    return res.status(201).json(data as FacturaEmesa);
  } catch (err) {
    console.error('✗ Error creant factura emesa:', err);
    return res.status(500).json({ error: 'No s\'ha pogut crear la factura emesa.' });
  }
});

// ---- PATCH /api/factures-emeses/:id/estat -----------------------------

emesesRouter.patch('/:id/estat', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'ID no vàlid.' });

  const { estat } = req.body ?? {};
  if (typeof estat !== 'string' || !(ESTAT_EMESA as readonly string[]).includes(estat)) {
    return res.status(400).json({ error: `Estat no vàlid. Valors permesos: ${ESTAT_EMESA.join(', ')}.` });
  }

  try {
    const { data, error } = await supabase
      .from('factures_emeses')
      .update({ estat })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Factura emesa no trobada.' });

    return res.json(data as FacturaEmesa);
  } catch (err) {
    console.error('✗ Error actualitzant l\'estat de la factura emesa:', err);
    return res.status(500).json({ error: missatgeError(err) });
  }
});

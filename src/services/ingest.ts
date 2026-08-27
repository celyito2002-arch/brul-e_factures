import type { SupabaseClient } from '@supabase/supabase-js';
import { extreureFactura } from './extractor.js';
import type { FontEntrada, GastPendent, NouGastPendent } from '../types.js';

// ============================================================
//  Canonada d'ingesta compartida (Gmail + importació manual):
//  fitxer → GPT-4o → `gastos_pendents` (Supabase) = safata de revisió.
//  Res entra directament a `factures`: primer ha de passar per la safata,
//  on l'usuari confirma (→ SQLite) o descarta (veure routes/factures.ts).
//  El fitxer original resta a `uploads/` (`adjuntPath`).
// ============================================================

/**
 * Client Supabase mandrós. `db/supabase.ts` crea el client en importar-se i
 * peta si falten les claus, així que el carreguem sota demanda: el servidor
 * ha de poder arrencar (dashboard, factures ja confirmades…) encara que
 * Supabase no estigui configurat.
 */
let _supabase: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (_supabase) return _supabase;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Falten SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY al .env (safata de revisió).',
    );
  }
  const { supabase } = await import('../db/supabase.js');
  _supabase = supabase;
  return _supabase;
}

/** Metadades del correu d'origen, quan la ingesta ve de Gmail. */
export interface MetaOrigen {
  remitent?: string | null;
  assumpte?: string | null;
  /** Identificador únic (gmailId + nom de l'adjunt) per evitar duplicats. */
  uidCorreu?: string | null;
}

export interface ResultatIngesta {
  pendentId: number;
  proveidorNom: string | null;
  total: number | null;
  estat: string;
  confian_ia: number;
  /** `true` si l'adjunt ja era a la safata (mateix `uidCorreu`). */
  duplicat: boolean;
}

/**
 * Processa un fitxer (PDF/JPG/PNG) i el desa a la safata de revisió.
 * Ordre: extreu amb GPT-4o → insereix a `gastos_pendents`.
 *
 * @param fitxerLocal ruta del fitxer dins `uploads/`
 * @param fontEntrada d'on ve (email / foto / manual) — es guarda a `categoria`
 * @param meta        remitent i assumpte del correu, si n'hi ha
 */
export async function ingestarFactura(
  fitxerLocal: string,
  fontEntrada: FontEntrada,
  meta: MetaOrigen = {},
): Promise<ResultatIngesta> {
  const { extraccio, estatSuggerit } = await extreureFactura(fitxerLocal);
  const supabase = await getSupabase();

  const fila: NouGastPendent = {
    proveidor: extraccio.proveidorNom,
    nrt: extraccio.proveidorNif,
    concepte: extraccio.concepte,
    import: extraccio.total,
    data: extraccio.dataDocument,
    categoria: extraccio.tipus,
    baseImposable: extraccio.baseImposable,
    quotaIgi: extraccio.iva,
    adjuntPath: fitxerLocal,
    remitent: meta.remitent ?? null,
    assumpte: meta.assumpte ?? null,
    uidCorreu: meta.uidCorreu ?? `${fontEntrada}:${fitxerLocal}`,
  };

  const { data, error } = await supabase
    .from('gastos_pendents')
    .insert(fila)
    .select('id')
    .single();

  // 23505 = unique_violation sobre `uidCorreu`: aquest adjunt ja és a la safata.
  if (error && error.code === '23505') {
    const { data: existent } = await supabase
      .from('gastos_pendents')
      .select('id')
      .eq('uidCorreu', fila.uidCorreu)
      .single();

    return {
      pendentId: Number((existent as Pick<GastPendent, 'id'> | null)?.id ?? 0),
      proveidorNom: extraccio.proveidorNom,
      total: extraccio.total,
      estat: estatSuggerit,
      confian_ia: extraccio.confian_ia,
      duplicat: true,
    };
  }

  if (error) throw new Error(`Supabase (gastos_pendents): ${error.message}`);

  return {
    pendentId: Number(data.id),
    proveidorNom: extraccio.proveidorNom,
    total: extraccio.total,
    estat: estatSuggerit,
    confian_ia: extraccio.confian_ia,
    duplicat: false,
  };
}

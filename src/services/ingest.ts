import { supabase } from '../db/supabase.js';
import { extreureFactura } from './extractor.js';
import type { FontEntrada, NouGastPendent } from '../types.js';

// ============================================================
//  Canonada d'ingesta compartida (Gmail + importació manual):
//  fitxer (Supabase Storage) → GPT-4o → `gastos_pendents` = safata de revisió.
//  Res entra directament a `factures`: primer ha de passar per la safata,
//  on l'usuari confirma o descarta (veure routes/factures.ts).
// ============================================================

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
 * Processa un fitxer ja pujat al bucket `factures` i el desa a la safata.
 * Ordre: extreu amb GPT-4o → insereix a `gastos_pendents`.
 *
 * @param rutaFitxer  camí dins del bucket `factures` (veure db/storage.ts)
 * @param fontEntrada d'on ve (email / foto / manual)
 * @param meta        remitent i assumpte del correu, si n'hi ha
 */
export async function ingestarFactura(
  rutaFitxer: string,
  fontEntrada: FontEntrada,
  meta: MetaOrigen = {},
): Promise<ResultatIngesta> {
  const { extraccio, estatSuggerit } = await extreureFactura(rutaFitxer);

  const fila: NouGastPendent = {
    proveidor: extraccio.proveidorNom,
    nrt: extraccio.proveidorNif,
    concepte: extraccio.concepte,
    import: extraccio.total,
    data: extraccio.dataDocument,
    categoria: extraccio.tipus,
    baseImposable: extraccio.baseImposable,
    quotaIgi: extraccio.iva,
    adjuntPath: rutaFitxer,
    remitent: meta.remitent ?? null,
    assumpte: meta.assumpte ?? null,
    uidCorreu: meta.uidCorreu ?? `${fontEntrada}:${rutaFitxer}`,
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
      .maybeSingle();

    return {
      pendentId: Number(existent?.id ?? 0),
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

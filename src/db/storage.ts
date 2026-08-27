import { supabase } from './supabase.js';

// ============================================================
//  Emmagatzematge de fitxers · Supabase Storage (bucket `factures`).
//  Substitueix la carpeta local `uploads/`, que no sobreviu a Vercel
//  (filesystem efímer i propi de cada invocació serverless).
//  Les rutes que es desen a `factures.fitxerLocal` són ara camins DINS
//  del bucket, no del disc.
// ============================================================

const BUCKET = 'factures';

const MIME_PER_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Tipus MIME a partir de l'extensió del nom (per servir el fitxer correctament). */
export function mimeDe(nomFitxer: string): string {
  const punt = nomFitxer.lastIndexOf('.');
  const ext = punt >= 0 ? nomFitxer.slice(punt).toLowerCase() : '';
  return MIME_PER_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Puja un fitxer al bucket `factures` i retorna el seu camí dins del bucket.
 *
 * Els noms que generem ja són únics per construcció (`{gmailId}_{adjunt}` per
 * a Gmail, `manual_{timestamp}.ext` per a la importació manual), de manera que
 * l'`upsert` només pot reescriure un objecte amb el mateix origen — mai el
 * document d'un altre proveïdor.
 */
export async function desarFitxer(buffer: Buffer, nomFitxer: string): Promise<string> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(nomFitxer, buffer, { upsert: true, contentType: mimeDe(nomFitxer) });

  if (error) throw error;
  return nomFitxer; // camí dins el bucket
}

/** Descarrega un fitxer del bucket `factures` a memòria. */
export async function llegirFitxer(ruta: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(ruta);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

/** Esborra un fitxer del bucket (best-effort, per netejar descarts). */
export async function esborrarFitxer(ruta: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([ruta]);
  if (error) console.warn(`⚠️  No s'ha pogut esborrar "${ruta}" del bucket:`, error.message);
}

// src/db/storage.ts
// Abstracció de l'emmagatzematge de fitxers.
// LOCAL: guarda a /uploads/
// SUPABASE (futur): pujar a Supabase Storage bucket 'factures'

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const UPLOADS_DIR = resolve(process.cwd(), 'uploads');

export async function desarFitxer(buffer: Buffer, nomFitxer: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const ruta = resolve(UPLOADS_DIR, nomFitxer);
  await writeFile(ruta, buffer);
  return ruta; // en Supabase seria una URL pública
}

export async function llegirFitxer(ruta: string): Promise<Buffer> {
  return readFile(ruta);
}

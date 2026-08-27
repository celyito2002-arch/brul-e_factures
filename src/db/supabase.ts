import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

// ============================================================
//  Client Supabase · única connexió a la base de dades i al Storage.
//  Postgres és la font de veritat; els originals viuen al bucket `factures`.
//  Fem servir la service_role key: salta el RLS, així que MAI ha de sortir
//  del servidor (no s'exposa a `public/`).
// ============================================================

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !key) {
  throw new Error(
    'Falten SUPABASE_URL i/o SUPABASE_SERVICE_ROLE_KEY. ' +
      'Copia .env.example a .env i omple-les (Supabase → Project Settings → API).',
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

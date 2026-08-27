// ============================================================
//  Brulée · Worker de lectura automàtica de Gmail
//
//  Cada 15 min: Gmail → adjunts → gpt-4o-mini → `gastos_pendents` (safata
//  de revisió de Supabase). Independent del projecte Express: no comparteix
//  codi ni dependències, només les mateixes taules i el mateix bucket.
//
//  Tot amb `fetch` natiu: el paquet `googleapis` no funciona bé al Worker
//  (depèn d'APIs de Node que el runtime no ofereix).
//
//  Secrets (wrangler secret put …): veure `Env`.
// ============================================================

export interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN: string;
  OPENAI_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_QUERY = 'is:unread newer_than:7d has:attachment';
const MAX_MISSATGES = 2;

const EXTENSIONS_VALIDES = /\.(pdf|jpe?g|png)$/i;
const BUCKET = 'factures';
const MODEL = 'gpt-4o-mini';

const PROMPT = `You are an accountant assistant for a bakery in Andorra. Extract invoice data from this document.
Return ONLY valid JSON: {"proveidor": string|null, "nrt": string|null, "concepte": string|null, "import": number|null, "data": "YYYY-MM-DD"|null, "categoria": string|null, "baseImposable": number|null, "quotaIgi": number|null}
For Andorran documents: IGI = IVA, standard rate 4.5%. If a field is unclear return null.`;

/** Valors permesos per `automatitzacio_log.resultat` (CHECK a Postgres). */
type Resultat = 'ok' | 'error' | 'sense_adjunt' | 'descartat';

interface Extraccio {
  proveidor: string | null;
  nrt: string | null;
  concepte: string | null;
  import: number | null;
  data: string | null;
  categoria: string | null;
  baseImposable: number | null;
  quotaIgi: number | null;
}

// ---- Utilitats --------------------------------------------------------

const MIME_PER_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

function mimeDe(nomFitxer: string): string {
  const ext = nomFitxer.split('.').pop()?.toLowerCase() ?? '';
  return MIME_PER_EXT[ext] ?? 'application/octet-stream';
}

/** Gmail retorna base64url; el convertim a base64 estàndard (amb padding). */
function base64UrlABase64(dades: string): string {
  const b64 = dades.replace(/-/g, '+').replace(/_/g, '/');
  return b64 + '='.repeat((4 - (b64.length % 4)) % 4);
}

/** base64 → bytes, per pujar l'original a Supabase Storage. */
function base64ABytes(b64: string): Uint8Array {
  const binari = atob(b64);
  const bytes = new Uint8Array(binari.length);
  for (let i = 0; i < binari.length; i += 1) bytes[i] = binari.charCodeAt(i);
  return bytes;
}

/** Llança un error amb el cos de la resposta: els 4xx de Google i OpenAI hi expliquen la causa. */
async function assegurarOk(res: Response, context: string): Promise<Response> {
  if (res.ok) return res;
  const cos = await res.text().catch(() => '');
  throw new Error(`${context}: HTTP ${res.status} ${cos.slice(0, 300)}`);
}

// ---- Google OAuth -----------------------------------------------------

/** Bescanvia el refresh token per un access token (val ~1 h, un per cicle). */
async function obtenirAccessToken(env: Env): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  await assegurarOk(res, "No s'ha pogut refrescar el token de Google");
  const dades = (await res.json()) as { access_token?: string };
  if (!dades.access_token) throw new Error('Google no ha retornat cap access_token.');
  return dades.access_token;
}

// ---- Gmail ------------------------------------------------------------

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { attachmentId?: string; data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailMessage {
  id?: string;
  payload?: GmailPart & { headers?: GmailHeader[] };
}

async function gmailGet<T>(token: string, url: string, context: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  await assegurarOk(res, context);
  return (await res.json()) as T;
}

/** Valor d'una capçalera del missatge (case-insensitive). */
function capcalera(headers: GmailHeader[] | undefined, nom: string): string {
  const h = (headers ?? []).find((x) => (x.name ?? '').toLowerCase() === nom.toLowerCase());
  return h?.value ?? '';
}

interface Adjunt {
  filename: string;
  attachmentId: string;
}

/** Recorre recursivament les parts MIME cercant adjunts PDF/JPG/PNG. */
function trobarAdjunts(part: GmailPart | undefined, out: Adjunt[]): void {
  if (!part) return;
  const filename = part.filename ?? '';
  const attachmentId = part.body?.attachmentId ?? '';
  if (filename && attachmentId && EXTENSIONS_VALIDES.test(filename)) {
    out.push({ filename, attachmentId });
  }
  for (const sub of part.parts ?? []) trobarAdjunts(sub, out);
}

/** Baixa un adjunt i el retorna en base64 estàndard. */
async function baixarAdjunt(token: string, messageId: string, adjunt: Adjunt): Promise<string> {
  const dades = await gmailGet<{ data?: string }>(
    token,
    `${GMAIL_API}/messages/${messageId}/attachments/${adjunt.attachmentId}`,
    `No s'ha pogut baixar l'adjunt ${adjunt.filename}`,
  );
  if (!dades.data) throw new Error(`Adjunt sense dades: ${adjunt.filename}`);
  return base64UrlABase64(dades.data);
}

/** Treu l'etiqueta UNREAD perquè el proper cicle no el torni a agafar. */
async function marcarLlegit(token: string, messageId: string): Promise<void> {
  const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
  if (!res.ok) {
    const cos = await res.text().catch(() => '');
    console.warn(`⚠️  No s'ha pogut marcar com a llegit ${messageId}: ${res.status} ${cos.slice(0, 200)}`);
  }
}

// ---- OpenAI -----------------------------------------------------------

/**
 * Envia el document a gpt-4o-mini i valida el JSON de tornada.
 * Els PDF viatgen com a part `file` (base64 en línia, sense passar per la
 * Files API); les imatges com a `image_url`.
 */
async function extreureDades(env: Env, base64: string, nomFitxer: string): Promise<Extraccio> {
  const mime = mimeDe(nomFitxer);
  const dataUri = `data:${mime};base64,${base64}`;

  const contingut =
    mime === 'application/pdf'
      ? [
          { type: 'text', text: PROMPT },
          { type: 'file', file: { filename: nomFitxer, file_data: dataUri } },
        ]
      : [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
        ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: contingut }],
    }),
  });

  await assegurarOk(res, "L'extracció amb gpt-4o-mini ha fallat");
  const resposta = (await res.json()) as { choices?: { message?: { content?: string } }[] };

  const raw = resposta.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('gpt-4o-mini ha retornat una resposta buida.');

  const json = JSON.parse(raw) as Partial<Extraccio>;
  const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
  const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  return {
    proveidor: txt(json.proveidor),
    nrt: txt(json.nrt),
    concepte: txt(json.concepte),
    import: num(json.import),
    data: /^\d{4}-\d{2}-\d{2}$/.test(String(json.data)) ? String(json.data) : null,
    categoria: txt(json.categoria),
    baseImposable: num(json.baseImposable),
    quotaIgi: num(json.quotaIgi),
  };
}

// ---- Supabase (PostgREST + Storage per fetch) -------------------------

function capceleresSupabase(env: Env): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

/** Cert si aquest uid ja consta a `automatitzacio_log`. */
async function jaProcessat(env: Env, uid: string): Promise<boolean> {
  const url = `${env.SUPABASE_URL}/rest/v1/automatitzacio_log?uid=eq.${encodeURIComponent(uid)}&select=uid&limit=1`;
  const res = await fetch(url, { headers: capceleresSupabase(env) });
  await assegurarOk(res, 'No s\'ha pogut consultar automatitzacio_log');
  const files = (await res.json()) as unknown[];
  return files.length > 0;
}

/** Deixa constància del resultat. `uid` és únic: si ja hi és, ignorem el 409. */
async function registrarLog(env: Env, uid: string, resultat: Resultat): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/automatitzacio_log`, {
    method: 'POST',
    headers: { ...capceleresSupabase(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ uid, resultat }),
  });
  if (!res.ok && res.status !== 409) {
    const cos = await res.text().catch(() => '');
    console.warn(`⚠️  No s'ha pogut registrar el log de ${uid}: ${res.status} ${cos.slice(0, 200)}`);
  }
}

/** Puja l'original al bucket `factures` i retorna el camí desat. */
async function pujarAdjunt(env: Env, base64: string, nomFitxer: string): Promise<string> {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(nomFitxer)}`, {
    method: 'POST',
    headers: {
      ...capceleresSupabase(env),
      'Content-Type': mimeDe(nomFitxer),
      'x-upsert': 'true',
    },
    body: base64ABytes(base64),
  });

  await assegurarOk(res, `No s'ha pogut pujar ${nomFitxer} al bucket`);
  return nomFitxer;
}

/** Insereix la despesa a la safata de revisió. */
async function inserirPendent(
  env: Env,
  extraccio: Extraccio,
  meta: { adjuntPath: string | null; remitent: string; assumpte: string; uidCorreu: string },
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/gastos_pendents`, {
    method: 'POST',
    headers: { ...capceleresSupabase(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ ...extraccio, ...meta }),
  });

  // 409 = `uidCorreu` duplicat: aquest adjunt ja era a la safata.
  if (res.status === 409) {
    console.log(`   ↻ ${meta.uidCorreu} ja era a la safata, s'omet.`);
    return;
  }
  await assegurarOk(res, 'No s\'ha pogut inserir a gastos_pendents');
}

// ---- Cicle ------------------------------------------------------------

async function processarMissatge(env: Env, token: string, messageId: string): Promise<void> {
  const msg = await gmailGet<GmailMessage>(
    token,
    `${GMAIL_API}/messages/${messageId}?format=full`,
    `No s'ha pogut llegir el missatge ${messageId}`,
  );

  const headers = msg.payload?.headers;
  const assumpte = capcalera(headers, 'Subject');
  const remitent = capcalera(headers, 'From');

  const adjunts: Adjunt[] = [];
  trobarAdjunts(msg.payload, adjunts);

  if (adjunts.length === 0) {
    console.log(`   ⏭️  "${assumpte}" sense adjunts vàlids.`);
    await registrarLog(env, messageId, 'sense_adjunt');
    await marcarLlegit(token, messageId);
    return;
  }

  for (const adjunt of adjunts) {
    const uid = `${messageId}_${adjunt.filename}`;

    // Idempotència: abans de gastar cap crida a OpenAI.
    if (await jaProcessat(env, uid)) {
      console.log(`   ↻ ${uid} ja processat en un cicle anterior.`);
      continue;
    }

    try {
      const base64 = await baixarAdjunt(token, messageId, adjunt);
      const extraccio = await extreureDades(env, base64, adjunt.filename);
      const adjuntPath = await pujarAdjunt(env, base64, uid);

      await inserirPendent(env, extraccio, { adjuntPath, remitent, assumpte, uidCorreu: uid });
      await registrarLog(env, uid, 'ok');

      console.log(`   ✓ ${adjunt.filename} → safata (${extraccio.proveidor ?? 'desconegut'}, ${extraccio.import ?? '?'} €)`);
    } catch (err) {
      console.error(`   ✗ Error amb ${adjunt.filename}:`, err instanceof Error ? err.message : err);
      await registrarLog(env, uid, 'error');
    }
  }

  await marcarLlegit(token, messageId);
}

/** Un cicle complet: llegeix fins a `MAX_MISSATGES` correus no llegits amb adjunts. */
export async function processarCicle(env: Env): Promise<void> {
  const token = await obtenirAccessToken(env);

  const url = `${GMAIL_API}/messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=${MAX_MISSATGES}`;
  const llista = await gmailGet<{ messages?: { id?: string }[] }>(
    token,
    url,
    'No s\'ha pogut llistar els missatges',
  );

  const missatges = llista.messages ?? [];
  console.log(`📬 Cicle Gmail: ${missatges.length} missatge(s) a revisar.`);

  for (const m of missatges) {
    if (!m.id) continue;
    try {
      await processarMissatge(env, token, m.id);
    } catch (err) {
      console.error(`✗ Error processant el missatge ${m.id}:`, err instanceof Error ? err.message : err);
      await registrarLog(env, m.id, 'error');
    }
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processarCicle(env));
  },
} satisfies ExportedHandler<Env>;

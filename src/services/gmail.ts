import { google, type gmail_v1 } from 'googleapis';
import 'dotenv/config';
import { supabase } from '../db/supabase.js';
import { desarFitxer } from '../db/storage.js';
import { getOpenAI } from './extractor.js';
import { ingestarFactura } from './ingest.js';
import type { ResultatEmail, ResultatSync } from '../types.js';

// ============================================================
//  Gmail · lectura de correu + adjunts → canonada d'ingesta
//  Query: has:attachment (pdf|jpg|png) is:unread · màx. 10/cicle
//  Pre-filtre amb GPT-4o-mini abans de baixar cap adjunt (estalvi de tokens).
//  Idempotència via taula `emails_processats` (gmailId) a Supabase.
// ============================================================

const MAX_EMAILS_PER_CICLE = 10;

const GMAIL_QUERY =
  'has:attachment (filename:pdf OR filename:jpg OR filename:png) is:unread';

const EXTENSIONS_VALIDES = /\.(pdf|jpe?g|png)$/i;

// ---- Client Gmail (lazy singleton) ------------------------------------

let _gmail: gmail_v1.Gmail | null = null;

function getGmail(): gmail_v1.Gmail {
  if (_gmail) return _gmail;

  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error('Falten credencials de Gmail al .env (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN).');
  }

  const oauth2 = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

  _gmail = google.gmail({ version: 'v1', auth: oauth2 });
  return _gmail;
}

// ---- Idempotència + registre (taula `emails_processats` a Supabase) ----

/** Cert si aquest missatge ja es va tractar en un cicle anterior. */
async function jaProcessat(gmailId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('emails_processats')
    .select('id')
    .eq('gmailId', gmailId)
    .maybeSingle();

  if (error) throw new Error(`Supabase (emails_processats): ${error.message}`);
  return data !== null;
}

/**
 * Deixa constància del missatge. `ignoreDuplicates` fa d'`INSERT OR IGNORE`:
 * si dos cicles se solapen, el segon no peta per la restricció única de `gmailId`.
 */
async function registrarEmail(
  gmailId: string,
  resultat: ResultatEmail,
  subject: string | null,
  fromAddress: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('emails_processats')
    .upsert({ gmailId, resultat, subject, fromAddress }, {
      onConflict: 'gmailId',
      ignoreDuplicates: true,
    });

  if (error) console.warn(`⚠️  No s'ha pogut registrar l'email ${gmailId}:`, error.message);
}

// ---- Utilitats sobre el payload MIME ----------------------------------

interface Adjunt {
  filename: string;
  attachmentId: string;
}

/** Recorre recursivament les parts del missatge cercant adjunts vàlids. */
function trobarAdjunts(part: gmail_v1.Schema$MessagePart | undefined, out: Adjunt[]): void {
  if (!part) return;
  const filename = part.filename ?? '';
  const attachmentId = part.body?.attachmentId ?? '';
  if (filename && attachmentId && EXTENSIONS_VALIDES.test(filename)) {
    out.push({ filename, attachmentId });
  }
  for (const sub of part.parts ?? []) trobarAdjunts(sub, out);
}

/** Extreu el cos de text pla del missatge (recursivament). */
function extreureBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const text = extreureBodyText(part);
    if (text) return text;
  }
  return '';
}

/** Valor d'una capçalera del missatge (case-insensitive). */
function capcalera(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, nom: string): string {
  const h = (headers ?? []).find((x) => (x.name ?? '').toLowerCase() === nom.toLowerCase());
  return h?.value ?? '';
}

// ---- Pre-filtre financer (crida barata a GPT-4o-mini) -----------------

async function esDocumentFinancer(subject: string, body: string): Promise<boolean> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini', // model barat, no cal gpt-4o per a això
    max_tokens: 10,
    messages: [
      {
        role: 'user',
        content: `Ets un assistent de comptabilitat. Analitza aquest correu i respon ÚNICAMENT amb "SI" o "NO".

La pregunta és: Aquest correu conté o adjunta una factura, albarà, tiquet o qualsevol document financer d'un proveïdor?

Subject: ${subject}
Body: ${body.slice(0, 500)}

Respon SI si és probable que tingui un document financer (factura, albarà, tiquet, nota de crèdit, extracte...).
Respon NO si és un newsletter, notificació, confirmació de comanda sense document, correu de màrqueting, etc.`,
      },
    ],
  });
  const resp = response.choices[0]?.message?.content?.trim().toUpperCase() ?? 'NO';
  return resp.startsWith('SI');
}

// ---- Descàrrega d'adjunts ---------------------------------------------

/** Descarrega un adjunt al bucket `factures` (via storage.ts) i retorna el seu camí. */
async function baixarAdjunt(
  gmail: gmail_v1.Gmail,
  messageId: string,
  adjunt: Adjunt,
): Promise<string> {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: adjunt.attachmentId,
  });
  const data = res.data.data;
  if (!data) throw new Error(`Adjunt sense dades: ${adjunt.filename}`);

  const buffer = Buffer.from(data, 'base64url');
  return desarFitxer(buffer, `${messageId}_${adjunt.filename}`);
}

// ---- Processament d'un email ------------------------------------------

interface ResultatEmailInfo {
  resultat: ResultatEmail;
  subject: string;
  fromAddress: string;
}

async function processarEmail(gmail: gmail_v1.Gmail, messageId: string): Promise<ResultatEmailInfo> {
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });

  const headers = msg.data.payload?.headers;
  const subject = capcalera(headers, 'Subject');
  const fromAddress = capcalera(headers, 'From');

  // 1) Pre-filtre: abans de baixar res, preguntem a GPT-4o-mini si val la pena.
  const body = extreureBodyText(msg.data.payload);
  const esFinancer = await esDocumentFinancer(subject, body);
  if (!esFinancer) {
    console.log(`   ⏭️  Descartat pel pre-filtre (no financer): "${subject}"`);
    return { resultat: 'sense_adjunt', subject, fromAddress };
  }

  // 2) Adjunts vàlids.
  const adjunts: Adjunt[] = [];
  trobarAdjunts(msg.data.payload, adjunts);
  if (adjunts.length === 0) return { resultat: 'sense_adjunt', subject, fromAddress };

  // 3) Processa cada adjunt.
  let hiHaError = false;
  for (const adjunt of adjunts) {
    try {
      const rutaLocal = await baixarAdjunt(gmail, messageId, adjunt);
      // El remitent i l'assumpte viatgen fins a `gastos_pendents`: a la safata
      // de revisió són l'únic context per decidir si la despesa és bona.
      const r = await ingestarFactura(rutaLocal, 'email', {
        remitent: fromAddress,
        assumpte: subject,
        uidCorreu: `${messageId}_${adjunt.filename}`,
      });
      console.log(
        r.duplicat
          ? `   ↻ ${adjunt.filename} ja era a la safata (pendent #${r.pendentId}), s'omet.`
          : `   ✓ ${adjunt.filename} → pendent #${r.pendentId} (${r.proveidorNom ?? 'desconegut'}, IA ${Math.round(r.confian_ia * 100)}%)`,
      );
    } catch (err) {
      hiHaError = true;
      console.error(`   ✗ Error processant l'adjunt ${adjunt.filename}:`, err);
    }
  }

  return { resultat: hiHaError ? 'error' : 'ok', subject, fromAddress };
}

/** Marca el missatge com a llegit (treu l'etiqueta UNREAD). */
async function marcarLlegit(gmail: gmail_v1.Gmail, messageId: string): Promise<void> {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  } catch (err) {
    console.warn(`⚠️  No s'ha pogut marcar com a llegit el missatge ${messageId}:`, err);
  }
}

// ---- Cicle de polling -------------------------------------------------

/**
 * Executa un cicle de sincronització: llegeix fins a 10 emails no llegits amb
 * adjunts, pre-filtra amb GPT-4o-mini, processa els que porten documents,
 * els registra a `emails_processats` i els marca com a llegits.
 */
export async function processarCicleGmail(): Promise<ResultatSync> {
  const gmail = getGmail();

  const llista = await gmail.users.messages.list({
    userId: 'me',
    q: GMAIL_QUERY,
    maxResults: MAX_EMAILS_PER_CICLE,
  });

  const missatges = llista.data.messages ?? [];
  let processats = 0;
  let errors = 0;

  for (const m of missatges) {
    if (!m.id) continue;
    if (await jaProcessat(m.id)) continue; // ja tractat en un cicle anterior

    try {
      const { resultat, subject, fromAddress } = await processarEmail(gmail, m.id);
      await registrarEmail(m.id, resultat, subject, fromAddress);
      await marcarLlegit(gmail, m.id);
      if (resultat === 'error') errors += 1;
      else processats += 1;
    } catch (err) {
      console.error(`✗ Error processant l'email ${m.id}:`, err);
      await registrarEmail(m.id, 'error', null, null);
      errors += 1;
    }
  }

  console.log(`📬 Cicle Gmail: ${processats} processats, ${errors} amb error (de ${missatges.length} llegits).`);
  return { processats, errors };
}

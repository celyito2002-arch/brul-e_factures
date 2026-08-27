import OpenAI, { toFile } from 'openai';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import 'dotenv/config';
import {
  extraccioSchema,
  LLINDAR_REVISIO_MANUAL,
  LLINDAR_SEGONA_PASSADA,
  type Extraccio,
  type EstatFactura,
} from '../types.js';

// ============================================================
//  Extractor GPT-4o · document → JSON estructurat
//  Estratègia: PDF → OpenAI Files API (type:'file'); JPG/PNG → image_url
//  base64. Sense pdf2pic / GraphicsMagick. Validació Zod · doble passada
//  · revisió manual automàtica.
// ============================================================

const MODEL = 'gpt-4o';

// Client OpenAI lazy: no es crea (ni valida la clau) fins la primera crida,
// perquè la resta de l'app pugui arrencar sense OPENAI_API_KEY.
let _openai: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY al .env per a l\'extracció amb GPT-4o.');
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/** Prompt principal (en anglès, com exigeix l'especificació). */
const PROMPT_PRINCIPAL = `You are an expert accountant assistant for a bakery in Andorra. Extract invoice data from this document.

Return ONLY valid JSON with this exact structure:
{
  "tipus": "factura" | "albara" | "tiquet" | "desconegut",
  "numero": string | null,
  "proveidorNom": string | null,
  "proveidorNif": string | null,
  "dataDocument": "YYYY-MM-DD" | null,
  "dataVenciment": "YYYY-MM-DD" | null,
  "baseImposable": number | null,
  "iva": number | null,
  "total": number | null,
  "concepte": string | null,
  "confian_ia": number
}

Rules:
- "albara" = delivery note (albarán), NOT an invoice
- "tiquet" = till receipt / cash register ticket
- Dates MUST be in YYYY-MM-DD format
- If a field is unclear or missing, return null (never guess)
- confian_ia: 0.0 to 1.0 — your confidence in this extraction
- For Andorran documents: IGI = IVA, standard rate 4.5%`;

/** Prompt alternatiu (segona passada) — reformulat per capturar casos difícils. */
const PROMPT_ALTERNATIU = `Act as a meticulous bookkeeping OCR system for a bakery based in Andorra. Read every visible field of this document carefully before answering. If the document spans several pages, combine the information.

Respond with a SINGLE JSON object, nothing else:
{
  "tipus": "factura" | "albara" | "tiquet" | "desconegut",
  "numero": string | null,
  "proveidorNom": string | null,
  "proveidorNif": string | null,
  "dataDocument": "YYYY-MM-DD" | null,
  "dataVenciment": "YYYY-MM-DD" | null,
  "baseImposable": number | null,
  "iva": number | null,
  "total": number | null,
  "concepte": string | null,
  "confian_ia": number
}

Important:
- Distinguish an invoice ("factura") from a delivery note ("albara") and a cash receipt ("tiquet").
- Normalise ALL dates to YYYY-MM-DD. Convert any other format you find.
- Numbers must use a dot as decimal separator and no thousands separator.
- In Andorra the tax is IGI (treat it as "iva"), general rate 4.5%.
- Never invent data: unclear or absent fields must be null.
- confian_ia (0.0–1.0) must reflect how sure you are of the whole extraction.`;

interface ResultatPassada {
  extraccio: Extraccio;
  rawJson: string;
}

export interface ResultatExtraccio {
  extraccio: Extraccio;
  /** `revisio_manual` si la confiança és massa baixa, si no `pendent`. */
  estatSuggerit: EstatFactura;
  /** JSON cru de l'extracció escollida (per a `rawExtractJson`, auditoria). */
  rawJson: string;
}

const MIME_PER_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

interface DocumentPreparat {
  /** Parts de contingut (imatge o fitxer) a adjuntar al missatge. */
  parts: OpenAI.Chat.Completions.ChatCompletionContentPart[];
  /** ID del fitxer pujat a l'OpenAI Files API (només per a PDF), per netejar-lo després. */
  fileId?: string;
}

/**
 * Prepara el document per a GPT-4o:
 * - PDF → puja a l'OpenAI Files API (`purpose: 'user_data'`) i el referencia com a `type: 'file'`.
 * - JPG/PNG/WebP → base64 `image_url`.
 */
async function preparaDocument(fitxerPath: string): Promise<DocumentPreparat> {
  const ext = extname(fitxerPath).toLowerCase();

  if (ext === '.pdf') {
    const buffer = await readFile(fitxerPath);
    const pujat = await getOpenAI().files.create({
      file: await toFile(buffer, basename(fitxerPath), { type: 'application/pdf' }),
      purpose: 'user_data',
    });
    return {
      parts: [{ type: 'file', file: { file_id: pujat.id } }],
      fileId: pujat.id,
    };
  }

  const mime = MIME_PER_EXT[ext];
  if (!mime) {
    throw new Error(`Format de fitxer no suportat per a l'extracció: ${ext}`);
  }
  const buffer = await readFile(fitxerPath);
  const url = `data:${mime};base64,${buffer.toString('base64')}`;
  return {
    parts: [{ type: 'image_url', image_url: { url, detail: 'high' } }],
  };
}

/** Una crida a GPT-4o amb el prompt indicat i el document, validada amb Zod. */
async function extreurePassada(
  prompt: string,
  docParts: OpenAI.Chat.Completions.ChatCompletionContentPart[],
): Promise<ResultatPassada> {
  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: 'text', text: prompt },
    ...docParts,
  ];

  const resposta = await getOpenAI().chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content }],
  });

  const rawJson = resposta.choices[0]?.message?.content?.trim() ?? '';
  if (!rawJson) throw new Error('GPT-4o ha retornat una resposta buida.');

  const parsed = extraccioSchema.parse(JSON.parse(rawJson));
  return { extraccio: parsed, rawJson };
}

/**
 * Extreu les dades d'un document (PDF/JPG/PNG) amb GPT-4o.
 *
 * 1. Prepara el document (PDF → Files API; imatge → base64).
 * 2. Primera passada amb el prompt principal.
 * 3. Si `confian_ia < 0.75` → segona passada amb prompt alternatiu; es queda
 *    amb el resultat de major `confian_ia`.
 * 4. Si el millor `confian_ia < 0.60` → estat suggerit `revisio_manual`.
 */
export async function extreureFactura(fitxerPath: string): Promise<ResultatExtraccio> {
  const { parts, fileId } = await preparaDocument(fitxerPath);

  try {
    let millor = await extreurePassada(PROMPT_PRINCIPAL, parts);

    if (millor.extraccio.confian_ia < LLINDAR_SEGONA_PASSADA) {
      try {
        const segona = await extreurePassada(PROMPT_ALTERNATIU, parts);
        if (segona.extraccio.confian_ia > millor.extraccio.confian_ia) {
          millor = segona;
        }
      } catch (err) {
        // Si la segona passada falla, conservem la primera i seguim.
        console.warn('⚠️  Segona passada d\'extracció fallida, es manté la primera:', err);
      }
    }

    const estatSuggerit: EstatFactura =
      millor.extraccio.confian_ia < LLINDAR_REVISIO_MANUAL ? 'revisio_manual' : 'pendent';

    return { extraccio: millor.extraccio, estatSuggerit, rawJson: millor.rawJson };
  } finally {
    // Neteja best-effort del fitxer pujat (evita acumular fitxers a OpenAI).
    if (fileId) {
      try {
        await getOpenAI().files.del(fileId);
      } catch (err) {
        console.warn('⚠️  No s\'ha pogut esborrar el fitxer temporal d\'OpenAI:', err);
      }
    }
  }
}

import { z } from 'zod';

// ============================================================
//  Brulée — Gestió de Factures · tipus compartits
// ============================================================

// ---- Enums / unions ---------------------------------------------------

export const TIPUS_FACTURA = ['factura', 'albara', 'tiquet', 'desconegut'] as const;
export type TipusFactura = (typeof TIPUS_FACTURA)[number];

export const ESTAT_FACTURA = ['pendent', 'pagada', 'vencuda', 'revisio_manual'] as const;
export type EstatFactura = (typeof ESTAT_FACTURA)[number];

export const ESTAT_EMESA = ['pendent', 'pagada', 'cancel_lada'] as const;
export type EstatEmesa = (typeof ESTAT_EMESA)[number];

export const FONT_ENTRADA = ['email', 'foto', 'manual'] as const;
export type FontEntrada = (typeof FONT_ENTRADA)[number];

export const RESULTAT_EMAIL = ['ok', 'error', 'sense_adjunt'] as const;
export type ResultatEmail = (typeof RESULTAT_EMAIL)[number];

// ---- Llindars de confiança de l'extracció IA --------------------------

/** Per sota d'aquest llindar → segona passada amb prompt alternatiu. */
export const LLINDAR_SEGONA_PASSADA = 0.75;
/** Per sota d'aquest llindar → estat `revisio_manual` automàtic. */
export const LLINDAR_REVISIO_MANUAL = 0.6;

// ---- Fila de la taula `factures` (rebudes) ----------------------------

export interface Factura {
  id: number;
  tipus: TipusFactura;
  numero: string | null;
  proveidorNom: string | null;
  proveidorNif: string | null;
  dataDocument: string | null;
  dataVenciment: string | null;
  baseImposable: number | null;
  iva: number | null;
  total: number | null;
  moneda: string;
  concepte: string | null;
  estat: EstatFactura;
  fontEntrada: FontEntrada | null;
  fitxerLocal: string | null;
  driveId: string | null;
  drivePath: string | null;
  confian_ia: number | null;
  rawExtractJson: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Camps necessaris per inserir una factura rebuda (la resta té defaults a la BD). */
export type NovaFactura = Omit<Factura, 'id' | 'createdAt' | 'updatedAt'>;

// ---- Fila de la taula `factures_emeses` -------------------------------

export interface FacturaEmesa {
  id: number;
  numero: string;
  clientNom: string | null;
  clientNif: string | null;
  dataDocument: string | null;
  dataVenciment: string | null;
  baseImposable: number | null;
  iva: number | null;
  total: number | null;
  concepte: string | null;
  estat: EstatEmesa;
  driveId: string | null;
  createdAt: string;
}

export type NovaFacturaEmesa = Omit<FacturaEmesa, 'id' | 'createdAt'>;

// ---- Fila de la taula `emails_processats` -----------------------------

export interface EmailProcessat {
  id: number;
  gmailId: string;
  processedAt: string;
  resultat: ResultatEmail;
  subject: string | null;
  fromAddress: string | null;
}

// ---- Fila de la taula `gastos_pendents` (Supabase · safata de revisió) ----

/**
 * Despesa detectada per la IA que encara NO és una factura: viu a Supabase
 * fins que algú la confirma (→ `factures` a SQLite) o la descarta.
 * `uidCorreu` és únic i garanteix la idempotència de la ingesta.
 */
export interface GastPendent {
  id: number;
  proveidor: string | null;
  nrt: string | null;
  concepte: string | null;
  import: number | null;
  data: string | null;
  categoria: string | null;
  baseImposable: number | null;
  quotaIgi: number | null;
  adjuntPath: string | null;
  remitent: string | null;
  assumpte: string | null;
  uidCorreu: string | null;
  createdAt: string;
}

/** Camps que escrivim en inserir a `gastos_pendents` (la resta té defaults). */
export type NouGastPendent = Omit<GastPendent, 'id' | 'createdAt'>;

// ============================================================
//  Extracció GPT-4o Vision · schema Zod
// ============================================================

/**
 * Estructura EXACTA que ha de retornar GPT-4o (veure prompt a l'extractor).
 * Els camps poden ser null quan el document no és clar; `confian_ia` sempre present.
 */
export const extraccioSchema = z.object({
  tipus: z.enum(TIPUS_FACTURA),
  numero: z.string().nullable(),
  proveidorNom: z.string().nullable(),
  proveidorNif: z.string().nullable(),
  dataDocument: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ha de ser YYYY-MM-DD')
    .nullable(),
  dataVenciment: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ha de ser YYYY-MM-DD')
    .nullable(),
  baseImposable: z.number().nullable(),
  iva: z.number().nullable(),
  total: z.number().nullable(),
  concepte: z.string().nullable(),
  confian_ia: z.number().min(0).max(1),
});

/** Resultat validat de l'extracció IA. */
export type Extraccio = z.infer<typeof extraccioSchema>;

// ============================================================
//  API · tipus de resposta
// ============================================================

export interface Paginacio<T> {
  dades: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface FiltresFactures {
  estat?: EstatFactura;
  tipus?: TipusFactura;
  mes?: string; // 'YYYY-MM'
  proveidorNom?: string;
  page?: number;
  limit?: number;
}

export interface StatsResum {
  totalPendent: number;
  vencen7dies: number;
  facturesMes: number;
  pagadaMes: number;
}

export interface StatsMensual {
  mes: string; // 'YYYY-MM'
  rebudes: number;
  emeses: number;
}

export interface StatsProveidor {
  nom: string;
  total: number;
  percentatge: number;
}

export interface ResultatSync {
  processats: number;
  errors: number;
}

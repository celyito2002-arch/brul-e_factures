-- ============================================================
--  Brulée — Gestió de Factures · esquema SQLite
--  SQLite és la font de veritat. Drive és còpia per a la gestoria.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---- Factures rebudes (proveïdors) ------------------------------------
CREATE TABLE IF NOT EXISTS factures (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tipus            TEXT NOT NULL CHECK(tipus IN ('factura','albara','tiquet','desconegut')),
  numero           TEXT,
  proveidorNom     TEXT,
  proveidorNif     TEXT,
  dataDocument     TEXT,
  dataVenciment    TEXT,
  baseImposable    REAL,
  iva              REAL,
  total            REAL,
  moneda           TEXT DEFAULT 'EUR',
  concepte         TEXT,
  estat            TEXT DEFAULT 'pendent'
                   CHECK(estat IN ('pendent','pagada','vencuda','revisio_manual')),
  fontEntrada      TEXT CHECK(fontEntrada IN ('email','foto','manual')),
  fitxerLocal      TEXT,
  driveId          TEXT,
  drivePath        TEXT,
  confian_ia       REAL,
  rawExtractJson   TEXT,
  createdAt        TEXT DEFAULT (datetime('now')),
  updatedAt        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_factures_estat        ON factures(estat);
CREATE INDEX IF NOT EXISTS idx_factures_tipus        ON factures(tipus);
CREATE INDEX IF NOT EXISTS idx_factures_proveidor    ON factures(proveidorNom);
CREATE INDEX IF NOT EXISTS idx_factures_dataDocument ON factures(dataDocument);

-- ---- Factures emeses (clients) ----------------------------------------
CREATE TABLE IF NOT EXISTS factures_emeses (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  numero           TEXT UNIQUE NOT NULL,
  clientNom        TEXT,
  clientNif        TEXT,
  dataDocument     TEXT,
  dataVenciment    TEXT,
  baseImposable    REAL,
  iva              REAL,
  total            REAL,
  concepte         TEXT,
  estat            TEXT DEFAULT 'pendent' CHECK(estat IN ('pendent','pagada','cancel_lada')),
  driveId          TEXT,
  createdAt        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emeses_estat        ON factures_emeses(estat);
CREATE INDEX IF NOT EXISTS idx_emeses_dataDocument ON factures_emeses(dataDocument);

-- ---- Registre d'emails processats (idempotència del polling) -----------
CREATE TABLE IF NOT EXISTS emails_processats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gmailId     TEXT UNIQUE NOT NULL,
  processedAt TEXT DEFAULT (datetime('now')),
  resultat    TEXT CHECK(resultat IN ('ok','error','sense_adjunt')),
  subject     TEXT,
  fromAddress TEXT
);

-- ---- Manté updatedAt al dia a `factures` ------------------------------
CREATE TRIGGER IF NOT EXISTS trg_factures_updatedAt
AFTER UPDATE ON factures
FOR EACH ROW
BEGIN
  UPDATE factures SET updatedAt = datetime('now') WHERE id = OLD.id;
END;

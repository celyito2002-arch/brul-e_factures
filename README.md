# 🥐 Brulée — Gestió de Factures

Aplicació **local** de gestió de factures per a la panaderia artesana **Brulée** (Andorra).
Llegeix el correu de Gmail, extreu les dades de les factures amb **GPT-4o Vision** i ho guarda
tot a una base de dades **SQLite local**, que és la font de veritat. Els fitxers originals es
desen a `uploads/` (veure [Roadmap](#-roadmap) per a la migració a Supabase Storage).

> Propietari: Mario Trepos · Gestoria: mca.comptabilitat@gmail.com

---

## ✨ Funcionalitats

- 📥 **Polling de Gmail** cada 15 min: llegeix correus no llegits amb adjunts (PDF/JPG/PNG).
- 🔎 **Pre-filtre financer** amb `gpt-4o-mini`: descarta correus no rellevants abans de baixar cap adjunt (estalvi de tokens).
- 🧠 **Extracció amb IA** (GPT-4o Vision) amb doble passada i revisió manual automàtica si la confiança és baixa.
- 🗂️ **Dashboard** (tema fosc Brulée 2.0) amb KPIs, gràfic mensual, top proveïdors i taula filtrable.
- 📄 Pàgines dedicades de **factures rebudes** i **factures emeses** (amb creació manual d'emeses).
- 📎 **Importació manual** de PDF/JPG des de la interfície.

---

## 🧱 Stack tècnic

| Àrea | Tecnologia |
|------|------------|
| Runtime | Node.js 20+ · TypeScript (`tsx` dev, `tsc` prod) |
| API | Express.js |
| Base de dades | SQLite local (`better-sqlite3`) |
| Extracció IA | OpenAI **GPT-4o Vision** |
| Email | Gmail API (OAuth 2.0) + `node-cron` |
| Emmagatzematge fitxers | Local `uploads/` (abstracció a `src/db/storage.ts`) |
| Frontend | HTML + CSS + JS vanilla (sense frameworks) |

---

## ✅ Requisits previs

1. **Node.js 20 o superior** (provat també amb Node 24).
2. Credencials OAuth de **Gmail** i una **clau d'OpenAI**.

> Els PDF s'envien directament a GPT-4o via l'**OpenAI Files API** — ja **no** cal
> GraphicsMagick ni Ghostscript.

---

## 🚀 Instal·lació

```bash
# 1) Instal·la dependències
npm install

# 2) Configura l'entorn
cp .env.example .env      # (Windows: copy .env.example .env)
#   → omple les claus dins de .env

# 3) Crea les taules de la base de dades
npm run setup

# 4) Arrenca en mode desenvolupament
npm run dev
```

Obre **http://localhost:3000**.

---

## 🔧 Scripts

| Script | Descripció |
|--------|------------|
| `npm run dev` | Servidor amb recàrrega automàtica (`tsx watch`, port 3000) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm run start` | Executa la versió compilada (`node dist/server.js`) |
| `npm run setup` | Crea les taules SQLite (idempotent) |
| `npm run sync` | Executa **un** cicle de sincronització de Gmail i surt |

> **Nota sobre `npm run build`:** `tsc` no copia els `.sql`. Abans de `npm start`, copia
> l'esquema: `cp src/db/schema.sql dist/db/schema.sql` (el codi també cau cap a `src/db/schema.sql` si no el troba).

---

## 🔑 Variables d'entorn (`.env`)

```
OPENAI_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_USER=svillarealb@gmail.com
PORT=3000
DB_PATH=./brulee.sqlite
```

> Si falten les credencials de Gmail, el servidor arrenca igualment i el **scheduler es desactiva**
> (podràs fer servir el dashboard, la importació manual i l'API). Si falta `OPENAI_API_KEY`,
> tot funciona excepte l'extracció, que fallarà amb un missatge clar quan s'intenti.

---

## 🌐 API REST

### Factures rebudes
| Mètode | Ruta | Descripció |
|--------|------|------------|
| `GET` | `/api/factures` | Llista paginada · filtres: `estat`, `tipus`, `mes` (`YYYY-MM`), `proveidorNom`, `page`, `limit` |
| `GET` | `/api/factures/:id` | Detall (inclou `rawExtractJson`) |
| `GET` | `/api/factures/:id/pdf` | Descarrega el fitxer original (404 si no en té) |
| `PATCH` | `/api/factures/:id/estat` | `{ "estat": "pagada" \| "pendent" \| "vencuda" \| "revisio_manual" }` |
| `POST` | `/api/factures/import` | Importació manual (multipart, camp `file`) |

### Factures emeses
| Mètode | Ruta | Descripció |
|--------|------|------------|
| `GET` | `/api/factures-emeses` | Llista paginada · filtres: `estat`, `mes`, `clientNom`, `page`, `limit` |
| `POST` | `/api/factures-emeses` | Creació manual (`numero` obligatori i únic) |
| `PATCH` | `/api/factures-emeses/:id/estat` | `{ "estat": "pendent" \| "pagada" \| "cancel_lada" }` |

### Estadístiques i sincronització
| Mètode | Ruta | Descripció |
|--------|------|------------|
| `GET` | `/api/stats/resum` | `{ totalPendent, vencen7dies, facturesMes, pagadaMes }` |
| `GET` | `/api/stats/mensual` | Sèrie de 12 mesos de l'any actual (`rebudes` vs `emeses`) |
| `GET` | `/api/stats/proveidors` | Top 5 proveïdors per import |
| `POST` | `/api/sync/gmail` | Trigger manual · `{ processats, errors }` |

---

## 📁 Estructura del projecte

```
src/
├── server.ts            # Express: static + routers + scheduler
├── db/                  # schema.sql · db.ts (connexió) · setup.ts · storage.ts
├── services/
│   ├── extractor.ts     # GPT-4o Vision → JSON (doble passada + Zod)
│   ├── gmail.ts         # Lectura de correu + pre-filtre + adjunts
│   ├── ingest.ts        # Canonada: extreu → SQLite
│   ├── scheduler.ts     # node-cron (*/15) + mode --once
│   └── drive.ts         # ⚠️ obsolet — es migrarà a Supabase Storage (veure Roadmap)
├── routes/              # factures · emeses · stats · sync
└── types.ts             # Tipus + schema Zod de l'extracció
public/
├── index.html           # Dashboard (disseny importat Brulée 2.0)
├── rebudes.html         # Factures rebudes
├── emeses.html          # Factures emeses
└── common.js            # Utilitats compartides del frontend
```

---

## 🗄️ Emmagatzematge de fitxers

Els fitxers originals (PDF/JPG/PNG) es desen localment a **`uploads/`**. La ruta local queda a
`factures.fitxerLocal` i es pot descarregar via `GET /api/factures/:id/pdf`.

L'accés al disc està abstret a **`src/db/storage.ts`** (`desarFitxer` / `llegirFitxer`), de
manera que la migració a **Supabase Storage** només tocarà aquest fitxer (veure [Roadmap](#-roadmap)).
Les columnes `driveId` / `drivePath` de la taula `factures` queden reservades per a aquesta migració.

---

## 🧠 Comportament de l'extractor

1. PDF → puja a l'**OpenAI Files API** (`purpose: 'user_data'`) i s'adjunta com a `type: 'file'`; JPG/PNG → `image_url` base64 (`detail: "high"`). El fitxer temporal d'OpenAI s'esborra en acabar.
2. Crida a GPT-4o amb `response_format: json_object`, validada amb **Zod**.
3. Si `confian_ia < 0.75` → segona passada amb prompt alternatiu; es queda amb la de més confiança.
4. Si `confian_ia < 0.60` → estat **`revisio_manual`** automàtic.

---

## 📌 Context de negoci

- Andorra: **IGI = IVA**, tipus general **4,5 %**.
- La gestoria consultarà les factures via l'app (accés compartit previst amb la migració a Supabase — veure Roadmap).
- Proveïdors habituals: Alzina, Andbus, Enclar Carburants, Leroy, Dropand, CELU (llum).
- Un correu pot portar diversos adjunts (es processen tots). Màxim **10 correus per cicle**.

---

## 🚀 Roadmap

L'objectiu és passar d'una app **100% local** a un desplegament **al núvol** mantenint la
mateixa lògica de negoci. La migració es fa per capes, sense reescriure el domini:

### Fase 1 — Supabase (base de dades + emmagatzematge)
- **Postgres** en lloc de SQLite: migrar l'esquema (`factures`, `factures_emeses`, `emails_processats`).
  SQLite ja és la font de veritat, així que el model de dades no canvia; només el driver.
- **Supabase Storage** (bucket `factures`) en lloc de `uploads/`: només cal reescriure
  `src/db/storage.ts` (`desarFitxer` puja al bucket i retorna una URL; `llegirFitxer` la descarrega).
  Les columnes **`driveId` / `drivePath`** —avui `null`— passaran a guardar la referència de l'objecte.
- **Auth de Supabase** per donar accés de només-lectura a la **gestoria** (substitueix l'antic accés a Drive).

### Fase 2 — Vercel (desplegament)
- Servir el frontend estàtic (`public/`) i l'API des de **Vercel**.
- Moure el **polling de Gmail** (avui `node-cron`) a un **Vercel Cron Job** que cridi
  `POST /api/sync/gmail`, ja que les funcions serverless no mantenen processos llargs.
- Variables d'entorn gestionades a Vercel; secrets fora del repositori.

> Google Drive **queda descartat**. El fitxer `src/services/drive.ts` es conserva marcat com a
> obsolet (`// TODO: migrar a Supabase Storage`) fins que la Fase 1 estigui completa.

---

## ⚠️ Notes

- **SQLite és la font de veritat**; els fitxers originals viuen a `uploads/` (futur: Supabase Storage).
- El projecte és a **OneDrive**: si veus errors `EPERM` amb `node_modules`, pausa la
  sincronització d'OneDrive o mou el projecte fora d'aquesta carpeta.
- No committegis mai el `.env` (ja és al `.gitignore`).

# Brulée — Gestió de Factures

Aplicació local de gestió de factures per a la panaderia artesana **Brulée** (Andorra).
Propietari: Mario Trepos. Gestoria: mca.comptabilitat@gmail.com

---

## Stack tècnic

- **Runtime:** Node.js 20+ amb TypeScript (`tsx` en dev, `tsc` en prod)
- **API:** Express.js
- **Base de dades:** SQLite local via `better-sqlite3`
- **Extracció IA:** OpenAI GPT-4o Vision — NO usar Claude API
- **Email:** Gmail API (OAuth 2.0) — polling cada 15 min amb `node-cron`
- **Emmagatzematge fitxers:** local `uploads/` (abstracció a `src/db/storage.ts`; futur: Supabase Storage)
- **Frontend:** HTML + CSS + JS vanilla (sense frameworks)

## Regles absolutes

1. **Tot el text de la UI en català** — botons, etiquetes, missatges d'error, tooltips, tot.
2. **Extracció sempre via GPT-4o** — els PDF s'envien directament amb l'OpenAI Files API (`type: 'file'`); les imatges (JPG/PNG) com a `image_url`. No convertir PDF a imatge ni extreure text raw.
3. **Mai sobreescriure un fitxer d'emmagatzematge** — sempre crear-ne un de nou si hi ha conflicte de nom.
4. **Confiança IA < 0.60 → estat `revisio_manual` automàtic**, mai guardar com a `pendent`.
5. **Mai commitejar el `.env`** — existeix `.env.example` amb totes les claus buides.
6. **SQLite és la font de veritat** — els fitxers originals es desen a `uploads/` (còpia local; futur: Supabase Storage).

## Estructura de carpetes

```
brulee-factures/
├── src/
│   ├── server.ts
│   ├── db/
│   │   ├── schema.sql
│   │   ├── db.ts
│   │   ├── setup.ts
│   │   └── storage.ts     # Abstracció d'emmagatzematge (local; futur: Supabase)
│   ├── services/
│   │   ├── gmail.ts       # Lectura correu + pre-filtre financer + adjunts
│   │   ├── extractor.ts   # GPT-4o Vision → JSON estructurat
│   │   ├── ingest.ts      # Canonada: extreu → SQLite
│   │   ├── scheduler.ts   # node-cron polling
│   │   └── drive.ts       # ⚠️ obsolet — es migrarà a Supabase Storage (veure Roadmap)
│   ├── routes/
│   │   ├── factures.ts
│   │   ├── emeses.ts
│   │   ├── stats.ts
│   │   └── sync.ts
│   └── types.ts
├── public/
│   ├── index.html         # Dashboard principal
│   ├── rebudes.html       # Factures rebudes
│   ├── emeses.html        # Factures emeses
│   └── common.js          # Utilitats compartides del frontend
├── uploads/               # Fitxers originals (PDF/JPG/PNG) — gitignore
├── .env
├── .env.example
├── brulee.sqlite
└── package.json
```

## Scripts disponibles

```bash
npm run dev      # tsx watch src/server.ts (port 3000)
npm run build    # tsc
npm run start    # node dist/server.js
npm run setup    # Crea les taules SQLite
npm run sync     # Executa un cicle de Gmail manualment (--once)
```

## Emmagatzematge de fitxers

Els fitxers originals es desen localment a `uploads/`. La ruta queda a `factures.fitxerLocal`
i es descarreguen via `GET /api/factures/:id/pdf`. L'accés al disc està abstret a
`src/db/storage.ts` (`desarFitxer` / `llegirFitxer`) perquè la migració a **Supabase Storage**
només toqui aquest fitxer (veure Roadmap). Mai sobreescriure: crear un fitxer nou si hi ha conflicte.

## Variables d'entorn requerides (`.env`)

```
OPENAI_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_USER=bruleepaneriaartesana@gmail.com
PORT=3000
DB_PATH=./brulee.sqlite
```

## Esquema de la base de dades (resum)

Taula principal: `factures`
- `tipus`: `'factura' | 'albara' | 'tiquet' | 'desconegut'`
- `estat`: `'pendent' | 'pagada' | 'vencuda' | 'revisio_manual'`
- `fontEntrada`: `'email' | 'foto' | 'manual'`
- `confian_ia`: REAL 0.0–1.0 (confiança de GPT-4o)
- `fitxerLocal`: ruta del fitxer original a `uploads/`
- `driveId` + `drivePath`: **reservats** per a la referència a Supabase Storage (avui `null`)
- `rawExtractJson`: JSON cru retornat per GPT-4o (per auditoria)

## Disseny visual (frontend)

> **Font de veritat:** el disseny importat `Facturas Dashboard.dc.html` (Brulée 2.0, tema fosc).
> Aquests tokens en són l'extracció directa. El disseny mana sempre — no substituir per cap
> paleta provisional. Reproduït a `public/index.html`.

Paleta Brulée (tema fosc):
```css
--surface-page:   #080808;  /* negre fons */
--surface-nav:    #0a0a0a;  /* sidebar */
--surface-card:   #0f0f0f;  /* cards / panells */
--surface-input:  #0b0b0b;  /* inputs / selects */
--accent:         #F5B800;  /* or Brulée */
--accent-hover:   #ffc93f;
--ink-primary:    #F2F0E9;  /* crema (text principal) */
--ink-secondary:  #B9B4A6;
--ink-muted:      #8A867D;
--ink-faint:      #5d5a52;
--border:         rgba(242,240,233,.09);
/* Estats */
--state-paid:     #9DBF8E;  /* pagada (verd) */
--state-pending:  #F5B800;  /* pendent (or) */
--state-overdue:  #D97B66;  /* vençuda (vermell) */
--state-review:   #7FA8C9;  /* revisió manual (blau) */
```

Tipografia (Google Fonts):
- Títols / KPIs / botons: `'Barlow Condensed', sans-serif` (uppercase, letter-spacing ample)
- Cos / taules / inputs: `'Archivo', sans-serif`
- Logo: `'Rubik Spray Paint', cursive`

Seguir la skill `frontend-design` per a totes les decisions de UI, però sense desviar-se
dels tokens i components del disseny importat.

## API endpoints

```
GET   /api/factures              # llista paginada — params: estat, tipus, mes, proveidorNom
GET   /api/factures/:id          # detall
GET   /api/factures/:id/pdf      # descàrrega del fitxer original
PATCH /api/factures/:id/estat    # { estat }
POST  /api/factures/import       # puja manual PDF/JPG (multipart)
GET   /api/factures-emeses       # llista emeses — params: estat, mes, clientNom
POST  /api/factures-emeses       # crea factura emesa (numero únic)
PATCH /api/factures-emeses/:id/estat  # { estat }
GET   /api/stats/resum           # totals del mes, pendents, vencen en 7 dies
GET   /api/stats/mensual         # dades gràfic per mes (any actual)
GET   /api/stats/proveidors      # top proveïdors per import
POST  /api/sync/gmail            # trigger manual sincronització Gmail
```

## Pre-filtre de correu (Gmail)

Abans de baixar cap adjunt, `esDocumentFinancer(subject, body)` fa una crida barata a
`gpt-4o-mini` (`max_tokens: 10`) per decidir si el correu conté un document financer. Si diu
que no → es registra com a `sense_adjunt` i no es baixa res (estalvi de tokens de GPT-4o Vision).

## Comportament de l'extractor GPT-4o

1. Si PDF → pujar a l'OpenAI Files API (`purpose: 'user_data'`) i adjuntar-lo com a `type: 'file'`; si imatge → `image_url` base64 (`detail: "high"`)
2. Enviar el document a GPT-4o (el fitxer temporal d'OpenAI s'esborra en acabar)
3. Exigir `response_format: { type: "json_object" }` i validar amb Zod
4. Si `confian_ia < 0.75` → fer una segona crida amb prompt diferent i agafar el resultat amb `confian_ia` més alt
5. Si `confian_ia < 0.60` → establir estat `revisio_manual`

## Context de negoci

- Andorra: IGI = IVA, tipus general 4.5%
- La gestoria consultarà les factures via l'app (accés compartit previst amb Supabase — veure Roadmap)
- Proveïdors habituals: Alzina, Andbus, Enclar Carburants, Leroy, Dropand, Llum (CELU)
- Formats que arriben: PDF (email), JPG (foto paper), tiquet de caixa
- Un email pot tenir múltiples adjunts (processa'ls tots)
- Màxim 10 emails per cicle de polling per no saturar l'API d'OpenAI

## Roadmap (migració futura)

> Google Drive **queda descartat**. `src/services/drive.ts` es conserva marcat com a obsolet
> (`// TODO: migrar a Supabase Storage`) fins completar la Fase 1.

### Fase 1 — Supabase (dades + emmagatzematge)
- **Postgres** en lloc de SQLite (mateix esquema; SQLite ja és la font de veritat, així que el
  model no canvia, només el driver).
- **Supabase Storage** (bucket `factures`) en lloc de `uploads/`: només cal reescriure
  `src/db/storage.ts`. Les columnes `driveId` / `drivePath` passaran a guardar la referència de l'objecte.
- **Auth de Supabase** per donar accés de només-lectura a la gestoria.

### Fase 2 — Vercel (desplegament)
- Frontend estàtic (`public/`) + API a **Vercel**.
- El polling de Gmail (`node-cron`) passa a un **Vercel Cron Job** que crida `POST /api/sync/gmail`
  (les funcions serverless no mantenen processos llargs).
- Secrets gestionats a Vercel, fora del repositori.

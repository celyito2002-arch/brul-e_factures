# Brulée — Gestió de Factures

Aplicació local de gestió de factures per a la panaderia artesana **Brulée** (Andorra).
Propietari: Mario Trepos. Gestoria: mca.comptabilitat@gmail.com

---

## Stack tècnic

- **Runtime:** Node.js 20+ amb TypeScript (`tsx` en dev, `tsc` en prod)
- **API:** Express.js
- **Base de dades:** Postgres a **Supabase** (client `@supabase/supabase-js`, service_role)
- **Extracció IA:** OpenAI GPT-4o Vision — NO usar Claude API
- **Email:** Gmail API (OAuth 2.0) — polling cada 15 min amb `node-cron` en local; a Vercel, Cron Job → `POST /api/sync/gmail`
- **Emmagatzematge fitxers:** **Supabase Storage**, bucket `factures` (abstracció a `src/db/storage.ts`)
- **Frontend:** HTML + CSS + JS vanilla (sense frameworks)

## Regles absolutes

1. **Tot el text de la UI en català** — botons, etiquetes, missatges d'error, tooltips, tot.
2. **Extracció sempre via GPT-4o** — els PDF s'envien directament amb l'OpenAI Files API (`type: 'file'`); les imatges (JPG/PNG) com a `image_url`. No convertir PDF a imatge ni extreure text raw.
3. **Mai sobreescriure un fitxer d'emmagatzematge** — sempre crear-ne un de nou si hi ha conflicte de nom.
4. **Confiança IA < 0.60 → estat `revisio_manual` automàtic**, mai guardar com a `pendent`.
5. **Mai commitejar el `.env`** — existeix `.env.example` amb totes les claus buides.
6. **Supabase és la font de veritat** — dades a Postgres, originals al bucket `factures`. L'app no guarda res al disc: a Vercel el filesystem és efímer.
7. **La service_role key mai surt del servidor** — no s'exposa a `public/` ni al frontend.

## Estructura de carpetes

```
brulee-factures/
├── src/
│   ├── server.ts
│   ├── db/
│   │   ├── supabase.ts    # Client únic (Postgres + Storage)
│   │   └── storage.ts     # Bucket `factures` (desar/llegir/esborrar)
│   ├── services/
│   │   ├── gmail.ts       # Lectura correu + pre-filtre financer + adjunts
│   │   ├── extractor.ts   # GPT-4o Vision → JSON estructurat
│   │   ├── ingest.ts      # Canonada: extreu → `gastos_pendents` (safata)
│   │   ├── scheduler.ts   # node-cron polling
│   │   └── drive.ts       # ⚠️ obsolet — només hi queden MESOS_CA / getTrimestre
│   ├── routes/
│   │   ├── factures.ts    # + safata /api/pendents
│   │   ├── emeses.ts
│   │   ├── stats.ts
│   │   └── sync.ts
│   └── types.ts
├── public/
│   ├── index.html         # Dashboard principal
│   ├── revisio.html       # Safata de revisió (gastos_pendents)
│   ├── rebudes.html       # Factures rebudes
│   ├── emeses.html        # Factures emeses
│   └── common.js          # Utilitats compartides del frontend
├── .env
├── .env.example
├── vercel.json
└── package.json
```

## Scripts disponibles

```bash
npm run dev      # tsx watch src/server.ts (port 3000)
npm run build    # tsc
npm run start    # node dist/server.js
npm run sync     # Executa un cicle de Gmail manualment (--once)
```

## Emmagatzematge de fitxers

Els originals es pugen al bucket **`factures`** de Supabase Storage (privat). El camí dins
del bucket queda a `factures.fitxerLocal` — el nom de la columna es conserva per històric,
però ja no és una ruta de disc. Es descarreguen via `GET /api/factures/:id/pdf`, que baixa
l'objecte i el reenvia. Tot l'accés passa per `src/db/storage.ts`
(`desarFitxer` / `llegirFitxer` / `esborrarFitxer`).

Els noms són únics per construcció (`{gmailId}_{adjunt}` per a Gmail, `manual_{timestamp}.ext`
per a la importació manual), així que l'`upsert` mai pot trepitjar el document d'un altre
proveïdor.

## Variables d'entorn requerides (`.env`)

```
OPENAI_API_KEY=
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_USER=bruleepaneriaartesana@gmail.com
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000
```

## Esquema de la base de dades (resum)

Taules a Postgres: `factures`, `factures_emeses`, `gastos_pendents` (safata de revisió)
i `emails_processats`. **RLS activat i sense polítiques**: només la service_role hi arriba.
Per donar accés de només-lectura a la gestoria caldrà afegir polítiques.

Taula principal: `factures`
- `tipus`: `'factura' | 'albara' | 'tiquet' | 'desconegut'`
- `estat`: `'pendent' | 'pagada' | 'vencuda' | 'revisio_manual'`
- `fontEntrada`: `'email' | 'foto' | 'manual'`
- `confian_ia`: REAL 0.0–1.0 (confiança de GPT-4o)
- `fitxerLocal`: camí de l'original dins del bucket `factures`
- `driveId` + `drivePath`: obsolets, sempre `null` (l'original es localitza amb `fitxerLocal`)
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
GET   /api/pendents              # safata de revisió (gastos_pendents)
POST  /api/pendents/:id/confirmar # → crea la factura a `factures` i buida la safata
DELETE /api/pendents/:id         # descarta la despesa pendent
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
- La gestoria consultarà les factures via l'app (caldran polítiques RLS — veure Estat de la migració)
- Proveïdors habituals: Alzina, Andbus, Enclar Carburants, Leroy, Dropand, Llum (CELU)
- Formats que arriben: PDF (email), JPG (foto paper), tiquet de caixa
- Un email pot tenir múltiples adjunts (processa'ls tots)
- Màxim 10 emails per cicle de polling per no saturar l'API d'OpenAI

## Estat de la migració

### Fase 1 — Supabase ✅ feta
- Postgres substitueix SQLite (`better-sqlite3` eliminat; sense `db.ts` ni `schema.sql`).
- Supabase Storage (bucket `factures`) substitueix `uploads/`.
- Pendent: **polítiques RLS** per a l'accés de només-lectura de la gestoria.

### Fase 2 — Vercel ✅ preparada
- `vercel.json` amb `@vercel/node` i `includeFiles: public/**`.
- `src/server.ts` exporta l'app per defecte i només fa `listen()` fora de Vercel.
- Pendent: **Vercel Cron Job** que cridi la sincronització de Gmail (avui `POST /api/sync/gmail`;
  els crons de Vercel fan GET, caldrà una ruta GET equivalent o un `?token=`).
- Secrets a configurar a Vercel: les mateixes variables del `.env`.

> `src/services/drive.ts` es conserva només perquè hi viuen `MESOS_CA` i `getTrimestre`;
> la part de Google Drive està descartada i no es crida des d'enlloc.

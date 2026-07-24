# OFAC SDN Screening API

A tiny, fast HTTP API that answers one question:

> _"Is this name on the U.S. Treasury's sanctions list, and how confident are you?"_

Send a name, get back a ranked list of matches from the [OFAC Specially Designated Nationals (SDN) list](https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists) — plus optional parallel watchlists (Cuban PCC directory, ANPP deputies, FHRC Represores Cubanos, and any list you add) — with a 0–100 confidence score. Built for the kind of compliance checks fintech, crypto, and remittance products do thousands of times a day — but light enough to run on a single serverless function.

```bash
$ curl 'https://your-deployment.vercel.app/api?name=putin&minScore=85'
```

```json
{
  "query": "putin",
  "total": 3,
  "results": [
    { "score": 100, "matchedName": { "full": "PUTIN, Vladimir Vladimirovich" }, "entity": { "type": "Individual", "programs": ["RUSSIA-EO14024"] } },
    { "score":  88, "matchedName": { "full": "PUTINA, Maria" } },
    { "score":  86, "matchedName": { "full": "PUTINA, Yekaterina" } }
  ],
  "tookMs": 4
}
```

---

## Why this exists

OFAC publishes the SDN list as a [~100 MB XML file](https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ENHANCED.XML) with ~19 000 entities and ~50 000 aliases (transliterations, A.K.A., F.K.A., name variants in non-Latin scripts, etc.). Doing a real-time fuzzy match against that — handling typos, word order, missing middle names, Spanish-vs-English spellings, Cyrillic transliterations — is non-trivial.

Most teams reach for an enterprise compliance vendor and pay per-call. This repo is the inverse: a self-hosted, single-file dataset, zero database, that turns the problem into a ~150-line search routine running entirely in memory on a serverless function.

## What you get

- **Sub-10 ms warm response** on a single function instance
- **Fuzzy scoring tuned for names**: Jaro-Winkler + token-set ratio, so `"Maria del Carmen Lopez"` matches `"LOPEZ, Maria Carmen"` at 100
- **Diacritic & case-insensitive**: `José` → `jose`, `AL-QA'IDA` → `al qaida`
- **All OFAC programs** — Russia/Ukraine, Iran, Cuba, DPRK, SDGT, CAATSA, narcotics, etc. — surfaced in the response
- **No database**: dataset lives as a single JSON file in Cloudflare R2 (or any object store)
- **No egress costs**: Cloudflare R2 has zero egress fees
- **Easy to update**: re-run one script when OFAC updates the list

## How it works

```
                  ┌─────────────────────────────────────────────┐
                  │  Cold-start (once per warm Fluid instance)  │
                  │                                             │
   OFAC XML ──┐   │   ┌─────────────────┐    ┌──────────────┐   │
   (~100 MB)  │   │   │ ofac-entities   │───▶│ trigram      │   │
              │   │   │ .json (~8 MB)   │    │ inverted     │   │
   import ────┴──▶│   │ in Cloudflare R2│    │ index in RAM │   │
   script        │   └─────────────────┘    └──────┬───────┘   │
                  │                                  │           │
                  └──────────────────────────────────┼───────────┘
                                                     │
       GET /api?name=putin ──▶ extract trigrams ──▶ top 400 candidates
                                                     │
                                                     ▼
                          Jaro-Winkler + token-set scoring (per candidate)
                                                     │
                                                     ▼
                                  best score per entity → ranked JSON
```

### The two-stage trick

A naive search would run a fuzzy scorer against all 40 000 names per request — workable, but wasteful. Instead:

1. **Candidate retrieval (microseconds)**: split the query into 3-char windows ("trigrams") and use an inverted index to find the ~400 names that share the most trigrams. This eliminates 99% of the dataset cheaply.
2. **Full scoring (milliseconds)**: run `max(Jaro-Winkler, token-set ratio)` only on the candidates, collapse to the best score per entity, return the top N.

The trigram trick is the same idea Postgres' `pg_trgm` extension uses — except here it's ~40 lines of plain JavaScript and lives in the function's memory.

### Why these scoring algorithms?

- **Jaro-Winkler** is the AML industry's default for name matching: it weighs shared prefixes heavily (people get their first letters right even when they typo the rest) and handles transpositions naturally — useful when OFAC has `Khaled` and someone searches `Khalid`.
- **Token-set ratio** (the [rapidfuzz](https://github.com/rapidfuzz/RapidFuzz) recipe) ignores word order and extra tokens. So `"Maria del Carmen Lopez Hernandez"` and `"LOPEZ, Maria Carmen"` still match at 100, even though one has 5 tokens and the other 3.

Taking the **max** of the two means a hit on either dimension is enough — biased toward false positives over false negatives, which is what you want for compliance screening (a missed sanction is much worse than a manual review).

## API reference

### `GET /api`

| Param      | Type   | Default | Range  | Description                              |
| ---------- | ------ | ------- | ------ | ---------------------------------------- |
| `name`     | string | —       | —      | Name to screen. Required unless `address` is given. |
| `address`  | string | —       | —      | Digital currency address to screen (exact, case-insensitive). Takes precedence over `name`. |
| `limit`    | int    | 10      | 1–50   | Max ranked matches to return (`name` search only). |
| `minScore` | int    | 70      | 0–100  | Drop matches below this score (`name` search only). |
| `lists`    | string | all     | —      | Comma-separated list ids to search (e.g. `lists=ofac` or `lists=pcc,anpp`). Default searches every loaded list. Unknown ids → `400`. |

#### Response shape

```jsonc
{
  "query": "vladimir putin",
  "normalizedQuery": "vladimir putin",
  "total": 1,
  "results": [
    {
      "score": 100,
      "matchedName": {
        "full": "PUTIN, Vladimir Vladimirovich",
        "first": "Vladimir",
        "last": "PUTIN",
        "isPrimary": true,
        "aliasType": null,
        "script": "Latin"
      },
      "entity": {
        "id": "21340",
        "identityId": "12824",
        "type": "Individual",
        "programs": ["RUSSIA-EO14024"],
        "sanctionsTypes": ["Block"],
        "names": [ /* every alias OFAC has on file */ ]
      }
    }
  ],
  "meta": {
    "datasetGeneratedAt": "2026-05-21T10:32:11.000Z",
    "entitiesIndexed": 17920,
    "namesIndexed": 41892
  },
  "tookMs": 4
}
```

#### Wallet screening

The SDN list flags ~960 digital currency addresses (BTC, ETH, TRX, USDT, XMR, …) as "Digital Currency Address" features. Screen one with:

```bash
$ curl 'https://your-deployment.vercel.app/api?address=0x098B716B8Aaf21512996dC57EB0615e2383E2f96'
```

Address matches are exact (case-insensitive) — no fuzzy stage. Each result carries `matchedAddress` and `currency` instead of `matchedName`, always with `score: 100`.

#### Errors

| Status | Meaning                                          |
| ------ | ------------------------------------------------ |
| `400`  | Missing `name`/`address` param, or unknown id in `lists`. |
| `500`  | `LISTS_MANIFEST_URL`/`OFAC_INDEX_URL` not configured or R2 unreachable. |

## Multiple lists

The engine is list-agnostic: OFAC is just one list among N. Every list is a JSON file in R2 with the same `{ entities: [...] }` shape, enumerated by a `manifest.json`:

```jsonc
{
  "version": 1,
  "lists": [
    { "id": "ofac", "label": "OFAC SDN",                    "key": "ofac-entities.json" },
    { "id": "pcc",  "label": "PCC — Directorio de personas", "key": "lists/pcc.json" },
    { "id": "anpp", "label": "ANPP — Diputados",             "key": "lists/anpp.json" }
  ]
}
```

Set `LISTS_MANIFEST_URL` to the manifest's public URL and the runtime loads every list into one shared trigram index at cold-start, tagging each entity with its `list` id and `source`. (`key` resolves relative to the manifest URL, so everything lives in one public bucket. Without `LISTS_MANIFEST_URL`, the runtime falls back to `OFAC_INDEX_URL` and behaves exactly as the original OFAC-only API.)

### Bundled Cuban lists

Two scrapers ship in [`scripts/sources/`](scripts/sources):

- **`pcc`** — the [PCC people directory](https://www.pcc.cu/index.php/directorio-personas) (~100 senior party officials, with cargo and entity)
- **`anpp`** — the [ANPP deputies roster](https://www.parlamentocubano.gob.cu/diputados) (~470 deputies, with cargo and org memberships)
- **`fhrc`** — the [FHRC Represores Cubanos database](https://represorescubanosfhrc.com/represores) (~1,700 documented individuals, with institution; sourced from the site's public Supabase API since the frontend is a SPA)

```bash
npm run import:lists          # scrape → data/{pcc,anpp,fhrc}-entities.json
npm run import:lists:upload   # + push lists and manifest.json to R2
```

The [`cuba-import.yml`](.github/workflows/cuba-import.yml) workflow re-scrapes weekly (Mondays 06:00 UTC) using the same `R2_*` secrets as the OFAC import.

### Adding your own list

1. Drop a module in `scripts/sources/` exporting `{ id, label, source, fetchEntities }`, where `fetchEntities()` resolves to entities shaped like `{ id, source, type, programs, names: [{ full }] }` (extra fields pass through to API responses).
2. Register it in the `SOURCES` array of `scripts/import-lists.mjs`.
3. Run `npm run import:lists:upload` — the manifest is upserted automatically and the runtime picks the list up on next cold-start. No runtime code changes.

## Getting started

### 1. Generate the dataset

The repo does **not** ship OFAC data — that lives in R2.

```bash
# Downloads from OFAC if no local sdn_enhanced.xml exists.
npm run import

# Or point it at a specific file:
node scripts/import-ofac.mjs --xml=/path/to/sdn_enhanced.xml
```

Output: `data/ofac-entities.json` (~9 MB, ~19 000 entities).

### 2. Upload to Cloudflare R2

Create an R2 bucket with public access enabled (r2.dev domain or a custom domain).

```bash
cp .env.example .env
# Fill in R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
npm run import:upload
```

### 3. Configure & run

```bash
# In .env
OFAC_INDEX_URL=https://pub-<hash>.r2.dev/ofac-entities.json
```

```bash
npm install
npm run dev
curl 'http://localhost:3000/api?name=putin'
```

### Deploy

Drop-in on [Vercel](https://vercel.com) — set `OFAC_INDEX_URL` in the project's environment and you're live. Should run on any platform that supports Next.js 16 + Node 20+.

## Keeping the data fresh

OFAC updates the SDN list multiple times per week. To refresh manually:

```bash
npm run import:upload   # re-download, re-parse, re-upload to R2
```

This repo also ships a GitHub Actions workflow ([`.github/workflows/ofac-import.yml`](.github/workflows/ofac-import.yml)) that runs the import on weekdays at 23:00 UTC and pushes the result to R2 — set the `R2_*` repository secrets and it's fully automated. The API picks up the new index the next time a function instance cold-starts.

## Cost & performance

| Metric                | Value                                         |
| --------------------- | --------------------------------------------- |
| Dataset size          | ~9 MB JSON (down from ~100 MB XML)            |
| R2 storage cost       | <$0.001/month                                 |
| R2 egress cost        | $0 (Cloudflare has no egress fees)            |
| Function cold-start   | ~1–3 s (download + index build, paid once)    |
| Warm-request latency  | 2–10 ms                                       |
| Entities indexed      | ~19 000                                       |
| Names (incl. aliases) | ~50 000                                       |

## Design notes

### Why not Postgres / Neon / SQLite-FTS5?

I considered all three. For a fixed-size 18 k-entity dataset that fits comfortably in memory, the cold-start + in-memory approach beats them on simplicity and warm latency. There's no database to provision, no migrations, no connection pool, no separate index to rebuild. If the dataset ever grew to a consolidated EU + UN + UK + OFAC + SECO scope (~200 k entries), Postgres with GIN/`pg_trgm` would become the right call.

### Why Cloudflare R2?

Three reasons: **zero egress fees**, **S3-compatible API** (so the import script uses the standard AWS SDK), and **public bucket URLs out of the box** (no CDN to configure). Any S3-compatible store works — swap the endpoint in the import script.

### Why not just bundle the JSON?

Tempting — the JSON is ~8 MB and would fit in a serverless function bundle. But then the OFAC data is tied to deployments: every refresh requires a CI run. Keeping it in R2 means a single `npm run import:upload` updates every running instance on next cold-start.

## Limitations & honest caveats

- **Substring matches aren't free**: a query of `"khan"` will match dozens of entities containing that token. Filter with `minScore=85+` for stricter results, or post-process the response.
- **No phonetic matching**: Soundex/Metaphone aren't applied. For matches across radically different scripts (e.g. Cyrillic-only name vs. Latin query), you'll rely on OFAC's own transliterations being in the dataset (they usually are).
- **No address/DOB filtering**: this scores names only. Real compliance flows should layer additional checks (DOB, nationality, addresses) on the returned candidates.
- **Not a substitute for legal review**: hits are leads, not verdicts.

## Stack

- [Next.js 16](https://nextjs.org) (App Router, route handler only — no React in the runtime path)
- [Cloudflare R2](https://developers.cloudflare.com/r2/) for dataset storage
- [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) for the one-time XML → JSON conversion
- [`@aws-sdk/client-s3`](https://www.npmjs.com/package/@aws-sdk/client-s3) for R2 uploads (devDep — never bundled in the runtime)

## License

MIT — see [LICENSE](LICENSE).

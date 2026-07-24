# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Next.js 16 service that scores a name against the OFAC SDN list **plus parallel watchlists** (Cuban PCC directory, ANPP deputies — extensible) and returns ranked fuzzy matches. The source-of-truth datasets live in **Cloudflare R2** as pre-processed JSON files enumerated by a `manifest.json`; the runtime fetches them once at cold-start and serves searches from one shared in-memory trigram index, with each entity tagged by `list` id and `source`.

## Commands

- `npm run dev` — start the dev server on http://localhost:3000 (only route is `GET /api`)
- `npm run build` / `npm start` — production
- `npm run lint` — Next.js lint
- `npm run import` — parse `sdn_enhanced.xml` (or download from OFAC) → write `data/ofac-entities.json`
- `npm run import:upload` — same as `import`, then push the JSON to R2
- `npm run import:lists` — scrape the non-OFAC sources (`scripts/sources/*`) → write `data/<id>-entities.json`
- `npm run import:lists:upload` — same, then push lists + upserted `manifest.json` to R2

Common flags: `node scripts/import-ofac.mjs --xml=/path/to.xml`, `--url=https://...`, `--out=...`, `--upload`.

No test runner is configured.

## Required environment

- **Runtime** (`app/api/route.js`): `LISTS_MANIFEST_URL` — public R2 URL of `manifest.json` (multi-list mode; list `key`s resolve relative to it, so manifest + lists share one public bucket). Fallback: `OFAC_INDEX_URL` — public R2 URL of `ofac-entities.json`, OFAC-only. The route fails 500 with neither.
- **Import scripts** (`scripts/import-ofac.mjs`, `scripts/import-lists.mjs`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optionally `R2_KEY`. Only needed when `--upload` is passed.
- Optional: `OFAC_SDN_XML_URL` overrides the default OFAC enhanced-XML download URL.

See `.env.example`.

## Architecture

The hot path (`GET /api?name=...`):

1. `lib/ofac-data.js` — singleton loader. First call resolves the list set (manifest or `OFAC_INDEX_URL` fallback), fetches every list JSON in parallel, flattens entities into one array (tagging `entity.list` = list id and defaulting `entity.source`), and builds a trigram inverted index (trigram → `Uint32Array` of name indices; each `names[]` entry also carries its `list` id) plus `cryptoIndex` (lowercased digital-currency address → matches, exact lookup). Cached in module scope. Fluid Compute reuses instances across requests, so cold-start cost (~2–4 s) is paid once per warm instance.
2. `lib/search.js` — two-stage search. **Stage 1**: tally trigram overlap between the query and every indexed name, keep the top `candidatePool` (default 400) name indices. **Stage 2**: run the full scorer on each candidate; collapse to best score per *entity* (a single entity has many aliases). Return ranked top `limit`.
3. `lib/scoring.js` — `score(query, target)` returns 0–100, taking `max(jaroWinkler, tokenSetRatio)`. Normalization strips accents (NFD), lowercases, and collapses non-alphanumeric to spaces. Token-set ratio is rapidfuzz-style (intersection + diffs → three sorted strings → best Jaro-Winkler among them), which makes word order and extra middle names mostly free.

The cold-path:

- `scripts/import-lists.mjs` runs the scrapers in `scripts/sources/` (`pcc.mjs` — pcc.cu Drupal table, paginated `?page=N`; `anpp.mjs` — parlamentocubano.gob.cu, all deputies on one page). Each source exports `{ id, label, source, fetchEntities }` and returns entities in the same shape the runtime consumes (`type: 'Individual'`, `names: [{ full, isPrimary }]`, plus `role`/`org`/`organizations`/`url` extras that pass through to responses). With `--upload` it pushes `lists/<id>.json` to R2 and upserts `manifest.json` (seeding an `ofac` entry pointing at `R2_KEY`). It refuses to write a list that scraped 0 entities (site-redesign guard). Adding a list = new module in `scripts/sources/` + register in `SOURCES` — zero runtime changes. Shared helpers live in `scripts/lib/` (`scrape.mjs`, `r2.mjs`).
- `scripts/import-ofac.mjs` reads OFAC's enhanced XML (local file or download), normalizes each entity to `{ id, identityId, type, programs, sanctionsTypes, names[], cryptoAddresses[]? }` (`cryptoAddresses` — `{ currency, address }` from "Digital Currency Address - *" features — is only present when non-empty), writes `data/ofac-entities.json`, and optionally PUTs to R2 via `@aws-sdk/client-s3`. The SDK is a devDep — runtime never touches it.

## Data shape

XML quirks worth knowing:

- `entity.names.name` and `name.translations.translation` can each be a single object or an array depending on how many aliases the entity has. The import script normalizes via `toArray()`; preserve that pattern when extending it.
- `formattedFullName` is the canonical match target. Some entries only have `nameParts` (`type="Entity Name"` / `value=...`) — the script falls back to joining those.
- Entity types include `Individual`, `Entity`, `Vessel`, `Aircraft`. The index does not split by type; filter downstream if you need to.

## Search query semantics

- `name` or `address` (one required; `address` wins if both given), `limit` (1–50, default 10), `minScore` (0–100, default 70), `lists` (comma-separated list ids; default all loaded lists; unknown id → 400 via `UnknownListError`). List filtering happens during the trigram tally — before the `candidatePool` cut — so narrow-list queries aren't starved by other lists' names.
- `address` is an exact, case-insensitive lookup against `cryptoIndex` (`lib/search.js` `searchAddress`) — no fuzzy stage, results always `score: 100` with `matchedAddress`/`currency` instead of `matchedName`. `limit`/`minScore` don't apply.
- Very short queries (<3 normalized chars) bypass the trigram filter and linear-scan all names — slow but correct.
- The returned `score` is per-entity-best, so two entities with the same primary name don't both surface unless they have distinct best aliases.

## Editing notes

- Don't import anything from `lib/` into the import script (or vice versa) unless it's pure utility — the script uses Node's `fs`/`@aws-sdk`, which Next.js shouldn't bundle into the API route.
- If you change the JSON payload shape (`scripts/import-ofac.mjs` output), also update `lib/ofac-data.js` (`payload.entities` is the contract).
- `app/page.js` is a single-file client-component landing card with two live query testers (name + address inputs that fetch `/api` and render results; uses `/ofac-logo.png`, plain inline CSS, no Tailwind). `app/layout.js` exists only to satisfy App Router's root-layout requirement.
- `*.xml` / `*.XML` is `.gitignore`d (matches `sdn_enhanced.xml`, legacy `SDN.XML`); the canonical source is OFAC's URL or R2.

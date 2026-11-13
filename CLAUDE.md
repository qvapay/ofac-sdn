# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Next.js 16 service that scores a name (or a crypto wallet address) against the OFAC SDN list **plus parallel watchlists** (UN, EU, UK sanctions; Cuban PCC directory, ANPP deputies, FHRC repressors; community reports; optional OpenSanctions complement) and returns ranked fuzzy matches. The source-of-truth datasets live in **Cloudflare R2** as pre-processed JSON files enumerated by a `manifest.json`; the runtime fetches them once at cold-start and serves searches from one shared in-memory trigram index, with each entity tagged by `list` id and `source`.

Plain JavaScript throughout (no TypeScript). House style is tabs and no semicolons (`lib/scoring.js` is the lone 4-space holdout; match whichever file you are in). Production deploy is Vercel (Fluid Compute).

## Commands

- `npm run dev` — dev server on http://localhost:3000 (routes: `GET /api`, `POST /api/report`, pages `/` and `/report`)
- `npm run build` / `npm start` — production
- `npm run doctor` — runs `npx react-doctor@latest` (the only code-quality tool; there is **no ESLint config and no `lint` script**). After React changes run `npx react-doctor@latest --verbose --diff` and make sure the score didn't regress — CI (`react-doctor.yml`) blocks PRs on new `error`-level findings in changed files only ("ratchet": existing debt is tolerated, new debt is not). Verify any diagnostic against the real tool before "fixing" it; the rule set has false positives.
- `npm run import` — parse `sdn_enhanced.xml` (or download from OFAC) → write `data/ofac-entities.json`
- `npm run import:upload` — same as `import`, then push the JSON to R2
- `npm run import:lists [ids…]` — scrape the non-OFAC sources (`scripts/sources/*`) → write `data/<id>-entities.json`. With no ids it runs **every** registered source (including the ~64 MB OpenSanctions download). Pass ids to narrow: `node scripts/import-lists.mjs un eu uk`.
- `npm run import:lists:upload` — same, then push `lists/<id>.json` + upserted `manifest.json` to R2

Flags for `import-ofac.mjs`: `--xml=/path/to.xml`, `--url=https://...`, `--out=...`, `--upload`. The `npm run import*` scripts use `node --env-file-if-exists=.env`, so a local `.env` is picked up automatically (needs Node ≥ 22; CI uses Node 22).

`npm test` runs the `node:test` suite in `test/` (normalization, scoring and an end-to-end `searchName` against a tiny local dataset). Manual check: `curl 'http://localhost:3000/api?name=putin'` and `?address=0x098B716B8Aaf21512996dC57EB0615e2383E2f96` (Lazarus Group ETH wallet, should return `total: 1`).

`data/` and `*.xml` are gitignored — generated datasets never enter the repo; R2 is the source of truth.

## Required environment

- **Runtime** (`app/api/route.js`): `LISTS_MANIFEST_URL` — public R2 URL of `manifest.json` (multi-list mode; list `key`s resolve relative to it, so manifest + lists share one public bucket). Fallback: `OFAC_INDEX_URL` — public R2 URL of `ofac-entities.json`, OFAC-only. The route fails 500 with neither.
- **Import scripts** (`scripts/import-ofac.mjs`, `scripts/import-lists.mjs`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optionally `R2_KEY` (OFAC object key, default `ofac-entities.json`). Only needed when `--upload` is passed; `@aws-sdk/client-s3` is lazily imported so parse-only runs work without it.
- **Report intake** (`app/api/report/route.js`): `GITHUB_REPORT_TOKEN` — fine-grained PAT with Issues read/write; `GITHUB_REPORT_REPO` optional (default `qvapay/ofac-sdn`). Without the token, `POST /api/report` fails 500; everything else is unaffected. The `community` source reads issues with `GITHUB_TOKEN` (Actions) or `GITHUB_REPORT_TOKEN`, unauthenticated otherwise.
- **Optional download overrides**: `OFAC_SDN_XML_URL`, `UN_LIST_URL`, `EU_FSF_URL`, `UK_SANCTIONS_URL`, `OPENSANCTIONS_CSV_URL`; `FHRC_SUPABASE_URL` + `FHRC_SUPABASE_ANON_KEY` skip the FHRC bundle discovery.

See `.env.example`.

## Architecture

The hot path (`GET /api?name=...`):

1. `lib/ofac-data.js` — singleton loader (`getDataset()`, a module-scoped promise; a failed load resets it so the next request retries). First call resolves the list set (manifest or `OFAC_INDEX_URL` fallback), fetches every list JSON in parallel, flattens entities into one array (tagging `entity.list` = list id and defaulting `entity.source`), and builds a trigram inverted index (trigram → `Uint32Array` of name indices; each `names[]` entry also carries its `list` id) plus `cryptoIndex` (lowercased digital-currency address → matches, exact lookup). Fluid Compute reuses instances across requests, so cold-start cost (~2–4 s) is paid once per warm instance. **A warm instance never refetches** — see "Keeping data fresh" below.
2. `lib/search.js` — two-stage search. **Stage 1**: tally trigram overlap between the query and every indexed name, keep the top `candidatePool` (default 400) name indices. **Stage 2**: run the full scorer on each candidate; collapse to best score per *entity* (a single entity has many aliases). Return ranked top `limit`.
3. `lib/scoring.js` — `score(query, target)` returns 0–100, taking `max(jaroWinkler, tokenSetRatio)`. Normalization strips accents (NFD + `\p{M}`), lowercases, folds the Latin letters NFD leaves whole to the ASCII the lists use (`ł ø đ ð ħ ı` → `l o d d h i`, `ß æ œ` → `ss ae oe`; `LATIN_FOLDS`), and collapses everything but letters and digits **of any script** (`\p{L}\p{N}`) to spaces — an ASCII-only class would erase every Cyrillic/Arabic/Persian alias (~11% of SDN names) and turn a query in those scripts into a silent 0-match. Token-set ratio is rapidfuzz-style (intersection + diffs → three sorted strings → best Jaro-Winkler among them), which makes word order and extra middle names mostly free.

The route itself is `force-dynamic`, Node runtime, `maxDuration = 60` (to survive the first cold start).

### Data pipeline (cold path)

- `scripts/import-ofac.mjs` reads OFAC's enhanced XML (local file or download), normalizes each entity to `{ id, identityId, type, programs, sanctionsTypes, names[], cryptoAddresses[]? }` (`cryptoAddresses` — `{ currency, address }` from "Digital Currency Address - *" features — is only present when non-empty), writes `data/ofac-entities.json`, and optionally PUTs to R2.
- `scripts/import-lists.mjs` runs the scrapers registered in its `SOURCES` array. Each module in `scripts/sources/` exports `{ id, label, source, fetchEntities }` (optionally `allowEmpty = true`) and returns entities in the runtime shape (`type`, `names: [{ full, isPrimary }]`, plus `role`/`org`/`organizations`/`url`/`cryptoAddresses` extras that pass through to responses). With `--upload` it pushes `lists/<id>.json` to R2 and upserts `manifest.json` (seeding an `ofac` entry pointing at `R2_KEY`). Each source gets two attempts, and 0 entities counts as a failure (site-redesign guard) unless the source exports `allowEmpty`. **A failed source never blocks the others**: its previous list stays in R2, the rest are written and uploaded, the failures go to the log and the job summary, and the run exits 1 so the workflow shows red (the redeploy step still runs, `if: !cancelled()`). Adding a list = new module + register in `SOURCES` — zero runtime changes. Shared helpers: `scripts/lib/scrape.mjs` (`fetchHtml` with retries/timeout, `cleanText`, `slugify`), `scripts/lib/r2.mjs`.
- Sources, by kind:
  - HTML scrapers (cheerio): `pcc.mjs` (pcc.cu Drupal table, paginated `?page=N`), `anpp.mjs` (parlamentocubano.gob.cu, all deputies on one page).
  - `fhrc.mjs` — represorescubanosfhrc.com is a SPA; the module extracts the Supabase URL + anon key from the deployed JS bundle at run time and pages the public REST table. The site has been unreachable since early Nov 2026 (TLS errors, 404 on `/represores`) while the table kept serving, so when the live bundle can't be read it takes the newest archived bundle from the Wayback Machine (CDX query, `id_` raw bytes, gunzipped if needed).
  - Official XML (fast-xml-parser): `un.mjs`, `eu.mjs` (public-token URL), `uk.mjs` — the FCDO **UK Sanctions List** XML (~22 MB; the OFSI Consolidated List closed on 28 Jan 2026 and its blob answers 409, issue #10). Designations sharing an `OFSIGroupID` merge into one entity with id `uk-<OFSIGroupID>` (same ids as the old OFSI rows); non-Latin names become aliases, and birth dates (`dd/mm/yyyy` with `dd`/`mm` for unknown parts), places of birth, nationalities, genders and address countries are kept in the OFAC identifier shape. Parser `parseUkSanctionsXml` is pure and tested (`test/uk-sanctions.test.mjs`).
  - `opensanctions.mjs` — consolidated `targets.simple.csv` (~64 MB). Keeps only rows whose `dataset` labels include **none** of the directly-imported lists (OFAC SDN, UN, EU FSF, UK FCDO) and throws if a covered label matches 0 rows (i.e. OpenSanctions renamed it). Nets ~44k extra entities. License is CC-BY-NC — keep a visible "Data: OpenSanctions" attribution in the UI if this list is served (it is not in the footer yet).
  - `community.mjs` — not a scraper: pages GitHub issues `labels=reporte-comunidad,aprobado&state=all`, parses the ```json block, emits `id: community-<issue#>` entities with `url` → the issue as audit trail. Exports `allowEmpty` (zero approved reports is legitimate).

### Community reports pipeline

`/report` page → `POST /api/report` validates (honeypot field `website`, per-instance in-memory rate limit of 3/hour/IP, name ≥ 3 chars, ≥ 1 `http` evidence URL, wallets `^[a-zA-Z0-9]{20,100}$`) and opens a public GitHub issue with labels `reporte-comunidad` + `pendiente`, a `<!-- ofac-sdn:community-report -->` marker and a ```json block (`schema: 1`). `@` is neutralized in the body so submissions can't ping GitHub users. **Moderation = swap `pendiente` for `aprobado` on the issue**; `community-import.yml` then rebuilds the list. UI text is Spanish.

### Keeping data fresh (GitHub Actions)

Warm Fluid instances cache the dataset in memory forever, so every import workflow ends by POSTing `VERCEL_DEPLOY_HOOK_URL` to recycle instances. All use the same `R2_*` repository secrets.

| Workflow | Schedule | Runs |
| --- | --- | --- |
| `ofac-import.yml` | weekdays 23:00 UTC | `import-ofac.mjs --upload` |
| `sanctions-import.yml` | daily 05:30 UTC | `import-lists.mjs un eu uk --upload` |
| `cuba-import.yml` | Mondays 06:00 UTC | `import-lists.mjs --upload` — **all** sources, so anything registered in `SOURCES` (currently including `opensanctions`) ships weekly |
| `community-import.yml` | on issue labeled/unlabeled/edited/closed/reopened/deleted with `reporte-comunidad` | `import-lists.mjs community --upload` |
| `keepalive.yml` | 1st of the month 04:17 UTC | re-enables the three scheduled imports and itself through the API |

GitHub disables scheduled workflows in a public repo after 60 days without activity. That happened to the three imports in Nov 2026: OFAC stopped on 7 Nov and nobody noticed, because a disabled workflow does not fail. `keepalive.yml` re-enables them monthly.

Registering a source in `SOURCES` therefore means it goes live on the next Monday run; to hold a source back, keep it out of `SOURCES` or make the weekly workflow pass explicit ids.

## Data shape

XML quirks worth knowing:

- `entity.names.name` and `name.translations.translation` can each be a single object or an array depending on how many aliases the entity has. The import script normalizes via `toArray()`; preserve that pattern when extending it (the UN/EU sources use the same helper).
- `formattedFullName` is the canonical match target. Some entries only have `nameParts` (`type="Entity Name"` / `value=...`) — the script falls back to joining those.
- Entity types include `Individual`, `Entity`, `Vessel`, `Aircraft`. The index does not split by type; filter downstream if you need to.

## Search query semantics

- `name` or `address` (one required; `address` wins if both given), `limit` (1–50, default 10), `minScore` (0–100, default 70), `lists` (comma-separated list ids, case-insensitive; default all loaded lists; unknown id → 400 via `UnknownListError`). List filtering happens during the trigram tally — before the `candidatePool` cut — so narrow-list queries aren't starved by other lists' names.
- `address` is an exact, case-insensitive lookup against `cryptoIndex` (`searchAddress`) — no fuzzy stage, results always `score: 100` with `matchedAddress`/`currency` instead of `matchedName`. `limit`/`minScore` don't apply.
- Very short queries (<3 normalized chars) bypass the trigram filter and linear-scan all names. Longer queries with zero trigram hits return empty without scanning.
- The returned `score` is per-entity-best, so two entities with the same primary name don't both surface unless they have distinct best aliases.
- Response `meta` carries `lists` (id, label, `entitiesCount`, `generatedAt` per loaded list) and `listsSearched`; the UI reads these.

## Editing notes

- Don't import anything from `lib/` into the import scripts (or vice versa) unless it's pure utility — the scripts use Node's `fs`/`@aws-sdk`/`cheerio`/`fast-xml-parser`, which Next.js shouldn't bundle into the API route. All of those are devDependencies; the runtime has only `next`/`react`.
- If you change the JSON payload shape (`scripts/import-ofac.mjs` or a source's output), also update `lib/ofac-data.js` (`payload.entities` is the contract; `payload.generatedAt` is surfaced in `meta`).
- `app/page.js` is a single-file client-component landing card with two live query testers (name + address inputs that fetch `/api` and render results; plain inline CSS, no Tailwind; reads `version` from `package.json`). `app/report/page.js` is the community report form (same visual style, Spanish UI, posts to `/api/report`). `app/layout.js` exists only to satisfy App Router's root-layout requirement. Branding: QvaPay logo in header/favicon; the OFAC seal appears only in the footer as data-source attribution.
- `PLAN.md` (Spanish) is the integration plan for consuming this API from QvaPay and Trondealer (wallet screening before outbound transfers, fail-closed policy, test addresses). `data/trondealer-ofac-blacklist.sql` referenced there is a generated artifact, not tracked.
- The `@/*` path alias in `jsconfig.json` exists but the code uses relative imports.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

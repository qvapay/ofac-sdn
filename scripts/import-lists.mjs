#!/usr/bin/env node
// Scrapes the non-OFAC screening lists (scripts/sources/*) into the same JSON
// shape the runtime consumes, and optionally uploads them to R2 along with a
// manifest.json that enumerates every available list.
//
// Usage:
//   node scripts/import-lists.mjs                 # scrape all sources → data/<id>-entities.json
//   node scripts/import-lists.mjs pcc             # scrape only the pcc source
//   node scripts/import-lists.mjs --upload        # also push lists + manifest to R2
//
// Adding a new list = drop a module in scripts/sources/ exporting
// { id, label, source, fetchEntities } and register it in SOURCES below.
//
// Env vars for upload: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET (and R2_KEY if the OFAC JSON lives under a non-default key).

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pcc from './sources/pcc.mjs'
import * as anpp from './sources/anpp.mjs'
import * as fhrc from './sources/fhrc.mjs'
import { r2Client, putJson, getJson } from './lib/r2.mjs'

const SOURCES = [pcc, anpp, fhrc]

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '../data')
const MANIFEST_KEY = 'manifest.json'
const OFAC_KEY = process.env.R2_KEY || 'ofac-entities.json'

function parseArgs(argv) {
	const args = { upload: false, ids: [] }
	for (const raw of argv.slice(2)) {
		if (raw === '--upload') args.upload = true
		else if (raw.startsWith('--')) throw new Error(`Unknown flag: ${raw}`)
		else args.ids.push(raw)
	}
	return args
}

async function main() {
	const args = parseArgs(process.argv)
	const sources = args.ids.length
		? args.ids.map((id) => {
			const found = SOURCES.find((s) => s.id === id)
			if (!found) throw new Error(`Unknown source "${id}". Available: ${SOURCES.map((s) => s.id).join(', ')}`)
			return found
		})
		: SOURCES

	await mkdir(DATA_DIR, { recursive: true })
	const results = []

	for (const src of sources) {
		const started = Date.now()
		console.log(`[lists] scraping ${src.id} (${src.label})…`)
		const entities = await src.fetchEntities()
		// A redesigned page that no longer matches our selectors would come back
		// empty — never overwrite a working list with nothing.
		if (entities.length === 0) throw new Error(`Source "${src.id}" returned 0 entities — refusing to overwrite the list`)

		const payload = {
			listId: src.id,
			source: src.label,
			generatedAt: new Date().toISOString(),
			entitiesCount: entities.length,
			entities,
		}
		const json = JSON.stringify(payload)
		const out = resolve(DATA_DIR, `${src.id}-entities.json`)
		await writeFile(out, json, 'utf-8')
		console.log(`[lists] wrote ${out} (${(json.length / 1024).toFixed(1)} KB, ${entities.length} entities) in ${Date.now() - started} ms`)
		results.push({ src, json })
	}

	if (!args.upload) return

	const client = await r2Client()
	for (const { src, json } of results) {
		const key = `lists/${src.id}.json`
		console.log(`[lists] uploading r2://${process.env.R2_BUCKET}/${key}`)
		await putJson(client, key, json)
	}

	// Upsert the manifest so the runtime discovers new lists without code changes.
	const manifest = (await getJson(client, MANIFEST_KEY)) ?? {
		version: 1,
		lists: [{ id: 'ofac', label: 'OFAC SDN', key: OFAC_KEY }],
	}
	for (const { src } of results) {
		const entry = { id: src.id, label: src.label, key: `lists/${src.id}.json` }
		const idx = manifest.lists.findIndex((l) => l.id === src.id)
		if (idx === -1) manifest.lists.push(entry)
		else manifest.lists[idx] = entry
	}
	await putJson(client, MANIFEST_KEY, JSON.stringify(manifest, null, '\t'))
	console.log(`[lists] manifest updated: ${manifest.lists.map((l) => l.id).join(', ')}`)
}

main().catch((err) => {
	console.error('[lists] import failed:', err)
	process.exit(1)
})

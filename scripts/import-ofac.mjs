#!/usr/bin/env node
// Parses the OFAC SDN Enhanced XML and produces a compact JSON suitable for
// the runtime API. Optionally uploads the JSON to Cloudflare R2 (or any
// S3-compatible bucket).
//
// Usage:
//   node scripts/import-ofac.mjs                       # read ./sdn_enhanced.xml, write ./data/ofac-entities.json
//   node scripts/import-ofac.mjs --xml=/path/to.xml    # read from path
//   node scripts/import-ofac.mjs --url=https://...     # download from URL
//   node scripts/import-ofac.mjs --upload              # also push to R2 (needs env vars below)
//
// Env vars for upload:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET, R2_KEY (default: ofac-entities.json)
//
// Env var convenience source:
//   OFAC_SDN_XML_URL  — overrides default download URL when no --xml/--url

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEFAULT_XML_PATH = resolve(ROOT, 'sdn_enhanced.xml')
const FALLBACK_XML_PATH = resolve(ROOT, 'public/sdn_enhanced.xml')
const DEFAULT_OUT_PATH = resolve(ROOT, 'data/ofac-entities.json')
const DEFAULT_OFAC_URL = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ENHANCED_XML'

function parseArgs(argv) {
	const args = { upload: false }
	for (const raw of argv.slice(2)) {
		if (raw === '--upload') args.upload = true
		else if (raw.startsWith('--xml=')) args.xml = raw.slice(6)
		else if (raw.startsWith('--url=')) args.url = raw.slice(6)
		else if (raw.startsWith('--out=')) args.out = raw.slice(6)
		else throw new Error(`Unknown arg: ${raw}`)
	}
	return args
}

async function readXmlSource(args) {

	if (args.xml) { console.log(`[ofac] reading XML from ${args.xml}`); return await readFile(args.xml, 'utf-8') }
	if (args.url || process.env.OFAC_SDN_XML_URL) {
		const url = args.url ?? process.env.OFAC_SDN_XML_URL
		console.log(`[ofac] downloading XML from ${url}`)
		const res = await fetch(url)
		if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
		return await res.text()
	}

	if (existsSync(DEFAULT_XML_PATH)) { console.log(`[ofac] reading XML from ${DEFAULT_XML_PATH}`); return await readFile(DEFAULT_XML_PATH, 'utf-8') }
	if (existsSync(FALLBACK_XML_PATH)) { console.log(`[ofac] reading XML from ${FALLBACK_XML_PATH}`); return await readFile(FALLBACK_XML_PATH, 'utf-8') }

	console.log(`[ofac] no local XML found, downloading from ${DEFAULT_OFAC_URL}`)
	const res = await fetch(DEFAULT_OFAC_URL)
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)

	return await res.text()
}

function toArray(value) {
	if (value == null) return []
	return Array.isArray(value) ? value : [value]
}

function textOf(node) {
	if (node == null) return null
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (typeof node === 'object' && '#text' in node) return String(node['#text'])
	return null
}

function normalizeEntity(raw) {

	const id = raw['@_id'] ?? raw.id ?? null

	const names = toArray(raw.names?.name).flatMap((nameNode) => {
		const isPrimary = nameNode.isPrimary === true || nameNode.isPrimary === 'true'
		const aliasType = textOf(nameNode.aliasType)
		return toArray(nameNode.translations?.translation).map((t) => ({
			full: textOf(t.formattedFullName) ?? joinNameParts(t),
			first: textOf(t.formattedFirstName),
			last: textOf(t.formattedLastName),
			isPrimary,
			aliasType,
			script: textOf(t.script),
		})).filter((n) => n.full)
	})

	const cryptoAddresses = toArray(raw.features?.feature).flatMap((feature) => {
		const type = textOf(feature.type) ?? ''
		if (!type.startsWith('Digital Currency Address')) return []
		const address = textOf(feature.value)
		if (!address) return []
		return [{ currency: type.split(' - ')[1] ?? null, address }]
	})

	return {
		id,
		identityId: textOf(raw.generalInfo?.identityId),
		type: textOf(raw.generalInfo?.entityType),
		programs: toArray(raw.sanctionsPrograms?.sanctionsProgram).map(textOf).filter(Boolean),
		sanctionsTypes: toArray(raw.sanctionsTypes?.sanctionsType).map(textOf).filter(Boolean),
		names,
		...(cryptoAddresses.length ? { cryptoAddresses } : {}),
	}
}

function joinNameParts(translation) {
	const parts = toArray(translation.nameParts?.namePart)
		.map((p) => textOf(p.value))
		.filter(Boolean)
	return parts.join(' ') || null
}

async function uploadToR2(json) {
	const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
	const missing = required.filter((k) => !process.env[k])
	if (missing.length) { throw new Error(`Missing R2 env vars: ${missing.join(', ')}`) }
	const key = process.env.R2_KEY ?? 'ofac-entities.json'

	// Lazy import so devs without the SDK installed can still run the script
	// without --upload.
	let S3Client, PutObjectCommand
	try {
		({ S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3'))
	} catch { throw new Error('Install @aws-sdk/client-s3 to use --upload: npm i -D @aws-sdk/client-s3') }

	const client = new S3Client({
		region: 'auto',
		endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: process.env.R2_ACCESS_KEY_ID,
			secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
		},
	})

	console.log(`[ofac] uploading ${(json.length / 1024 / 1024).toFixed(2)} MB to r2://${process.env.R2_BUCKET}/${key}`)
	await client.send(new PutObjectCommand({
		Bucket: process.env.R2_BUCKET,
		Key: key,
		Body: json,
		ContentType: 'application/json',
		CacheControl: 'public, max-age=300',
	}))
	console.log('[ofac] upload complete')
}

async function main() {

	const args = parseArgs(process.argv)
	const started = Date.now()

	const xmlText = await readXmlSource(args)
	console.log(`[ofac] parsing ${(xmlText.length / 1024 / 1024).toFixed(2)} MB of XML…`)

	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: '@_',
		parseAttributeValue: false,
		parseTagValue: false,
		trimValues: true,
	})
	const tree = parser.parse(xmlText)
	const root = tree.sanctionsData ?? tree
	const rawEntities = toArray(root.entities?.entity)
	console.log(`[ofac] found ${rawEntities.length} entities`)

	const entities = rawEntities.map(normalizeEntity).filter((e) => e.names.length > 0)

	const payload = {
		source: 'OFAC SDN Enhanced XML',
		generatedAt: new Date().toISOString(),
		publicationDate: textOf(root.publicationInfo?.dataAsOf),
		entitiesCount: entities.length,
		entities,
	}

	const out = args.out ?? DEFAULT_OUT_PATH
	await mkdir(dirname(out), { recursive: true })
	const json = JSON.stringify(payload)
	await writeFile(out, json, 'utf-8')
	console.log(`[ofac] wrote ${out} (${(json.length / 1024 / 1024).toFixed(2)} MB, ${entities.length} entities) in ${Date.now() - started} ms`)

	if (args.upload) await uploadToR2(json)
}

main().catch((err) => {
	console.error('[ofac] import failed:', err)
	process.exit(1)
})

import { normalize } from './scoring.js'

const TRIGRAM_SIZE = 3

let loadPromise = null

export function getDataset() {
	if (!loadPromise) loadPromise = loadDataset().catch((err) => {
		loadPromise = null
		throw err
	})
	return loadPromise
}

// Multi-list mode: LISTS_MANIFEST_URL points at a manifest.json enumerating
// every list; each entry's `key` resolves relative to the manifest URL, so the
// manifest and the list JSONs must share the same public base (one R2 bucket).
// Single-list fallback: OFAC_INDEX_URL alone behaves exactly as before.
async function resolveLists() {
	const manifestUrl = process.env.LISTS_MANIFEST_URL
	if (manifestUrl) {
		const res = await fetch(manifestUrl, { cache: 'no-store' })
		if (!res.ok) throw new Error(`Lists manifest fetch failed: ${res.status} ${res.statusText}`)
		const manifest = await res.json()
		if (!Array.isArray(manifest.lists) || manifest.lists.length === 0) {
			throw new Error('Lists manifest missing "lists" array')
		}
		return manifest.lists.map((l) => ({
			id: l.id,
			label: l.label ?? l.id,
			url: new URL(l.key ?? l.url, manifestUrl).href,
		}))
	}

	const url = process.env.OFAC_INDEX_URL
	if (!url) throw new Error('Set LISTS_MANIFEST_URL (multi-list) or OFAC_INDEX_URL (OFAC only)')
	return [{ id: 'ofac', label: 'OFAC SDN', url }]
}

async function loadDataset() {

	const started = Date.now()
	const listDefs = await resolveLists()

	const payloads = await Promise.all(listDefs.map(async (list) => {
		const res = await fetch(list.url, { cache: 'no-store' })
		if (!res.ok) throw new Error(`List "${list.id}" fetch failed: ${res.status} ${res.statusText}`)
		const payload = await res.json()
		if (!Array.isArray(payload.entities)) { throw new Error(`List "${list.id}" payload missing "entities" array`) }
		return payload
	}))

	// Flatten every list into one entity array; each entity is tagged with its
	// list id so search can filter per list against a single shared index.
	const entities = []
	const lists = []
	for (let i = 0; i < listDefs.length; i++) {
		const { id, label } = listDefs[i]
		for (const entity of payloads[i].entities) {
			entity.list = id
			entity.source ??= id.toUpperCase()
			entities.push(entity)
		}
		lists.push({
			id,
			label,
			entitiesCount: payloads[i].entities.length,
			generatedAt: payloads[i].generatedAt ?? null,
		})
	}

	const names = []         // flat list of { entityIdx, normalized, raw, list }
	const trigramIndex = new Map() // trigram -> Uint32Array of name indices (built later)
	const trigramBuilder = new Map() // trigram -> number[] during build

	for (let entityIdx = 0; entityIdx < entities.length; entityIdx++) {
		const entity = entities[entityIdx]
		if (!entity.names || entity.names.length === 0) continue
		for (const nameObj of entity.names) {
			const normalized = normalize(nameObj.full)
			if (!normalized) continue
			const nameIdx = names.length
			names.push({ entityIdx, normalized, raw: nameObj, list: entity.list })
			for (const tri of trigramsOf(normalized)) {
				let bucket = trigramBuilder.get(tri)
				if (!bucket) {
					bucket = []
					trigramBuilder.set(tri, bucket)
				}
				bucket.push(nameIdx)
			}
		}
	}

	// Freeze trigram buckets into typed arrays — faster iteration, lower memory.
	for (const [tri, arr] of trigramBuilder) {
		trigramIndex.set(tri, Uint32Array.from(arr))
	}

	// Exact-match index for digital currency addresses. Keyed lowercase so
	// ETH checksum casing doesn't matter; matches keep the original casing.
	const cryptoIndex = new Map() // lowercase address -> [{ entityIdx, currency, address }]
	for (let entityIdx = 0; entityIdx < entities.length; entityIdx++) {
		for (const { currency, address } of entities[entityIdx].cryptoAddresses ?? []) {
			const key = address.toLowerCase()
			let bucket = cryptoIndex.get(key)
			if (!bucket) {
				bucket = []
				cryptoIndex.set(key, bucket)
			}
			bucket.push({ entityIdx, currency, address })
		}
	}

	const elapsed = Date.now() - started
	return {
		entities,
		names,
		trigramIndex,
		cryptoIndex,
		lists,
		generatedAt: payloads[0]?.generatedAt ?? null,
		loadedAt: new Date().toISOString(),
		loadMs: elapsed,
	}
}

export function trigramsOf(normalizedStr) {
	if (!normalizedStr) return []
	const padded = `  ${normalizedStr}  `
	const out = new Set()
	for (let i = 0; i <= padded.length - TRIGRAM_SIZE; i++) {
		out.add(padded.slice(i, i + TRIGRAM_SIZE))
	}
	return out
}

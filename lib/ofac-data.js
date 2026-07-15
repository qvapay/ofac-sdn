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

async function loadDataset() {
	
	const url = process.env.OFAC_INDEX_URL
	if (!url) throw new Error('OFAC_INDEX_URL is not set')

	const started = Date.now()
	const res = await fetch(url, { cache: 'no-store' })
	if (!res.ok) throw new Error(`OFAC index fetch failed: ${res.status} ${res.statusText}`)
	const payload = await res.json()

	if (!Array.isArray(payload.entities)) { throw new Error('OFAC index payload missing "entities" array') }

	const entities = payload.entities
	const names = []         // flat list of { entityIdx, name, normalized }
	const trigramIndex = new Map() // trigram -> Uint32Array of name indices (built later)
	const trigramBuilder = new Map() // trigram -> number[] during build

	for (let entityIdx = 0; entityIdx < entities.length; entityIdx++) {
		const entity = entities[entityIdx]
		if (!entity.names || entity.names.length === 0) continue
		for (const nameObj of entity.names) {
			const normalized = normalize(nameObj.full)
			if (!normalized) continue
			const nameIdx = names.length
			names.push({ entityIdx, normalized, raw: nameObj })
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
		generatedAt: payload.generatedAt ?? null,
		loadedAt: new Date().toISOString(),
		loadMs: elapsed,
		sourceUrl: url,
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

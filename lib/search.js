import { getDataset, trigramsOf } from './ofac-data.js'
import { normalize, score } from './scoring.js'

// Thrown when the caller requests a list id the dataset doesn't have; the API
// route maps it to a 400.
export class UnknownListError extends Error {}

// null means "search every list" (no filtering cost); otherwise a Set of ids.
function resolveListFilter(data, lists) {
	if (!lists || lists.length === 0) return null
	const available = new Set(data.lists.map((l) => l.id))
	const requested = [...new Set(lists.map((s) => s.trim().toLowerCase()).filter(Boolean))]
	const unknown = requested.filter((id) => !available.has(id))
	if (unknown.length) {
		throw new UnknownListError(`Unknown list(s): ${unknown.join(', ')}. Available: ${[...available].join(', ')}`)
	}
	if (requested.length === available.size) return null
	return new Set(requested)
}

// Two-stage search:
//  1) Candidate retrieval — pick names that share enough trigrams with the
//     query. This skips the vast majority of the ~13k entries cheaply.
//  2) Full scoring — run Jaro-Winkler + token-set on the candidate names,
//     keep the best score per entity, return the top N above minScore.
export async function searchName(rawQuery, { limit = 10, minScore = 70, candidatePool = 400, lists = null } = {}) {

	const query = normalize(rawQuery)
	if (!query) return { query: rawQuery, results: [], total: 0 }

	const data = await getDataset()
	const allowed = resolveListFilter(data, lists)
	const queryTrigrams = [...trigramsOf(query)]

	// Tally trigram hits per name index. List filtering happens here — before
	// the candidatePool cut — so a narrow-list query can't be starved by
	// higher-overlap names from other lists.
	const hits = new Map()
	for (const tri of queryTrigrams) {
		const bucket = data.trigramIndex.get(tri)
		if (!bucket) continue
		for (let i = 0; i < bucket.length; i++) {
			const nameIdx = bucket[i]
			if (allowed && !allowed.has(data.names[nameIdx].list)) continue
			hits.set(nameIdx, (hits.get(nameIdx) ?? 0) + 1)
		}
	}

	// Very short queries (1–2 normalized chars) rely mostly on padding
	// trigrams and may legitimately miss the inverted index — only then is a
	// linear scan worth it. Longer queries with zero hits genuinely have no
	// candidate; return empty rather than scanning ~40k names for nothing.
	let candidateNameIdxs
	if (hits.size === 0) {
		if (query.length < 3) {
			candidateNameIdxs = data.names.map((_, i) => i)
		} else {
			candidateNameIdxs = []
		}
	} else {
		candidateNameIdxs = [...hits.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, candidatePool)
			.map(([idx]) => idx)
	}

	// Score candidates; collapse to best score per entity. The list check here
	// only matters for the short-query linear scan (trigram hits are pre-filtered).
	const bestByEntity = new Map()
	for (const nameIdx of candidateNameIdxs) {
		const entry = data.names[nameIdx]
		if (allowed && !allowed.has(entry.list)) continue
		const s = score(query, entry.normalized)
		if (s < minScore) continue
		const current = bestByEntity.get(entry.entityIdx)
		if (!current || s > current.score) {
			bestByEntity.set(entry.entityIdx, {
				score: s,
				matchedName: entry.raw,
			})
		}
	}

	const ranked = [...bestByEntity.entries()]
		.map(([entityIdx, hit]) => ({
			score: hit.score,
			matchedName: hit.matchedName,
			entity: data.entities[entityIdx],
		}))
		.sort((a, b) => b.score - a.score)

	return {
		query: rawQuery,
		normalizedQuery: query,
		total: ranked.length,
		results: ranked.slice(0, limit),
		meta: {
			datasetGeneratedAt: data.generatedAt,
			entitiesIndexed: data.entities.length,
			namesIndexed: data.names.length,
			lists: data.lists,
			listsSearched: allowed ? [...allowed] : data.lists.map((l) => l.id),
		},
	}
}

// Exact lookup of a digital currency address (case-insensitive). Unlike
// names, addresses either match or they don't — no fuzzy stage.
export async function searchAddress(rawAddress, { lists = null } = {}) {

	const address = rawAddress.trim()
	const data = await getDataset()
	const allowed = resolveListFilter(data, lists)
	const matches = (data.cryptoIndex.get(address.toLowerCase()) ?? [])
		.filter(({ entityIdx }) => !allowed || allowed.has(data.entities[entityIdx].list))

	return {
		query: rawAddress,
		total: matches.length,
		results: matches.map(({ entityIdx, currency, address: matchedAddress }) => ({
			score: 100,
			matchedAddress,
			currency,
			entity: data.entities[entityIdx],
		})),
		meta: {
			datasetGeneratedAt: data.generatedAt,
			entitiesIndexed: data.entities.length,
			addressesIndexed: data.cryptoIndex.size,
			lists: data.lists,
			listsSearched: allowed ? [...allowed] : data.lists.map((l) => l.id),
		},
	}
}

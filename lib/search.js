import { getDataset, trigramsOf } from './ofac-data.js'
import { normalize, score } from './scoring.js'

// Two-stage search:
//  1) Candidate retrieval — pick names that share enough trigrams with the
//     query. This skips the vast majority of the ~13k entries cheaply.
//  2) Full scoring — run Jaro-Winkler + token-set on the candidate names,
//     keep the best score per entity, return the top N above minScore.
export async function searchName(rawQuery, { limit = 10, minScore = 70, candidatePool = 400 } = {}) {

	const query = normalize(rawQuery)
	if (!query) return { query: rawQuery, results: [], total: 0 }

	const data = await getDataset()
	const queryTrigrams = [...trigramsOf(query)]

	// Tally trigram hits per name index.
	const hits = new Map()
	for (const tri of queryTrigrams) {
		const bucket = data.trigramIndex.get(tri)
		if (!bucket) continue
		for (let i = 0; i < bucket.length; i++) {
			const nameIdx = bucket[i]
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

	// Score candidates; collapse to best score per entity.
	const bestByEntity = new Map()
	for (const nameIdx of candidateNameIdxs) {
		const entry = data.names[nameIdx]
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
		},
	}
}

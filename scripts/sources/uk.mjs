// UK OFSI Consolidated List of financial sanctions targets (HM Treasury).
// One XML row per name variant; rows sharing a GroupID are the same target,
// so we group them into one entity with the primary name plus aliases.
import { XMLParser } from 'fast-xml-parser'
import { fetchHtml, cleanText } from '../lib/scrape.mjs'

export const id = 'uk'
export const label = 'UK OFSI Consolidated List'
export const source = 'UK OFSI'

const URL = process.env.UK_OFSI_URL || 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml'

const TYPE_MAP = { Individual: 'Individual', Entity: 'Entity', Ship: 'Vessel' }

export async function fetchEntities() {
	// ~55 MB download — the statement-of-reasons prose dominates; we keep none of it.
	const xml = await fetchHtml(URL, { timeoutMs: 300000, headers: { accept: 'application/xml' } })
	const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false })
	const tree = parser.parse(xml)
	const rows = tree.ArrayOfFinancialSanctionsTarget?.FinancialSanctionsTarget
	if (!Array.isArray(rows) || rows.length === 0) throw new Error('uk: unexpected XML shape (no FinancialSanctionsTarget rows)')

	const groups = new Map() // GroupID -> entity under construction

	for (const row of rows) {
		const full = cleanText([row.name1, row.name2, row.name3, row.name4, row.name5, row.Name6].filter(Boolean).join(' '))
		if (!full) continue
		const groupId = row.GroupID
		let entity = groups.get(groupId)
		if (!entity) {
			entity = {
				id: `uk-${groupId}`,
				source,
				type: TYPE_MAP[cleanText(row.GroupTypeDescription)] ?? 'Individual',
				programs: [],
				names: [],
				_seen: new Set(),
			}
			groups.set(groupId, entity)
		}

		const regime = cleanText(row.RegimeName)
		if (regime && !entity.programs.includes(regime)) entity.programs.push(regime)
		const position = cleanText(row.Individual_Position)
		if (position && !entity.role) entity.role = position

		const key = full.toLowerCase()
		if (entity._seen.has(key)) continue
		entity._seen.add(key)
		// "Primary name" rows lead; alias rows ("Primary name variation",
		// "A.K.A.", …) follow. Order within the group is not guaranteed, so
		// promote a primary row to the front if it shows up late.
		const isPrimary = cleanText(row.AliasType) === 'Primary name'
		if (isPrimary && entity.names.some((n) => n.isPrimary)) {
			entity.names.push({ full, isPrimary: false })
		} else if (isPrimary) {
			entity.names.unshift({ full, isPrimary: true })
		} else {
			entity.names.push({ full, isPrimary: false })
		}
	}

	const entities = []
	for (const entity of groups.values()) {
		if (entity.names.length === 0) continue
		if (!entity.names.some((n) => n.isPrimary)) entity.names[0].isPrimary = true
		delete entity._seen
		entities.push(entity)
	}
	return entities
}

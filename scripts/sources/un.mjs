// UN Security Council Consolidated Sanctions List. Official XML published by
// the UN at a stable URL — individuals and entities designated by Security
// Council committees (ISIL/Al-Qaida, DPRK, Taliban, DRC, …).
import { XMLParser } from 'fast-xml-parser'
import { fetchHtml, cleanText } from '../lib/scrape.mjs'

export const id = 'un'
export const label = 'UN Security Council Consolidated List'
export const source = 'UN Security Council'

const URL = process.env.UN_LIST_URL || 'https://scsanctions.un.org/resources/xml/en/consolidated.xml'

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

function names(primary, aliases) {
	const out = []
	const seen = new Set()
	const push = (full, isPrimary) => {
		const clean = cleanText(full)
		const key = clean.toLowerCase()
		if (!clean || seen.has(key)) return
		seen.add(key)
		out.push({ full: clean, isPrimary })
	}
	push(primary, true)
	for (const alias of aliases) push(alias.ALIAS_NAME, false)
	return out
}

export async function fetchEntities() {
	
	const xml = await fetchHtml(URL, { timeoutMs: 180000, headers: { accept: 'application/xml' } })
	const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false })
	const tree = parser.parse(xml)
	const list = tree.CONSOLIDATED_LIST
	if (!list) throw new Error('un: unexpected XML shape (no CONSOLIDATED_LIST root)')

	const entities = []

	for (const ind of toArray(list.INDIVIDUALS?.INDIVIDUAL)) {
		const full = [ind.FIRST_NAME, ind.SECOND_NAME, ind.THIRD_NAME, ind.FOURTH_NAME].map(cleanText).filter(Boolean).join(' ')
		const nameList = names(full, toArray(ind.INDIVIDUAL_ALIAS))
		if (nameList.length === 0) continue
		entities.push({
			id: `un-${ind.DATAID}`,
			source,
			type: 'Individual',
			programs: [cleanText(ind.UN_LIST_TYPE)].filter(Boolean),
			names: nameList,
		})
	}

	for (const ent of toArray(list.ENTITIES?.ENTITY)) {
		const nameList = names(ent.FIRST_NAME, toArray(ent.ENTITY_ALIAS))
		if (nameList.length === 0) continue
		entities.push({
			id: `un-${ent.DATAID}`,
			source,
			type: 'Entity',
			programs: [cleanText(ent.UN_LIST_TYPE)].filter(Boolean),
			names: nameList,
		})
	}

	return entities
}

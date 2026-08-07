// EU Consolidated Financial Sanctions List (FSF), published by the European
// Commission (DG FISMA). The download URL carries a well-known public token
// that has been stable for years; override with EU_FSF_URL if it rotates.
import { XMLParser } from 'fast-xml-parser'
import { fetchHtml, cleanText } from '../lib/scrape.mjs'

export const id = 'eu'
export const label = 'EU Consolidated Financial Sanctions'
export const source = 'EU FSF'

const URL = process.env.EU_FSF_URL || 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw'

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

export async function fetchEntities() {
	
	const xml = await fetchHtml(URL, { timeoutMs: 300000, headers: { accept: 'application/xml' } })
	const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false })
	const tree = parser.parse(xml)
	const records = toArray(tree.export?.sanctionEntity)
	if (records.length === 0) throw new Error('eu: unexpected XML shape (no export.sanctionEntity records)')

	const entities = []

	for (const rec of records) {
		const seen = new Set()
		const names = []
		for (const alias of toArray(rec.nameAlias)) {
			const whole = cleanText(alias['@_wholeName'])
				|| cleanText([alias['@_firstName'], alias['@_middleName'], alias['@_lastName']].filter(Boolean).join(' '))
			const key = whole.toLowerCase()
			if (!whole || seen.has(key)) continue
			seen.add(key)
			names.push({ full: whole, isPrimary: false })
		}
		if (names.length === 0) continue
		// Aliases come in no useful order and often lead with non-Latin script;
		// surface a Latin-script name as primary when one exists.
		const primary = names.find((n) => /[a-z]/i.test(n.full)) ?? names[0]
		primary.isPrimary = true
		names.splice(names.indexOf(primary), 1)
		names.unshift(primary)

		const programs = [...new Set(toArray(rec.regulation).map((r) => cleanText(r['@_programme'])).filter(Boolean))]
		const ref = rec['@_euReferenceNumber'] || rec['@_logicalId']
		entities.push({
			id: `eu-${String(ref).replace(/\s+/g, '')}`,
			source,
			type: rec.subjectType?.['@_code'] === 'enterprise' ? 'Entity' : 'Individual',
			programs,
			names,
		})
	}

	return entities
}

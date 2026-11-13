// UK Sanctions List (FCDO). Since the OFSI Consolidated List closed on 28 January 2026, this is the
// only source of UK designations; the old OFSI blob (ofsistorage…/ConList.xml) answers 409 "Public
// access is not permitted" (issue #10). One <Designation> per target and regime. Designations of
// the same target share an OFSIGroupID, so they are merged into one entity, keyed by that group id
// like the old OFSI rows were (`uk-<GroupID>`) so entity ids stay stable across the switch.
import { XMLParser } from 'fast-xml-parser'
import { fetchHtml, cleanText } from '../lib/scrape.mjs'

export const id = 'uk'
export const label = 'UK Sanctions List (FCDO)'
export const source = 'UK FCDO'

const URL = process.env.UK_SANCTIONS_URL || 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml'

const TYPE_MAP = { individual: 'Individual', entity: 'Entity', ship: 'Vessel' }
const ARRAYS = new Set(['Designation', 'Name', 'NonLatinName', 'Address', 'Individual', 'DOB', 'Nationality', 'Position', 'Location', 'Gender'])
const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

// "dd/mm/1975", "mm" or "dd" when unknown → the same { value, from, to, approximate } shape the OFAC
// import writes, so a reviewer (and qpweb's triage) can compare birth dates across lists.
export function parseUkDate(raw) {
	const value = cleanText(raw)
	const m = value.match(/^(\d{2}|dd)\/(\d{2}|mm)\/(\d{4})$/i)
	if (!m) return value ? { value, from: null, to: null, approximate: true } : null
	const [, d, mo, y] = m
	const day = /^\d+$/.test(d) ? d : null
	const month = /^\d+$/.test(mo) ? mo : null
	if (month && day) return { value, from: `${y}-${month}-${day}`, to: `${y}-${month}-${day}`, approximate: false }
	if (month) {
		const last = new Date(Date.UTC(Number(y), Number(month), 0)).getUTCDate()
		return { value, from: `${y}-${month}-01`, to: `${y}-${month}-${String(last).padStart(2, '0')}`, approximate: true }
	}
	return { value, from: `${y}-01-01`, to: `${y}-12-31`, approximate: true }
}

const pushUnique = (list, value) => { if (value && !list.includes(value)) list.push(value) }

/**
 * Parses the FCDO XML into runtime entities. Pure, so the shape can be tested without the 22 MB download.
 * @param {string} xml
 * @returns {object[]}
 */
export function parseUkSanctionsXml(xml) {
	const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (name) => ARRAYS.has(name) })
	const rows = parser.parse(xml)?.Designations?.Designation
	if (!Array.isArray(rows) || rows.length === 0) throw new Error('uk: unexpected XML shape (no Designations/Designation rows)')

	const groups = new Map()
	for (const row of rows) {
		const groupId = cleanText(row.OFSIGroupID) || cleanText(row.UniqueID)
		if (!groupId) continue
		let entity = groups.get(groupId)
		if (!entity) {
			entity = {
				id: `uk-${groupId}`,
				source,
				type: TYPE_MAP[cleanText(row.IndividualEntityShip).toLowerCase()] ?? 'Individual',
				programs: [],
				names: [],
				_seen: new Set(),
				_ids: { birthDates: [], placesOfBirth: [], nationalities: [], genders: [], addressCountries: [] },
			}
			groups.set(groupId, entity)
		}
		pushUnique(entity.programs, cleanText(row.RegimeName))

		const add = (full, isPrimary) => {
			if (!full) return
			const key = full.toLowerCase()
			if (entity._seen.has(key)) return
			entity._seen.add(key)
			// Primary names lead; a second "primary" (another regime's row) becomes an alias.
			if (isPrimary && !entity.names.some((n) => n.isPrimary)) entity.names.unshift({ full, isPrimary: true })
			else entity.names.push({ full, isPrimary: false })
		}
		for (const name of toArray(row.Names?.Name)) {
			// Name1…Name5 are forenames/middle names and Name6 the surname or the whole entity name, as in OFSI.
			const full = cleanText([name.Name1, name.Name2, name.Name3, name.Name4, name.Name5, name.Name6].filter(Boolean).join(' '))
			add(full, cleanText(name.NameType).toLowerCase() === 'primary name')
		}
		for (const name of toArray(row.NonLatinNames?.NonLatinName)) add(cleanText(name.NameNonLatinScript), false)

		for (const person of toArray(row.IndividualDetails?.Individual)) {
			if (!entity.role) entity.role = cleanText(toArray(person.Positions?.Position)[0]) || undefined
			for (const dob of toArray(person.DOBs?.DOB)) {
				const parsed = parseUkDate(dob)
				if (parsed && !entity._ids.birthDates.some((d) => d.value === parsed.value)) entity._ids.birthDates.push(parsed)
			}
			for (const nat of toArray(person.Nationalities?.Nationality)) pushUnique(entity._ids.nationalities, cleanText(nat))
			for (const g of toArray(person.Genders?.Gender)) pushUnique(entity._ids.genders, cleanText(g))
			for (const loc of toArray(person.BirthDetails?.Location)) {
				pushUnique(entity._ids.placesOfBirth, cleanText([loc.TownOfBirth, loc.CountryOfBirth].filter(Boolean).join(', ')))
			}
		}
		for (const address of toArray(row.Addresses?.Address)) pushUnique(entity._ids.addressCountries, cleanText(address.AddressCountry))
	}

	const entities = []
	for (const entity of groups.values()) {
		if (entity.names.length === 0) continue
		if (!entity.names.some((n) => n.isPrimary)) entity.names[0].isPrimary = true
		for (const [key, list] of Object.entries(entity._ids)) if (list.length) entity[key] = list
		if (!entity.role) delete entity.role
		delete entity._seen
		delete entity._ids
		entities.push(entity)
	}
	return entities
}

export async function fetchEntities() {
	// ~22 MB download; the statements of reasons dominate and none of it is kept.
	const xml = await fetchHtml(URL, { timeoutMs: 300000, headers: { accept: 'application/xml' } })
	return parseUkSanctionsXml(xml)
}

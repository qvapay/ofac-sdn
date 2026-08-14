// OpenSanctions consolidated sanctions collection (targets.simple.csv, updated
// daily). Aggregates 90+ official lists; we keep only entities NOT already on
// a list we import directly (OFAC SDN, UN, EU FSF, UK) so results never show
// the same designation twice. Net gain: Canada, Switzerland, Australia, Japan,
// France, US CSL/BIS, Israel crypto wallets, and ~80 more sources.
//
// Licensing: CC-BY-NC — fine for this non-commercial public service, but keep
// the "Data: OpenSanctions" attribution visible wherever results are shown.
import { cleanText } from '../lib/scrape.mjs'

export const id = 'opensanctions'
export const label = 'OpenSanctions (complementary lists)'
export const source = 'OpenSanctions'

const URL = process.env.OPENSANCTIONS_CSV_URL || 'https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv'

// Dataset labels (the CSV `dataset` column) already imported directly by other
// sources — a row carrying ANY of these is dropped, because that entity
// already surfaces via the dedicated list. If OpenSanctions renames a label,
// the guard in fetchEntities() throws rather than silently letting
// duplicates through.
const COVERED_DATASETS = [
	'US OFAC Specially Designated Nationals (SDN) List',
	'UN Security Council Consolidated Sanctions',
	'EU Financial Sanctions Files (FSF)',
	'UK FCDO Sanctions List',
]

// CSV `schema` → our entity type. Schemas not listed here (Security, Address)
// are skipped — they aren't name-screening targets.
const SCHEMA_TYPES = {
	Person: 'Individual',
	Organization: 'Entity',
	Company: 'Entity',
	LegalEntity: 'Entity',
	PublicBody: 'Entity',
	CryptoWallet: 'Entity',
	Vessel: 'Vessel',
	Airplane: 'Aircraft',
}

// Minimal RFC 4180 parser — fields may contain quoted commas, newlines and
// doubled quotes, so line splitting is not an option.
function parseCsv(text) {
	const rows = []
	let row = []
	let field = ''
	let inQuotes = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') { field += '"'; i++ }
				else inQuotes = false
			} else field += c
		} else if (c === '"') inQuotes = true
		else if (c === ',') { row.push(field); field = '' }
		else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++
			row.push(field); field = ''
			if (row.length > 1 || row[0] !== '') rows.push(row)
			row = []
		} else field += c
	}
	if (field !== '' || row.length) { row.push(field); rows.push(row) }
	return rows
}

const splitList = (v) => (v ?? '').split(';').map(cleanText).filter(Boolean)

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
	for (const alias of aliases) push(alias, false)
	return out
}

export async function fetchEntities() {
	const res = await fetch(URL, { signal: AbortSignal.timeout(300000) })
	if (!res.ok) throw new Error(`opensanctions: HTTP ${res.status} ${res.statusText}`)
	const rows = parseCsv(await res.text())

	const header = rows[0]
	const col = (name) => {
		const idx = header.indexOf(name)
		if (idx === -1) throw new Error(`opensanctions: CSV column "${name}" missing — format changed?`)
		return idx
	}
	const ID = col('id'), SCHEMA = col('schema'), NAME = col('name'), ALIASES = col('aliases')
	const IDENTIFIERS = col('identifiers'), PROGRAMS = col('program_ids'), DATASET = col('dataset')

	const coveredHits = new Map(COVERED_DATASETS.map((d) => [d, 0]))
	const entities = []

	for (let i = 1; i < rows.length; i++) {
		const row = rows[i]
		const type = SCHEMA_TYPES[row[SCHEMA]]
		if (!type) continue

		const datasets = splitList(row[DATASET])
		let covered = false
		for (const d of datasets) {
			if (coveredHits.has(d)) {
				coveredHits.set(d, coveredHits.get(d) + 1)
				covered = true
			}
		}
		if (covered) continue

		const nameList = names(row[NAME], splitList(row[ALIASES]))
		if (nameList.length === 0) continue

		const entity = {
			id: `opensanctions-${row[ID]}`,
			source,
			type,
			programs: splitList(row[PROGRAMS]),
			names: nameList,
			datasets,
			url: `https://www.opensanctions.org/entities/${row[ID]}/`,
		}

		if (row[SCHEMA] === 'CryptoWallet') {
			// Wallets are standalone entities; the address sits in `identifiers`
			// (and usually doubles as the name). Currency isn't in the simple CSV.
			const addresses = splitList(row[IDENTIFIERS]).filter((a) => /^[a-zA-Z0-9]{20,}$/.test(a))
			if (addresses.length === 0) continue
			entity.cryptoAddresses = addresses.map((address) => ({ currency: null, address }))
		}

		entities.push(entity)
	}

	// If a covered label matched zero rows, OpenSanctions renamed it and the
	// dedup filter is silently broken — fail loudly instead of double-listing
	// every OFAC/UN/EU/UK entity.
	for (const [dataset, hits] of coveredHits) {
		if (hits === 0) throw new Error(`opensanctions: covered dataset label "${dataset}" matched 0 rows — did it get renamed?`)
	}

	return entities
}

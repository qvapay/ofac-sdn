// Scraper for the FHRC "Represores Cubanos" database
// (represorescubanosfhrc.com, Foundation for Human Rights in Cuba). The site
// is a Vite SPA with no server-rendered rows — the data lives in a public
// Supabase table (`represores`, anon read via RLS, ~1.7k rows). We discover
// the Supabase URL and anon key from the deployed JS bundle on every run so a
// redeploy that renames the bundle or rotates the key doesn't break us.
import { fetchHtml, cleanText, slugify } from '../lib/scrape.mjs'

export const id = 'fhrc'
export const label = 'FHRC — Represores Cubanos'
export const source = 'FHRC'

const BASE = 'https://represorescubanosfhrc.com'
const PAGE_SIZE = 1000 // PostgREST caps responses at 1000 rows
const MAX_PAGES = 50 // hard stop in case pagination misbehaves

async function discoverSupabase() {
	const html = await fetchHtml(`${BASE}/represores`)
	const bundlePath = html.match(/\/assets\/index-[\w-]+\.js/)?.[0]
	if (!bundlePath) throw new Error('fhrc: no JS bundle reference found in the page HTML')

	const bundle = await fetchHtml(new URL(bundlePath, BASE).href)
	const url = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
	const key = (bundle.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) ?? []).find((jwt) => {
		try {
			const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString())
			return payload.iss === 'supabase' && payload.role === 'anon'
		} catch {
			return false
		}
	})
	if (!url || !key) throw new Error('fhrc: could not extract the Supabase URL/anon key from the bundle')
	return { url, key }
}

export async function fetchEntities() {
	const { url, key } = await discoverSupabase()
	const entities = []
	const seen = new Set()

	for (let page = 0; page < MAX_PAGES; page++) {
		const query = `select=slug,nombre,cargo,institucion&order=id.asc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
		const json = await fetchHtml(`${url}/rest/v1/represores?${query}`, {
			headers: { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' },
		})
		const rows = JSON.parse(json)

		for (const row of rows) {
			// Names carry annotations like "(en EE.UU.)" or "(Prohibido
			// Olvidar)" — noise for fuzzy matching, so strip parentheticals.
			const full = cleanText((row.nombre ?? '').replace(/\([^)]*\)/g, ' ')) || cleanText(row.nombre)
			if (!full) continue
			const slug = row.slug || slugify(full)
			if (seen.has(slug)) continue
			seen.add(slug)
			entities.push({
				id: `fhrc-${slug}`,
				source,
				type: 'Individual',
				programs: [],
				names: [{ full, isPrimary: true }],
				role: cleanText(row.cargo) || null,
				org: cleanText(row.institucion) || null,
				url: `${BASE}/represores/${slug}`,
			})
		}

		if (rows.length < PAGE_SIZE) break
	}

	return entities
}

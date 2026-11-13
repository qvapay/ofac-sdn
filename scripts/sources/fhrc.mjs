// Scraper for the FHRC "Represores Cubanos" database
// (represorescubanosfhrc.com, Foundation for Human Rights in Cuba). The site
// is a Vite SPA with no server-rendered rows — the data lives in a public
// Supabase table (`represores`, anon read via RLS, ~1.7k rows). We discover
// the Supabase URL and anon key from the deployed JS bundle on every run so a
// redeploy that renames the bundle or rotates the key doesn't break us.
import { gunzipSync } from 'node:zlib'
import { fetchHtml, cleanText, slugify } from '../lib/scrape.mjs'

export const id = 'fhrc'
export const label = 'FHRC — Represores Cubanos'
export const source = 'FHRC'

const BASE = 'https://represorescubanosfhrc.com'
const PAGE_SIZE = 1000 // PostgREST caps responses at 1000 rows
const MAX_PAGES = 50 // hard stop in case pagination misbehaves

// Supabase URL + anon key from a bundle's source.
function supabaseFromBundle(bundle) {
	const url = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0]
	const key = (bundle.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) ?? []).find((jwt) => {
		try {
			const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString())
			return payload.iss === 'supabase' && payload.role === 'anon'
		} catch {
			return false
		}
	})
	return url && key ? { url, key } : null
}

async function fromLiveSite() {
	const html = await fetchHtml(`${BASE}/represores`)
	const bundlePath = html.match(/\/assets\/index-[\w-]+\.js/)?.[0]
	if (!bundlePath) throw new Error('no JS bundle reference found in the page HTML')
	const found = supabaseFromBundle(await fetchHtml(new URL(bundlePath, BASE).href))
	if (!found) throw new Error('could not extract the Supabase URL/anon key from the bundle')
	return found
}

// The site has been unreachable since early November 2026 (TLS errors, then 404 on /represores),
// while its Supabase table kept serving the same rows. The last archived bundle on the Wayback
// Machine still names the project and its public anon key, so we read them from there.
async function fromArchivedBundle() {
	const cdx = await fetchHtml('https://web.archive.org/cdx/search/cdx?url=represorescubanosfhrc.com/assets/&matchType=prefix&output=json&fl=timestamp,original&filter=statuscode:200', { headers: { accept: 'application/json' } })
	const rows = JSON.parse(cdx).slice(1).filter(([, original]) => /\/assets\/index-[\w-]+\.js$/.test(original))
	rows.sort((a, b) => b[0].localeCompare(a[0]))
	for (const [timestamp, original] of rows.slice(0, 5)) {
		// `id_` returns the archived bytes untouched; they may still be gzip-compressed.
		const res = await fetch(`https://web.archive.org/web/${timestamp}id_/${original}`, { signal: AbortSignal.timeout(60000) })
		if (!res.ok) continue
		let buf = Buffer.from(await res.arrayBuffer())
		if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf)
		const found = supabaseFromBundle(buf.toString('utf-8'))
		if (found) return found
	}
	throw new Error('no archived bundle with the Supabase URL/anon key')
}

async function discoverSupabase() {
	if (process.env.FHRC_SUPABASE_URL && process.env.FHRC_SUPABASE_ANON_KEY) {
		return { url: process.env.FHRC_SUPABASE_URL, key: process.env.FHRC_SUPABASE_ANON_KEY }
	}
	try {
		return await fromLiveSite()
	} catch (err) {
		console.warn(`[lists] fhrc: site unavailable (${err.message}); using the last archived bundle`)
		return await fromArchivedBundle()
	}
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

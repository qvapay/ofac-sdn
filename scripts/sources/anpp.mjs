// Scraper for the diputados directory of the Asamblea Nacional del Poder
// Popular (www.parlamentocubano.gob.cu). All ~470 deputies render on a single
// page as Drupal view cards; each card carries name, cargo and the
// organizations the deputy belongs to (PCC, CDR, CTC, …).
import * as cheerio from 'cheerio'
import { fetchHtml, cleanText, slugFromHref, slugify } from '../lib/scrape.mjs'

export const id = 'anpp'
export const label = 'ANPP — Diputados'
export const source = 'ANPP'

const BASE = 'https://www.parlamentocubano.gob.cu'
const LIST_URL = `${BASE}/diputados`

export async function fetchEntities() {
	const html = await fetchHtml(LIST_URL)
	const $ = cheerio.load(html)
	const entities = []
	const seen = new Set()

	$('.w-views-miembros-diputados.views-row').each((_, row) => {
		const $row = $(row)
		const link = $row.find('.views-field-title a').first()
		const full = cleanText(link.text())
		if (!full) return
		const href = link.attr('href')
		const slug = slugFromHref(href) ?? slugify(full)
		if (seen.has(slug)) return
		seen.add(slug)

		const organizations = $row
			.find('.views-field-field-organizaciones-a-las-que-p .field-content a')
			.map((_, a) => cleanText($(a).text()))
			.get()
			.filter(Boolean)

		entities.push({
			id: `anpp-${slug}`,
			source,
			type: 'Individual',
			programs: [],
			names: [{ full, isPrimary: true }],
			role: cleanText($row.find('.views-field-field-cargo .field-content').first().text()) || null,
			...(organizations.length ? { organizations } : {}),
			url: href ? new URL(href, BASE).href : null,
		})
	})

	return entities
}

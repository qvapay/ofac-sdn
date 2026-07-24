// Scraper for the PCC people directory (www.pcc.cu, Drupal view).
// Renders as a table — Nombre | Edad | Nivel escolar | Graduado de | Cargo |
// Entidad | Redes — paginated via ?page=0..N. A page that yields no new rows
// ends the walk.
import * as cheerio from 'cheerio'
import { fetchHtml, cleanText, slugFromHref, slugify } from '../lib/scrape.mjs'

export const id = 'pcc'
export const label = 'PCC — Directorio de personas'
export const source = 'PCC'

const BASE = 'https://www.pcc.cu'
const LIST_URL = `${BASE}/index.php/directorio-personas`
const MAX_PAGES = 50 // hard stop in case pagination misbehaves

export async function fetchEntities() {
	const entities = []
	const seen = new Set()

	for (let page = 0; page < MAX_PAGES; page++) {
		const html = await fetchHtml(`${LIST_URL}?page=${page}`)
		const $ = cheerio.load(html)
		let added = 0

		$('table tbody tr').each((_, tr) => {
			const $tr = $(tr)
			const link = $tr.find('td.views-field-title a').first()
			const full = cleanText(link.text())
			if (!full) return
			const href = link.attr('href')
			const slug = slugFromHref(href) ?? slugify(full)
			if (seen.has(slug)) return
			seen.add(slug)
			added++
			entities.push({
				id: `pcc-${slug}`,
				source,
				type: 'Individual',
				programs: [],
				names: [{ full, isPrimary: true }],
				role: cleanText($tr.find('td.views-field-field-cargo').text()) || null,
				org: cleanText($tr.find('td.views-field-field-entidad').text()) || null,
				url: href ? new URL(href, BASE).href : null,
			})
		})

		if (added === 0) break
	}

	return entities
}

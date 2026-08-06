// Community-reported list. Unlike the other sources this one doesn't scrape a
// website: it reads GitHub issues from the repo itself. The /report form opens
// one issue per submission (labels: reporte-comunidad + pendiente) with a
// machine-readable ```json block; a maintainer verifies the evidence and swaps
// `pendiente` for `aprobado`, and only those issues become entities here. The
// issue thread doubles as the public audit trail for why each name is listed.
import { cleanText } from '../lib/scrape.mjs'

export const id = 'community'
export const label = 'Reportes comunitarios'
export const source = 'Reporte comunitario'
// Zero approved reports is a legitimate state (e.g. right after launch), not a
// broken scraper — tells import-lists.mjs to skip its 0-entity guard.
export const allowEmpty = true

const REPO = process.env.GITHUB_REPORT_REPO || 'qvapay/ofac-sdn'
const PER_PAGE = 100
const MAX_PAGES = 30

function headers() {
	const h = {
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'ofac-sdn-community-import',
	}
	const token = process.env.GITHUB_TOKEN || process.env.GITHUB_REPORT_TOKEN
	if (token) h.authorization = `Bearer ${token}`
	return h
}

function parseReport(issue) {
	const block = issue.body?.match(/```json\s*\n([\s\S]*?)\n\s*```/)
	if (!block) return null
	try { return JSON.parse(block[1]) } catch { return null }
}

export async function fetchEntities() {
	
	const entities = []

	for (let page = 1; page <= MAX_PAGES; page++) {
		// state=all: approved issues are usually closed after triage but must
		// stay listed. Label filtering is AND — only approved reports match.
		const url = `https://api.github.com/repos/${REPO}/issues?labels=reporte-comunidad,aprobado&state=all&per_page=${PER_PAGE}&page=${page}`
		const res = await fetch(url, { headers: headers() })
		if (!res.ok) throw new Error(`community: GitHub issues fetch failed: HTTP ${res.status} ${await res.text().catch(() => '')}`)
		const issues = await res.json()

		for (const issue of issues) {
			if (issue.pull_request) continue
			const report = parseReport(issue)
			if (!report) {
				console.warn(`[lists] community: issue #${issue.number} approved but has no parseable json block — skipping`)
				continue
			}
			const full = cleanText(report.nombre)
			if (!full) continue

			const names = [{ full, isPrimary: true }]
			for (const alias of report.alias ?? []) {
				const a = cleanText(alias)
				if (a && a !== full) names.push({ full: a, isPrimary: false })
			}

			const wallets = (report.wallets ?? []).filter((w) => w?.address)
			entities.push({
				id: `community-${issue.number}`,
				source,
				type: report.tipo === 'institucion' ? 'Entity' : 'Individual',
				programs: [],
				names,
				role: cleanText(report.cargo) || null,
				org: cleanText(report.organizacion) || null,
				...(wallets.length ? { cryptoAddresses: wallets } : {}),
				url: issue.html_url,
			})
		}

		if (issues.length < PER_PAGE) break
	}

	return entities
}

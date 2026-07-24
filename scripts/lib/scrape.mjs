// Shared helpers for the HTML scrapers under scripts/sources/.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export async function fetchHtml(url, { retries = 3, timeoutMs = 60000, headers = {} } = {}) {
	let lastErr
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			const res = await fetch(url, {
				headers: { 'user-agent': UA, accept: 'text/html', ...headers },
				signal: AbortSignal.timeout(timeoutMs),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
			return await res.text()
		} catch (err) {
			lastErr = err
			if (attempt < retries) await new Promise((r) => setTimeout(r, attempt * 2000))
		}
	}
	throw new Error(`Failed to fetch ${url}: ${lastErr.message}`)
}

export function cleanText(text) {
	return (text ?? '').replace(/\s+/g, ' ').trim()
}

// "/miguel-diaz-canel-bermudez?foo#bar" -> "miguel-diaz-canel-bermudez"
export function slugFromHref(href) {
	if (!href) return null
	const path = href.split(/[?#]/)[0]
	return path.split('/').filter(Boolean).pop() ?? null
}

export function slugify(text) {
	return cleanText(text)
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
}

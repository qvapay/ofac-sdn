import { NextResponse } from 'next/server'
import { searchName } from '../../lib/search.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Allow enough time for the very first cold-start (JSON download + index build).
export const maxDuration = 60

export async function GET(request) {
	const { searchParams } = new URL(request.url)
	const name = searchParams.get('name')
	if (!name || !name.trim()) { return NextResponse.json({ error: 'Query param "name" is required' }, { status: 400 }) }

	const limit = clampInt(searchParams.get('limit'), 10, 1, 50)
	const minScore = clampInt(searchParams.get('minScore'), 70, 0, 100)

	try {
		const started = Date.now()
		const result = await searchName(name, { limit, minScore })
		return NextResponse.json({
			...result,
			tookMs: Date.now() - started,
		})
	} catch (err) {
		console.error('[ofac] search failed:', err)
		return NextResponse.json({ error: 'Search failed', detail: err.message }, { status: 500 })
	}
}

function clampInt(raw, fallback, min, max) {
	if (raw == null) return fallback
	const n = Number.parseInt(raw, 10)
	if (Number.isNaN(n)) return fallback
	return Math.max(min, Math.min(max, n))
}

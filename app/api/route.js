import { NextResponse } from 'next/server'
import { searchName, searchAddress, UnknownListError } from '../../lib/search.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Allow enough time for the very first cold-start (JSON download + index build).
export const maxDuration = 60

export async function GET(request) {
	const { searchParams } = new URL(request.url)
	const name = searchParams.get('name')
	const address = searchParams.get('address')
	if ((!name || !name.trim()) && (!address || !address.trim())) {
		return NextResponse.json({ error: 'Query param "name" or "address" is required' }, { status: 400 })
	}

	const limit = clampInt(searchParams.get('limit'), 10, 1, 50)
	const minScore = clampInt(searchParams.get('minScore'), 70, 0, 100)
	const listsParam = searchParams.get('lists')
	const lists = listsParam ? listsParam.split(',') : null

	try {
		const started = Date.now()
		const result = address?.trim()
			? await searchAddress(address, { lists })
			: await searchName(name, { limit, minScore, lists })
		return NextResponse.json({
			...result,
			tookMs: Date.now() - started,
		})
	} catch (err) {
		if (err instanceof UnknownListError) {
			return NextResponse.json({ error: err.message }, { status: 400 })
		}
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

import { NextResponse } from 'next/server'

// Community report intake. Validates the submission and opens a public GitHub
// issue (label "pendiente") on the repo — GitHub is the moderation queue.
// Approving = swapping the label to "aprobado"; scripts/sources/community.mjs
// then picks it up on the next list import. The reporter stays anonymous: the
// issue is created server-side with GITHUB_REPORT_TOKEN.

const REPO = process.env.GITHUB_REPORT_REPO || 'qvapay/ofac-sdn'
const MAX_PER_HOUR = 3
const WINDOW_MS = 60 * 60 * 1000

// Per-instance rate limit. Fluid Compute reuses instances, so this holds up
// against casual abuse; it is not a hard global guarantee.
const submissions = new Map() // ip -> [timestamps]

function rateLimited(ip) {
	const now = Date.now()
	const recent = (submissions.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
	if (recent.length >= MAX_PER_HOUR) {
		submissions.set(ip, recent)
		return true
	}
	recent.push(now)
	submissions.set(ip, recent)
	if (submissions.size > 10_000) submissions.clear() // memory backstop
	return false
}

function clean(value, max) {
	return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function splitList(value, maxItems, maxLen) {
	return String(value ?? '')
		.split(/[\n,;]+/)
		.map((s) => clean(s, maxLen))
		.filter(Boolean)
		.slice(0, maxItems)
}

// Accepts "BTC 1A2b…", "ETH: 0xabc…" or a bare address per line.
function parseWallets(value) {
	const wallets = []
	for (const line of String(value ?? '').split('\n').slice(0, 20)) {
		const text = clean(line, 200)
		if (!text) continue
		const m = text.match(/^([A-Za-z0-9]{2,6})[:\s]+(\S+)$/)
		const currency = m ? m[1].toUpperCase() : 'CRYPTO'
		const address = (m ? m[2] : text).trim()
		if (!/^[a-zA-Z0-9]{20,100}$/.test(address)) return { error: `Dirección inválida: "${address.slice(0, 40)}"` }
		wallets.push({ currency, address })
	}
	return { wallets }
}

// Neutralize @mentions (zero-width space after "@") so an issue body can't
// ping arbitrary GitHub users.
function noMentions(text) {
	return text.replace(/@/g, '@\u200b')
}

export async function POST(request) {
	const token = process.env.GITHUB_REPORT_TOKEN
	if (!token) return NextResponse.json({ error: 'Report intake not configured (GITHUB_REPORT_TOKEN)' }, { status: 500 })

	let body
	try {
		body = await request.json()
	} catch {
		return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
	}

	// Honeypot: bots fill every field. Pretend success so they don't adapt.
	if (body.website) return NextResponse.json({ ok: true })

	const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
	if (rateLimited(ip)) {
		return NextResponse.json({ error: 'Demasiados reportes desde esta conexión. Intenta de nuevo en una hora.' }, { status: 429 })
	}

	const tipo = body.tipo === 'institucion' ? 'institucion' : 'persona'
	const nombre = clean(body.nombre, 200)
	if (nombre.length < 3) return NextResponse.json({ error: 'El nombre es obligatorio (mínimo 3 caracteres).' }, { status: 400 })

	const alias = splitList(body.alias, 10, 200)
	const cargo = clean(body.cargo, 200)
	const organizacion = clean(body.organizacion, 200)
	const detalles = String(body.detalles ?? '').trim().slice(0, 3000)

	const { wallets, error: walletError } = parseWallets(body.wallets)
	if (walletError) return NextResponse.json({ error: walletError }, { status: 400 })

	const evidenciaRaw = String(body.evidencia ?? '').trim().slice(0, 3000)
	const evidencia = evidenciaRaw.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []
	if (evidencia.length === 0) {
		return NextResponse.json({ error: 'Incluye al menos un enlace (http…) como evidencia: prensa, redes, documentos.' }, { status: 400 })
	}

	const report = { schema: 1, tipo, nombre, alias, cargo, organizacion, wallets, evidencia, detalles }

	const lines = [
		`**Tipo:** ${tipo === 'persona' ? 'Persona' : 'Institución'}`,
		`**Nombre:** ${noMentions(nombre)}`,
		alias.length ? `**Alias:** ${noMentions(alias.join(', '))}` : null,
		cargo ? `**Cargo:** ${noMentions(cargo)}` : null,
		organizacion ? `**Organización:** ${noMentions(organizacion)}` : null,
		wallets.length ? `**Wallets:**\n${wallets.map((w) => `- \`${w.currency}\` \`${w.address}\``).join('\n')}` : null,
		`**Evidencia:**\n${evidencia.map((u) => `- ${u}`).join('\n')}`,
		detalles ? `**Detalles:**\n\n${noMentions(detalles)}` : null,
		'',
		'---',
		'Reporte enviado desde el formulario público `/report`. Para incluirlo en la lista `community`, verificar la evidencia y cambiar la etiqueta `pendiente` por `aprobado`.',
		'',
		'<!-- ofac-sdn:community-report -->',
		'```json',
		JSON.stringify(report, null, 2),
		'```',
	].filter((l) => l !== null)

	const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'x-github-api-version': '2022-11-28',
			'user-agent': 'ofac-sdn-report-form',
		},
		body: JSON.stringify({
			title: `[Reporte] ${nombre}${cargo ? ` — ${cargo}` : ''}`,
			body: lines.join('\n'),
			labels: ['reporte-comunidad', 'pendiente'],
		}),
	})

	if (!res.ok) {
		const detail = await res.text().catch(() => '')
		console.error(`[report] GitHub issue creation failed: ${res.status} ${detail.slice(0, 500)}`)
		return NextResponse.json({ error: 'No se pudo registrar el reporte. Intenta más tarde.' }, { status: 502 })
	}

	const issue = await res.json()
	return NextResponse.json({ ok: true, issue: issue.html_url, number: issue.number }, { status: 201 })
}

'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import pkg from '../package.json'

function Screener({ param, label, mode, placeholder, hint, examples }) {
	const [value, setValue] = useState('')
	const [state, setState] = useState({ status: 'idle' })

	async function run(query) {
		const q = query.trim()
		if (!q) return
		setState({ status: 'loading' })
		try {
			const res = await fetch(`/api?${param}=${encodeURIComponent(q)}`)
			if (!res.ok) {
				// The API sends JSON errors ({ error }), but infra errors (proxy
				// timeouts, platform 5xx pages) may not be JSON — fall back to status.
				const message = await res.json().then((d) => d.error).catch(() => null)
				throw new Error(message ?? `HTTP ${res.status}`)
			}
			const data = await res.json()
			setState({ status: 'done', data })
		} catch (err) { setState({ status: 'error', message: err.message }) }
	}

	function tryExample(example) {
		setValue(example)
		run(example)
	}

	const loading = state.status === 'loading'

	return (
		<form
			className="example"
			onSubmit={(e) => {
				e.preventDefault()
				run(value)
			}}
		>
			<div className="example-head">
				<span className="example-label">{label}</span>
				<span className="mode">{mode}</span>
			</div>
			<div className="row">
				<span className="get">/api?{param}=</span>
				<input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={placeholder}
					aria-label={label}
					spellCheck={false}
					autoComplete="off"
				/>
				<button type="submit" disabled={loading || !value.trim()}>
					{loading ? <span className="spinner" aria-label="Screening…" /> : 'Screen'}
				</button>
			</div>
			<div className="tryrow">
				<span className="tryword">Try:</span>
				{examples.map((ex) => (
					<button type="button" className="chip" key={ex.value} onClick={() => tryExample(ex.value)}>
						{ex.label ?? ex.value}
					</button>
				))}
			</div>
			{state.status === 'idle' && <p className="hint">{hint}</p>}
			{state.status === 'error' && <div className="result error">Could not screen: {state.message}</div>}
			{state.status === 'done' && (
				state.data.total === 0 ? (
					<div className="result clear">
						<strong>No match.</strong> Not on any screened list <span className="took">{state.data.tookMs} ms</span>
					</div>
				) : (
					<div className="result match">
						<div className="match-head">
							<strong>{state.data.total} match{state.data.total > 1 ? 'es' : ''}</strong> found
							<span className="took">{state.data.tookMs} ms</span>
						</div>
						{state.data.results.slice(0, 5).map((r) => (
							<div className="entity" key={r.currency ? `${r.entity.id}-${r.currency}` : r.entity.id}>
								<div className="entity-name">
									<span className="entity-text">{r.matchedName?.full ?? r.matchedAddress}</span>
									<span className="score" title="Match score">{r.score}</span>
								</div>
								<div className="entity-meta">
									{r.entity.source ?? 'OFAC'} · {r.entity.type}
									{r.currency ? ` · ${r.currency}` : ''}
									{r.entity.programs?.length ? ` · ${r.entity.programs.join(', ')}` : ''}
									{r.entity.role ? ` · ${r.entity.role}` : ''}
								</div>
							</div>
						))}
						{state.data.total > 5 && <div className="more">+{state.data.total - 5} more matches not shown</div>}
					</div>
				)
			)}
		</form>
	)
}

export default function Home() {

	return (
		<>
			<style>{`
                * { box-sizing: border-box; }
                html, body { margin: 0; padding: 0; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
                    color: #0f172a;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    line-height: 1.5;
                    -webkit-font-smoothing: antialiased;
                }
                main {
                    max-width: 580px;
                    width: 100%;
                    background: #fff;
                    border: 1px solid #e2e8f0;
                    border-radius: 16px;
                    padding: 40px 36px 28px;
                    box-shadow: 0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -12px rgba(15,23,42,0.12);
                }
                .top { text-align: center; }
                .logo { width: 72px; height: 72px; object-fit: contain; margin: 0 auto 18px; display: block; }
                h1 { font-size: 22px; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em; }
                p.lead { color: #475569; margin: 0 0 14px; font-size: 15px; }
                .sources { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; margin: 0 0 28px; }
                .source-chip {
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.03em;
                    color: #475569;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 999px;
                    padding: 3px 11px;
                }
                .example { margin: 0 0 26px; text-align: left; }
                .example:last-of-type { margin-bottom: 4px; }
                .example-head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 2px 8px; }
                .example-label { font-size: 14px; font-weight: 600; color: #0f172a; }
                .mode {
                    font-size: 10px;
                    font-weight: 700;
                    letter-spacing: 0.08em;
                    color: #475569;
                    background: #f1f5f9;
                    border: 1px solid #e2e8f0;
                    border-radius: 5px;
                    padding: 2px 7px;
                }
                .row {
                    display: flex;
                    align-items: stretch;
                    background: #0f172a;
                    border: 1px solid #0f172a;
                    border-radius: 10px;
                    overflow: hidden;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 13.5px;
                    transition: box-shadow .15s, border-color .15s;
                }
                .row:focus-within {
                    border-color: #2563eb;
                    box-shadow: 0 0 0 3px rgba(37,99,235,0.25);
                }
                .get { color: #7dd3fc; padding: 12px 2px 12px 14px; white-space: nowrap; user-select: none; }
                .row input {
                    flex: 1;
                    min-width: 0;
                    background: transparent;
                    border: 0;
                    outline: 0;
                    color: #f8fafc;
                    font: inherit;
                    padding: 12px 8px 12px 2px;
                    caret-color: #7dd3fc;
                }
                .row input::placeholder { color: #94a3b8; opacity: 1; }
                .row button {
                    border: 0;
                    background: #2563eb;
                    color: #fff;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    font-size: 13px;
                    font-weight: 600;
                    padding: 0 18px;
                    margin: 6px;
                    border-radius: 7px;
                    cursor: pointer;
                    min-width: 74px;
                    transition: background .15s;
                }
                .row button:hover:not(:disabled) { background: #1d4ed8; }
                .row button:disabled { background: #334155; color: #94a3b8; cursor: default; }
                .spinner {
                    display: inline-block;
                    width: 14px;
                    height: 14px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: #fff;
                    border-radius: 999px;
                    animation: spin .7s linear infinite;
                    vertical-align: -2px;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                .tryrow { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 8px 2px 0; }
                .tryword { font-size: 12px; color: #64748b; }
                .chip {
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 12px;
                    color: #1d4ed8;
                    background: #eff6ff;
                    border: 1px solid #bfdbfe;
                    border-radius: 999px;
                    padding: 3px 10px;
                    cursor: pointer;
                    max-width: 100%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    transition: background .15s, border-color .15s;
                }
                .chip:hover { background: #dbeafe; border-color: #93c5fd; }
                .hint { font-size: 13px; color: #64748b; margin: 8px 2px 0; }
                .result { margin-top: 10px; border-radius: 10px; font-size: 13.5px; padding: 12px 14px; }
                .took { float: right; font-size: 12px; opacity: 0.7; font-variant-numeric: tabular-nums; }
                .result.clear { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
                .result.error { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
                .result.match { background: #fef2f2; border: 1px solid #fca5a5; color: #7f1d1d; }
                .match-head { padding-bottom: 8px; }
                .entity { padding: 9px 0; border-top: 1px solid #fecaca; }
                .entity-name { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
                .entity-text { font-weight: 600; color: #991b1b; word-break: break-all; }
                .score {
                    flex-shrink: 0;
                    font-size: 11px;
                    font-weight: 700;
                    font-variant-numeric: tabular-nums;
                    background: #dc2626;
                    color: #fff;
                    border-radius: 999px;
                    padding: 2px 9px;
                }
                .entity-meta { font-size: 12.5px; color: #b91c1c; margin-top: 2px; }
                .more { font-size: 12.5px; margin-top: 8px; color: #b91c1c; font-style: italic; }
                footer {
                    margin-top: 26px;
                    padding-top: 18px;
                    border-top: 1px solid #f1f5f9;
                    font-size: 13px;
                    color: #64748b;
                    text-align: center;
                }
                .footer-source {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    font-size: 12.5px;
                    margin-bottom: 10px;
                }
                .footer-source img { opacity: 0.85; }
                .version {
                    display: inline-block;
                    margin-left: 8px;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                    font-size: 11px;
                    color: #94a3b8;
                }
                a { color: #0f172a; text-decoration: none; border-bottom: 1px solid #cbd5e1; transition: border-color .15s; }
                a:hover { border-color: #0f172a; }
                @media (max-width: 480px) {
                    main { padding: 32px 20px 24px; }
                    .get { display: none; }
                    .row input { padding-left: 14px; }
                }
            `}</style>
			<main>
				<div className="top">
					<Image className="logo" src="/qvapay-logo.png" alt="QvaPay" width={72} height={72} />
					<h1>OFAC SDN Screening API</h1>
					<p className="lead">Screen names and crypto wallets against sanctions and government watchlists — try it live:</p>
					<div className="sources" aria-label="Data sources screened">
						<span className="source-chip">OFAC SDN</span>
						<span className="source-chip">PCC Directorio</span>
						<span className="source-chip">ANPP Diputados</span>
						<span className="source-chip">FHRC Represores</span>
						<span className="source-chip">Reportes comunidad</span>
					</div>
				</div>
				<Screener
					param="name"
					label="Screen a name"
					mode="FUZZY"
					placeholder="e.g. lazarus group"
					hint="Tolerates typos, word order, accents and transliterations."
					examples={[{ value: 'lazaruz grupo' }, { value: 'bank markazi iran' }]}
				/>
				<Screener
					param="address"
					label="Screen a crypto wallet"
					mode="EXACT"
					placeholder="paste a BTC / ETH / TRX / USDT address"
					hint="Exact match, case-insensitive. Covers 940 sanctioned addresses in 15+ currencies."
					examples={[
						{ value: 'TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81', label: 'TNiq9A… (TRX)' },
						{ value: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96', label: '0x098B… (ETH)' },
					]}
				/>
				<footer>
					<div className="footer-source">
						<Image src="/ofac-logo.png" alt="" width={18} height={18} />
						<span>
							Primary data source:{' '}
							<a href="https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists" rel="noopener">
								OFAC SDN list
							</a>{' '}
							· U.S. Department of the Treasury
						</span>
					</div>
					Built by <a href="https://x.com/erichgarciacruz" rel="noopener">Erich Garcia</a> for{' '}
					<a href="https://www.qvapay.com" rel="noopener">QvaPay</a> ·{' '}
					<a href="https://github.com/qvapay/ofac-sdn" rel="noopener">GitHub</a> ·{' '}
					<Link href="/report">Reportar</Link>
					<span className="version">v{pkg.version}</span>
				</footer>
			</main>
		</>
	)
}

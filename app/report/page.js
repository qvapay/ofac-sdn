'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

const INITIAL = {
	tipo: 'persona',
	nombre: '',
	alias: '',
	cargo: '',
	organizacion: '',
	wallets: '',
	evidencia: '',
	detalles: '',
	website: '', // honeypot — humans never see it
}

export default function ReportPage() {
	const [form, setForm] = useState(INITIAL)
	const [state, setState] = useState({ status: 'idle' })

	const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
	const loading = state.status === 'loading'

	async function submit(e) {
		e.preventDefault()
		if (form.nombre.trim().length < 3) {
			setState({ status: 'error', message: 'El nombre es obligatorio (mínimo 3 caracteres).' })
			return
		}
		if (!/https?:\/\//.test(form.evidencia)) {
			setState({ status: 'error', message: 'Incluye al menos un enlace (http…) como evidencia.' })
			return
		}
		setState({ status: 'loading' })
		try {
			const res = await fetch('/api/report', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(form),
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
			setState({ status: 'done', issue: data.issue, number: data.number })
			setForm(INITIAL)
		} catch (err) {
			setState({ status: 'error', message: err.message })
		}
	}

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
                .logo { width: 56px; height: 56px; object-fit: contain; margin: 0 auto 16px; display: block; }
                h1 { font-size: 21px; margin: 0 0 8px; font-weight: 700; letter-spacing: -0.02em; }
                p.lead { color: #475569; margin: 0 0 22px; font-size: 14.5px; text-align: left; }
                .field { margin-bottom: 16px; text-align: left; }
                .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
                .field .opt { font-weight: 400; color: #94a3b8; }
                .field input, .field select, .field textarea {
                    width: 100%;
                    font: inherit;
                    font-size: 14px;
                    color: #0f172a;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    border-radius: 9px;
                    padding: 10px 12px;
                    outline: none;
                    transition: border-color .15s, box-shadow .15s;
                }
                .field textarea { resize: vertical; min-height: 74px; }
                .field input:focus, .field select:focus, .field textarea:focus {
                    border-color: #2563eb;
                    box-shadow: 0 0 0 3px rgba(37,99,235,0.18);
                    background: #fff;
                }
                .field .help { font-size: 12px; color: #64748b; margin-top: 4px; }
                .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px !important; }
                .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .honeypot { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
                .submit {
                    width: 100%;
                    border: 0;
                    background: #2563eb;
                    color: #fff;
                    font: inherit;
                    font-size: 14.5px;
                    font-weight: 600;
                    padding: 12px;
                    border-radius: 9px;
                    cursor: pointer;
                    margin-top: 4px;
                    transition: background .15s;
                }
                .submit:hover:not(:disabled) { background: #1d4ed8; }
                .submit:disabled { background: #94a3b8; cursor: default; }
                .notice {
                    font-size: 12.5px;
                    color: #64748b;
                    background: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 9px;
                    padding: 10px 12px;
                    margin: 14px 0 0;
                }
                .result { margin-top: 14px; border-radius: 10px; font-size: 13.5px; padding: 12px 14px; }
                .result.ok { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
                .result.error { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
                .result a { color: inherit; font-weight: 600; }
                footer {
                    margin-top: 24px;
                    padding-top: 16px;
                    border-top: 1px solid #f1f5f9;
                    font-size: 13px;
                    color: #64748b;
                    text-align: center;
                }
                a { color: #0f172a; text-decoration: none; border-bottom: 1px solid #cbd5e1; transition: border-color .15s; }
                a:hover { border-color: #0f172a; }
                @media (max-width: 480px) {
                    main { padding: 32px 20px 24px; }
                    .grid2 { grid-template-columns: 1fr; }
                }
            `}</style>
			<main>
				<div className="top">
					<Image className="logo" src="/qvapay-logo.png" alt="QvaPay" width={56} height={56} />
					<h1>Reportar a la lista comunitaria</h1>
				</div>
				<p className="lead">
					Reporta militantes del PCC, agentes de la dictadura, instituciones represivas o wallets vinculadas al
					régimen cubano. Cada reporte se publica como issue en GitHub, se verifica manualmente y, solo si la
					evidencia lo respalda, entra a la lista <code>community</code> del screening.
				</p>
				<form onSubmit={submit}>
					<div className="grid2">
						<div className="field">
							<label htmlFor="tipo">Tipo</label>
							<select id="tipo" value={form.tipo} onChange={set('tipo')}>
								<option value="persona">Persona</option>
								<option value="institucion">Institución</option>
							</select>
						</div>
						<div className="field">
							<label htmlFor="cargo">Cargo o rol <span className="opt">(opcional)</span></label>
							<input id="cargo" value={form.cargo} onChange={set('cargo')} placeholder="ej. Primer secretario del PCC en…" maxLength={200} />
						</div>
					</div>
					<div className="field">
						<label htmlFor="nombre">Nombre completo</label>
						<input id="nombre" value={form.nombre} onChange={set('nombre')} placeholder="Nombre y apellidos, o nombre de la institución" maxLength={200} required />
					</div>
					<div className="field">
						<label htmlFor="alias">Alias <span className="opt">(opcional)</span></label>
						<input id="alias" value={form.alias} onChange={set('alias')} placeholder="Otros nombres o apodos, separados por coma" maxLength={500} />
					</div>
					<div className="field">
						<label htmlFor="organizacion">Organización o institución <span className="opt">(opcional)</span></label>
						<input id="organizacion" value={form.organizacion} onChange={set('organizacion')} placeholder="ej. MININT, PCC, FAR…" maxLength={200} />
					</div>
					<div className="field">
						<label htmlFor="wallets">Wallets cripto <span className="opt">(opcional)</span></label>
						<textarea id="wallets" className="mono" value={form.wallets} onChange={set('wallets')} placeholder={'Una por línea, con moneda si la conoces:\nBTC 1A2b3C…\nTRX TNiq9A…'} rows={3} />
					</div>
					<div className="field">
						<label htmlFor="evidencia">Evidencia</label>
						<textarea id="evidencia" value={form.evidencia} onChange={set('evidencia')} placeholder={'Al menos un enlace: prensa, redes sociales, documentos…\nhttps://…'} rows={3} required />
						<div className="help">Sin evidencia verificable el reporte será rechazado.</div>
					</div>
					<div className="field">
						<label htmlFor="detalles">Detalles adicionales <span className="opt">(opcional)</span></label>
						<textarea id="detalles" value={form.detalles} onChange={set('detalles')} placeholder="Contexto: hechos, fechas, lugares…" rows={3} maxLength={3000} />
					</div>
					<div className="honeypot" aria-hidden="true">
						<label htmlFor="website">Website</label>
						<input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
					</div>
					<button className="submit" type="submit" disabled={loading}>
						{loading ? 'Enviando…' : 'Enviar reporte'}
					</button>
				</form>
				{state.status === 'done' && (
					<div className="result ok">
						<strong>Reporte enviado.</strong> Quedó registrado públicamente como{' '}
						<a href={state.issue} rel="noopener">issue #{state.number}</a> y está pendiente de verificación manual.
					</div>
				)}
				{state.status === 'error' && <div className="result error">{state.message}</div>}
				<p className="notice">
					El reporte es <strong>anónimo</strong> (no se publica ningún dato tuyo) pero su contenido es{' '}
					<strong>público</strong>: se abre como issue en el repositorio{' '}
					<a href="https://github.com/qvapay/ofac-sdn/issues" rel="noopener">qvapay/ofac-sdn</a>. No incluyas
					información que te identifique ni datos privados de terceros (direcciones de casa, teléfonos, menores).
				</p>
				<footer>
					<Link href="/">← Volver al screening</Link>
				</footer>
			</main>
		</>
	)
}

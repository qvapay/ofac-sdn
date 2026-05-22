export default function Home() {
    return (
        <>
            <style>{`
                * { box-sizing: border-box; }
                html, body { margin: 0; padding: 0; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background: #fafafa;
                    color: #18181b;
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    line-height: 1.5;
                    -webkit-font-smoothing: antialiased;
                }
                main {
                    max-width: 480px;
                    width: 100%;
                    background: #fff;
                    border: 1px solid #e4e4e7;
                    border-radius: 14px;
                    padding: 40px 32px 28px;
                    text-align: center;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
                }
                .logo { width: 72px; height: 72px; object-fit: contain; margin: 0 auto 20px; display: block; }
                .badge {
                    display: inline-block;
                    font-size: 11px;
                    font-weight: 600;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                    color: #52525b;
                    background: #f4f4f5;
                    border: 1px solid #e4e4e7;
                    padding: 4px 10px;
                    border-radius: 999px;
                    margin-bottom: 18px;
                }
                h1 { font-size: 20px; margin: 0 0 10px; font-weight: 600; letter-spacing: -0.01em; }
                p.lead { color: #52525b; margin: 0 0 22px; }
                pre {
                    background: #0a0a0a;
                    color: #fafafa;
                    padding: 12px 14px;
                    border-radius: 8px;
                    font-size: 13px;
                    text-align: left;
                    overflow-x: auto;
                    margin: 0;
                    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                }
                footer {
                    margin-top: 28px;
                    padding-top: 18px;
                    border-top: 1px solid #f4f4f5;
                    font-size: 13px;
                    color: #71717a;
                }
                a { color: #18181b; text-decoration: none; border-bottom: 1px solid #d4d4d8; transition: border-color .15s; }
                a:hover { border-color: #18181b; }
            `}</style>
            <main>
                <img className="logo" src="/ofac-logo.png" alt="OFAC" />
                <span className="badge">API only</span>
                <h1>OFAC SDN Screening API</h1>
                <p className="lead">This service has no web interface. Query it directly:</p>
                <pre>GET /api?name={'<name>'}&amp;minScore=85</pre>
                <footer>
                    Built by <a href="https://github.com/n3omaster" rel="noopener">Erich Garcia</a> for{' '}
                    <a href="https://www.qvapay.com" rel="noopener">QvaPay</a>
                </footer>
            </main>
        </>
    )
}

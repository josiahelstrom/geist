import {useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {connect, normalizeBase, type Site} from "../lib/api";
import {upsertSite, removeSite} from "../lib/sites";
import {versionBanner} from "../lib/version";

type Props = {
	sites: Site[];
	onReady: (site: Site, sites: Site[]) => void;
	onSitesChanged: (sites: Site[]) => void;
};

export default function Connect({sites, onReady, onSitesChanged}: Props) {
	const [url, setUrl] = useState("");
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);

		if (!key.trim()) {
			setError("Paste a Staff Access Token or an Admin API key.");
			return;
		}

		setBusy(true);
		try {
			const site = await connect(url, key.trim());
			// Don't keep the key in component state any longer than necessary.
			setKey("");
			onReady(site, upsertSite(site));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	function handleUse(existing: Site) {
		onReady(existing, sites);
	}

	function handleForget(base: string) {
		void invoke("delete_key", {base}).catch(() => {});
		onSitesChanged(removeSite(base));
	}

	return (
		<div className="connect">
			<form onSubmit={handleSubmit} className="connect-card">
				<h1>Geist — Connect to a site</h1>
				<p className="muted">
					Paste your site address and a Staff Access Token. The key stays in
					your macOS Keychain; only short-lived 5-minute tokens ever reach the
					webview.
				</p>

				<label>
					Site
					<input
						value={url}
						onChange={e => setUrl(e.target.value)}
						placeholder="https://your-site.com"
						autoComplete="url"
						spellCheck={false}
					/>
				</label>

				<label>
					Admin API key
					<textarea
						value={key}
						onChange={e => setKey(e.target.value)}
						placeholder="xxxxxxxxxxxxxxxxxxxx:hexhexhexhex"
						rows={3}
						spellCheck={false}
					/>
				</label>

				<button type="submit" className="primary-button" disabled={busy}>
					{busy ? "Connecting…" : "Connect"}
				</button>

				{url && (
					<p className="hint">Will try {normalizeBase(url)}/ghost/api/admin/</p>
				)}

				{error && (
					<p className="error" role="alert" data-testid="connect-error">
						{error}
					</p>
				)}
			</form>

			{sites.length > 0 && (
				<div className="connect-card">
					<h2>Saved sites</h2>
					<ul className="site-list" data-testid="site-list">
						{sites.map(s => (
							<li key={s.base}>
								<button
									type="button"
									className="site-open"
									onClick={() => handleUse(s)}
								>
									<strong>{s.title}</strong>
									<span className="muted">
										{s.base} · Ghost {s.version} · {s.keyKind}
										{s.role ? ` · ${s.role}` : ""}
									</span>
									{versionBanner(s.version) && (
										<span className="warn">{versionBanner(s.version)}</span>
									)}
								</button>
								<button
									type="button"
									className="site-forget"
									onClick={() => handleForget(s.base)}
									title="Forget this site and remove its Keychain key"
								>
									Forget
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

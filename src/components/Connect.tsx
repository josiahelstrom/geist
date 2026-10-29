import {useEffect, useRef, useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {
	connect,
	fetchSite,
	loginWithPassword,
	normalizeBase,
	resend2faCode,
	verify2faCode,
	type LoginResult,
	type Site,
} from "../lib/api";
import {upsertSite, removeSite} from "../lib/sites";
import {versionBanner} from "../lib/version";

type Props = {
	sites: Site[];
	onReady: (site: Site, sites: Site[]) => void;
	onSitesChanged: (sites: Site[]) => void;
};

type Mode = "password" | "token";

type PendingChallenge = {
	pendingId: string;
	email: string;
	message: string;
};

const RESEND_COOLDOWN_SECONDS = 30;

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export default function Connect({sites, onReady, onSitesChanged}: Props) {
	const [mode, setMode] = useState<Mode>("password");
	const [url, setUrl] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
	const [code, setCode] = useState("");
	const [verifying, setVerifying] = useState(false);
	const [resending, setResending] = useState(false);
	const [resendIn, setResendIn] = useState(0);
	const [resendNote, setResendNote] = useState<string | null>(null);
	const codeInputRef = useRef<HTMLInputElement | null>(null);

	// Count the resend cooldown down one second at a time.
	useEffect(() => {
		if (resendIn <= 0) {
			return;
		}
		const timer = window.setTimeout(() => {
			setResendIn(value => Math.max(0, value - 1));
		}, 1000);
		return () => window.clearTimeout(timer);
	}, [resendIn]);

	// Never keep a typed password in memory once the screen goes away.
	useEffect(() => () => setPassword(""), []);

	// Move focus straight into the code field when the 2FA step appears.
	useEffect(() => {
		if (challenge) {
			codeInputRef.current?.focus();
		}
	}, [challenge]);

	function switchMode(next: Mode) {
		if (busy || verifying) {
			return;
		}
		setMode(next);
		setError(null);
		setResendNote(null);
		setChallenge(null);
		setCode("");
		setPassword("");
		setShowPassword(false);
	}

	function resetChallenge() {
		setChallenge(null);
		setCode("");
		setError(null);
		setResendIn(0);
		setResendNote(null);
	}

	async function finishLogin() {
		const site = await fetchSite({url, keyKind: "staff"});
		onReady(site, upsertSite(site));
	}

	async function handlePasswordSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setResendNote(null);

		if (!url.trim()) {
			setError("Enter your Ghost site URL.");
			return;
		}
		if (!email.trim()) {
			setError("Enter the email address for your Ghost account.");
			return;
		}
		if (!password) {
			setError("Enter your Ghost password.");
			return;
		}

		setBusy(true);
		try {
			const result: LoginResult = await loginWithPassword(
				url,
				email.trim(),
				password,
			);
			// Never keep a password around after the request completes.
			setPassword("");
			setShowPassword(false);

			if (result.status === "Needs2FA") {
				setChallenge({
					pendingId: result.pending_id,
					email: result.email,
					message: result.message,
				});
				setCode("");
				setResendIn(0);
				setResendNote(null);
				return;
			}

			await finishLogin();
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	async function handleVerify(e: React.FormEvent) {
		e.preventDefault();
		if (!challenge) {
			return;
		}
		setError(null);

		if (code.length !== 6) {
			setError("Enter the 6-digit code from your email.");
			return;
		}

		setVerifying(true);
		try {
			const result = await verify2faCode(challenge.pendingId, code);
			if (result.status === "Needs2FA") {
				setChallenge({
					pendingId: result.pending_id,
					email: result.email,
					message: result.message,
				});
				setCode("");
				return;
			}
			setChallenge(null);
			await finishLogin();
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setVerifying(false);
		}
	}

	async function handleResend() {
		if (!challenge || resending || resendIn > 0) {
			return;
		}
		setResending(true);
		setError(null);
		setResendNote(null);
		try {
			await resend2faCode(challenge.pendingId);
			setResendIn(RESEND_COOLDOWN_SECONDS);
			setResendNote("Code resent!");
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setResending(false);
		}
	}

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
			setError(errorMessage(err));
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

	const disabled = busy || verifying;

	return (
		<div className="connect connect-screen">
			<div className="titlebar-drag-region" aria-hidden="true" />

			<div className="connect-shell">
				<header className="connect-brand">
					<h1>Geist</h1>
					<p className="connect-tagline">Connect to your Ghost publication</p>
				</header>

				<div className="connect-card connect-auth-card">
					{challenge ? (
						<form onSubmit={handleVerify} className="connect-form">
							<div className="connect-step-heading">
								<h2>Enter Verification Code</h2>
								<p className="connect-subtitle">{challenge.message}</p>
							</div>

							<p className="connect-email">
								Code sent to <strong>{challenge.email}</strong>
							</p>

							<label className="connect-field">
								<span>Verification code</span>
								<input
									ref={codeInputRef}
									className="connect-code-input"
									value={code}
									onChange={e =>
										setCode(
											e.target.value
												.replace(/\D/g, "")
												.slice(0, 6),
										)
									}
									inputMode="numeric"
									autoComplete="one-time-code"
									pattern="[0-9]*"
									maxLength={6}
									placeholder="000000"
									disabled={verifying}
									data-testid="connect-2fa-code"
								/>
							</label>

							{error && (
								<div
									className="connect-error-banner"
									role="alert"
									data-testid="connect-error"
								>
									{error}
								</div>
							)}

							<button
								type="submit"
								className="connect-submit"
								disabled={verifying || code.length !== 6}
								data-testid="connect-verify-button"
							>
								{verifying ? (
									<>
										<span className="connect-spinner" aria-hidden="true" />
										Verifying…
									</>
								) : (
									"Verify & Sign In"
								)}
							</button>

							<div className="connect-resend-row">
								<button
									type="button"
									className="connect-link-button"
									onClick={handleResend}
									disabled={resending || resendIn > 0}
									data-testid="connect-resend-button"
								>
									{resending
										? "Resending…"
										: resendIn > 0
											? `Resend Code in ${resendIn}s`
											: "Resend Code"}
								</button>
								{resendNote && (
									<span className="connect-resend-note" role="status">
										{resendNote}
									</span>
								)}
							</div>

							<button
								type="button"
								className="connect-back-link"
								onClick={resetChallenge}
								data-testid="connect-back-button"
							>
								← Back to Sign In
							</button>
						</form>
					) : (
						<>
							<div
								className="connect-segmented"
								role="tablist"
								aria-label="Sign-in method"
							>
								<button
									type="button"
									role="tab"
									aria-selected={mode === "password"}
									className="connect-segment"
									onClick={() => switchMode("password")}
									disabled={disabled}
									data-testid="connect-password-tab"
								>
									Sign In with Password
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={mode === "token"}
									className="connect-segment"
									onClick={() => switchMode("token")}
									disabled={disabled}
									data-testid="connect-token-tab"
								>
									Staff Access Token
								</button>
							</div>

							{mode === "password" ? (
								<form
									onSubmit={handlePasswordSubmit}
									className="connect-form"
								>
									<p className="connect-subtitle">
										Sign in with the Ghost account you use for this
										publication. Geist retrieves a Staff Access Token and
										keeps it in your macOS Keychain.
									</p>

									<label className="connect-field">
										<span>Ghost site URL</span>
										<input
											value={url}
											onChange={e => setUrl(e.target.value)}
											placeholder="https://your-site.com"
											autoComplete="url"
											spellCheck={false}
											disabled={busy}
											data-testid="connect-url-input"
										/>
									</label>

									<label className="connect-field">
										<span>Staff email</span>
										<input
											type="email"
											value={email}
											onChange={e => setEmail(e.target.value)}
											placeholder="you@your-site.com"
											autoComplete="username"
											spellCheck={false}
											disabled={busy}
											data-testid="connect-email-input"
										/>
									</label>

									<label className="connect-field">
										<span>Password</span>
										<div className="connect-password-field">
											<input
												type={showPassword ? "text" : "password"}
												value={password}
												onChange={e => setPassword(e.target.value)}
												placeholder="Your Ghost password"
												autoComplete="current-password"
												disabled={busy}
												data-testid="connect-password-input"
											/>
											<button
												type="button"
												className="connect-reveal"
												onClick={() => setShowPassword(v => !v)}
												aria-label={
													showPassword
														? "Hide password"
														: "Show password"
												}
												disabled={busy}
											>
												{showPassword ? "Hide" : "Show"}
											</button>
										</div>
									</label>

									{error && (
										<div
											className="connect-error-banner"
											role="alert"
											data-testid="connect-error"
										>
											{error}
										</div>
									)}

									<button
										type="submit"
										className="connect-submit"
										disabled={busy}
										data-testid="connect-password-submit"
									>
										{busy ? (
											<>
												<span
													className="connect-spinner"
													aria-hidden="true"
												/>
												Signing in…
											</>
										) : (
											"Sign In to Publication"
										)}
									</button>
								</form>
							) : (
								<form onSubmit={handleSubmit} className="connect-form">
									<p className="connect-subtitle">
										Paste a Staff Access Token or an Admin API key. Use this
										fallback for custom integration tokens.
									</p>

									<label className="connect-field">
										<span>Ghost site URL</span>
										<input
											value={url}
											onChange={e => setUrl(e.target.value)}
											placeholder="https://your-site.com"
											autoComplete="url"
											spellCheck={false}
											disabled={busy}
											data-testid="connect-url-input"
										/>
									</label>

									<label className="connect-field">
										<span>Staff Access Token</span>
										<textarea
											value={key}
											onChange={e => setKey(e.target.value)}
											placeholder="xxxxxxxxxxxxxxxxxxxx:hexhexhexhex"
											rows={3}
											spellCheck={false}
											disabled={busy}
											data-testid="connect-token-input"
										/>
									</label>

									{error && (
										<div
											className="connect-error-banner"
											role="alert"
											data-testid="connect-error"
										>
											{error}
										</div>
									)}

									<button
										type="submit"
										className="connect-submit"
										disabled={busy}
										data-testid="connect-token-submit"
									>
										{busy ? (
											<>
												<span
													className="connect-spinner"
													aria-hidden="true"
												/>
												Connecting…
											</>
										) : (
											"Connect"
										)}
									</button>

									{url && (
										<p className="connect-hint">
											Will try {normalizeBase(url)}/ghost/api/admin/
										</p>
									)}
								</form>
							)}
						</>
					)}
				</div>

				{sites.length > 0 && (
					<div className="connect-card connect-sites-card">
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
											<span className="warn">
												{versionBanner(s.version)}
											</span>
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
		</div>
	);
}

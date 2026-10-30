import {useCallback, useState} from "react";
import {
	installUpdate,
	relaunchApp,
	type UpdateInfo,
	type UpdateProgress,
} from "../lib/updater";

type Phase = "idle" | "downloading" | "error";

type UpdateBannerProps = {
	update: UpdateInfo;
	onDismiss: () => void;
};

const NOTES_LIMIT = 180;

/** Collapse release notes into one short plain-text paragraph. */
function summarizeNotes(body: string | undefined): string | null {
	if (!body) {
		return null;
	}
	const text = body.replace(/\s+/g, " ").trim();
	if (!text) {
		return null;
	}
	if (text.length <= NOTES_LIMIT) {
		return text;
	}
	const clipped = text.slice(0, NOTES_LIMIT);
	const lastSpace = clipped.lastIndexOf(" ");
	const head = lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped;
	return `${head.trimEnd()}…`;
}

export default function UpdateBanner({
	update,
	onDismiss,
}: UpdateBannerProps) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [progress, setProgress] = useState<UpdateProgress | null>(null);
	const notes = summarizeNotes(update.body);

	const handleInstall = useCallback(async () => {
		setPhase("downloading");
		setProgress(null);
		try {
			await installUpdate(setProgress);
			await relaunchApp();
		} catch (err) {
			console.debug("[updater] install failed", err);
			setPhase("error");
		}
	}, []);

	const downloading = phase === "downloading";
	const percent = progress?.percent ?? null;
	const progressLabel =
		percent === null
			? "Downloading update…"
			: `Downloading update… ${percent}%`;

	return (
		<section className="update-banner" aria-label="Application update">
			<div className="update-banner-copy">
				<p className="update-banner-title">
					Geist {update.version} is available
				</p>
				<p className="update-banner-meta">
					You're on {update.currentVersion}. Updates install and
					relaunch in place.
				</p>
				{notes ? <p className="update-banner-notes">{notes}</p> : null}
				{phase === "error" ? (
					<p className="update-banner-meta update-banner-error">
						Update failed — check your connection and try again.
					</p>
				) : null}
				{downloading ? (
					<div
						className="update-banner-progress"
						role="status"
						aria-live="polite"
					>
						<span className="update-banner-progress-label">
							{progressLabel}
						</span>
						<div
							className="update-banner-progress-track"
							aria-hidden="true"
						>
							<div
								className="update-banner-progress-bar"
								data-indeterminate={
									percent === null ? "true" : undefined
								}
								style={
									percent === null
										? undefined
										: {width: `${percent}%`}
								}
							/>
						</div>
					</div>
				) : null}
			</div>
			<div className="update-banner-actions">
				<button
					type="button"
					data-variant="primary"
					disabled={downloading}
					aria-label={
						phase === "error"
							? "Retry the Geist update and relaunch"
							: "Install the Geist update and relaunch"
					}
					onClick={() => void handleInstall()}
				>
					{phase === "error" ? "Retry" : "Install & Relaunch"}
				</button>
				<button
					type="button"
					data-variant="secondary"
					disabled={downloading}
					aria-label="Remind me about this update later"
					onClick={onDismiss}
				>
					Later
				</button>
			</div>
		</section>
	);
}

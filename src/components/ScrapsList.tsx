import {useCallback, useEffect, useMemo, useState} from "react";
import type {PostDetail, Site} from "../lib/api";
import {extractLexicalPlainText} from "../lib/revisions";
import {
	createScrap,
	deleteScrap,
	listScraps,
	promoteScrapToDraft,
	type Scrap,
} from "../lib/scraps";

type Props = {
	site: Site;
	/** Open a scrap in the local editor. */
	onOpenScrap: (scrap: Scrap) => void;
	/** Open the Ghost draft created by Promote to Draft. */
	onOpenPost: (post: PostDetail) => void;
	/** Keep the navigation rail's live Scraps badge in step. */
	onScrapCountChange?: (count: number) => void;
};

const iconProps = {
	width: 16,
	height: 16,
	viewBox: "0 0 16 16",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
	"aria-hidden": true,
};

function PlusIcon() {
	return (
		<svg {...iconProps}>
			<path d="M8 3.25v9.5M3.25 8h9.5" />
		</svg>
	);
}

function TrashIcon() {
	return (
		<svg {...iconProps}>
			<path d="M3.25 4.75h9.5M6.25 4.75V3.5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 .75.75v1.25" />
			<path d="M4.5 4.75 5 13a.75.75 0 0 0 .75.7h4.5A.75.75 0 0 0 11 13l.5-8.25" />
		</svg>
	);
}

function scrapTitle(scrap: Scrap): string {
	return scrap.title.trim() || "Untitled Scrap";
}

function scrapBody(scrap: Scrap): string {
	return extractLexicalPlainText(scrap.lexical).replace(/\s+/g, " ").trim();
}

function scrapPreview(scrap: Scrap): string {
	const text = (scrap.customExcerpt ?? "").trim() || scrapBody(scrap);
	if (!text) {
		return "No content yet.";
	}
	return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

/** A compact local timestamp: "Edited just now", "Edited 3h ago", … */
export function formatRelativeEdit(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return "Edited just now";
	}

	const diff = Math.max(0, Date.now() - date.getTime());
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) {
		return "Edited just now";
	}
	if (minutes < 60) {
		return `Edited ${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `Edited ${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	if (days < 7) {
		return `Edited ${days}d ago`;
	}
	return `Edited ${date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	})}`;
}

function matchesLocalQuery(scrap: Scrap, query: string): boolean {
	if (!query) {
		return true;
	}
	return [scrap.title, scrapBody(scrap), scrap.customExcerpt ?? ""].some(
		value => value.toLowerCase().includes(query),
	);
}

export default function ScrapsList({
	site,
	onOpenScrap,
	onOpenPost,
	onScrapCountChange,
}: Props) {
	const [scraps, setScraps] = useState<Scrap[] | null>(null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [promotingId, setPromotingId] = useState<string | null>(null);
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [refreshTick, setRefreshTick] = useState(0);

	const load = useCallback(async () => {
		try {
			const next = await listScraps(site.base);
			setScraps(next);
			setError(null);
			onScrapCountChange?.(next.length);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [site.base, onScrapCountChange]);

	useEffect(() => {
		let cancelled = false;
		setScraps(null);
		setError(null);
		listScraps(site.base)
			.then(next => {
				if (!cancelled) {
					setScraps(next);
					onScrapCountChange?.(next.length);
				}
			})
			.catch(err => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [site.base, onScrapCountChange, refreshTick]);

	const normalizedQuery = query.trim().toLowerCase();

	const filtered = useMemo(() => {
		if (!scraps) {
			return null;
		}
		return scraps.filter(scrap => matchesLocalQuery(scrap, normalizedQuery));
	}, [scraps, normalizedQuery]);

	async function handleNewScrap() {
		setCreating(true);
		setError(null);
		try {
			const scrap = await createScrap(site.base);
			await load();
			onOpenScrap(scrap);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	}

	async function handlePromote(scrap: Scrap) {
		const ok = window.confirm(
			`Promote "${scrapTitle(scrap)}" to a Ghost draft on "${site.title}"?\n\n` +
				"This publishes the scrap to your blog as a draft and removes the local copy.",
		);
		if (!ok) {
			return;
		}
		setPromotingId(scrap.id);
		setError(null);
		try {
			const post = await promoteScrapToDraft(site, scrap.id);
			await load();
			onOpenPost(post);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPromotingId(null);
		}
	}

	async function handleDelete(scrap: Scrap) {
		const ok = window.confirm(
			`Delete "${scrapTitle(scrap)}"?\n\nThis only removes the local scrap and cannot be undone.`,
		);
		if (!ok) {
			return;
		}
		setDeletingId(scrap.id);
		setError(null);
		try {
			await deleteScrap(site.base, scrap.id);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setDeletingId(null);
		}
	}

	const hasQuery = normalizedQuery.length > 0;

	return (
		<div className="postlist post-list-pane scraps-pane" data-testid="scraps-list">
			<header className="post-list-header">
				<h1 className="post-list-title">Scraps</h1>

				<div className="post-list-toolbar">
					<input
						type="search"
						className="post-list-search"
						value={query}
						onChange={event => setQuery(event.target.value)}
						placeholder="Search scraps"
						aria-label="Search scraps"
						data-testid="scrap-search-input"
					/>

					<button
						type="button"
						className="post-list-new-post"
						onClick={handleNewScrap}
						disabled={creating}
						data-testid="new-scrap-button"
					>
						<PlusIcon />
						{creating ? "Creating…" : "New scrap"}
					</button>
				</div>
			</header>

			{error && (
				<div className="error-banner" role="alert">
					<span>{error}</span>
					<div className="banner-actions">
						<button type="button" onClick={() => setRefreshTick(t => t + 1)}>
							Retry
						</button>
					</div>
				</div>
			)}

			{filtered === null && !error && (
				<p className="post-list-message">Loading…</p>
			)}

			{filtered?.length === 0 && (
				<div className="post-list-empty">
					<p>
						{hasQuery
							? "No scraps match your search."
							: "No scraps yet. Capture a note, then promote it when it is ready."}
					</p>
					{!hasQuery && (
						<button
							type="button"
							className="post-list-new-post"
							onClick={handleNewScrap}
							disabled={creating}
							data-testid="new-scrap-button-empty"
						>
							<PlusIcon />
							New scrap
						</button>
					)}
				</div>
			)}

			<ul className="post-list scrap-list" data-testid="scrap-list">
				{filtered?.map(scrap => {
					const title = scrapTitle(scrap);
					const busy =
						promotingId === scrap.id || deletingId === scrap.id;
					return (
						<li
							key={scrap.id}
							className="scrap-row"
							data-testid={`scrap-row-${scrap.id}`}
						>
							<button
								type="button"
								className="scrap-row-main"
								onClick={() => onOpenScrap(scrap)}
								aria-label={`Edit ${title}`}
							>
								<span className="scrap-row-body">
									<span className="scrap-row-title-row">
										<span className="scrap-row-title" title={title}>
											{title}
										</span>
									</span>
									<span className="scrap-row-meta">
										{formatRelativeEdit(scrap.updatedAt)}
										<span aria-hidden="true"> · </span>
										{scrap.wordCount.toLocaleString()}{" "}
										{scrap.wordCount === 1 ? "word" : "words"}
									</span>
									<span className="scrap-row-preview">
										{scrapPreview(scrap)}
									</span>
								</span>
							</button>

							<div className="scrap-row-actions">
								<button
									type="button"
									className="scrap-promote-button"
									onClick={() => void handlePromote(scrap)}
									disabled={busy}
									title={`Promote ${title} to a Ghost draft`}
									data-testid={`promote-scrap-${scrap.id}`}
								>
									{promotingId === scrap.id
										? "Promoting…"
										: "🚀 Promote to Draft"}
								</button>
								<button
									type="button"
									className="scrap-delete-button"
									onClick={() => void handleDelete(scrap)}
									disabled={busy}
									aria-label={`Delete ${title}`}
									title={`Delete ${title}`}
									data-testid={`delete-scrap-${scrap.id}`}
								>
									<TrashIcon />
								</button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

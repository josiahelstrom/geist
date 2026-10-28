import ThemeToggle from "./ThemeToggle";
import {useCallback, useEffect, useMemo, useState} from "react";
import {
	GhostError,
	listPosts,
	listSiteTags,
	type Post,
	type PostStatusFilter,
	type Site,
	type TagSummary,
} from "../lib/api";
import {filterPosts} from "../lib/posts";
import {shouldEnforceReadOnly, versionBanner} from "../lib/version";

type Props = {
	site: Site;
	sites: Site[];
	onOpenPost: (post: Post) => void;
	onSelectSite: (site: Site) => void;
	onDisconnect: () => void;
	onCreateDraft: () => Promise<Post | null>;
};

export default function PostList({
	site,
	sites,
	onOpenPost,
	onSelectSite,
	onDisconnect,
	onCreateDraft,
}: Props) {
	const [tab, setTab] = useState<PostStatusFilter>("draft");
	const [posts, setPosts] = useState<Post[] | null>(null);
	const [siteTags, setSiteTags] = useState<TagSummary[]>([]);
	const [query, setQuery] = useState("");
	const [tagFilter, setTagFilter] = useState("");
	const [featuredOnly, setFeaturedOnly] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [refreshTick, setRefreshTick] = useState(0);

	const load = useCallback(() => {
		setRefreshTick(t => t + 1);
	}, []);

	useEffect(() => {
		let cancelled = false;
		setPosts(null);
		setError(null);
		listPosts(site, tab)
			.then(result => {
				if (!cancelled) {
					setPosts(result);
				}
			})
			.catch(err => {
				if (!cancelled) {
					setError(
						err instanceof GhostError
							? err.message
							: err instanceof Error
								? err.message
								: String(err),
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [site, tab, refreshTick]);

	useEffect(() => {
		let cancelled = false;
		listSiteTags(site).then(tags => {
			if (!cancelled) {
				setSiteTags(tags);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [site]);

	const availableTags = useMemo(() => {
		const byKey = new Map<string, TagSummary>();
		for (const t of siteTags) {
			const key = (t.slug ?? t.name).toLowerCase();
			if (key) {
				byKey.set(key, t);
			}
		}
		for (const p of posts ?? []) {
			for (const t of p.tags ?? []) {
				const key = (t.slug ?? t.name).toLowerCase();
				if (key && !byKey.has(key)) {
					byKey.set(key, t);
				}
			}
		}
		return Array.from(byKey.values());
	}, [siteTags, posts]);

	const filteredPosts = useMemo(() => {
		if (!posts) {
			return null;
		}
		return filterPosts(posts, {
			query,
			tagSlug: tagFilter,
			featuredOnly,
		});
	}, [posts, query, tagFilter, featuredOnly]);

	async function handleNewDraft() {
		if (shouldEnforceReadOnly(site.version)) {
			const proceed = window.confirm(
				"This site runs a newer Ghost than this app supports. Create a new draft anyway?",
			);
			if (!proceed) {
				return;
			}
		}
		setCreating(true);
		setError(null);
		try {
			const post = await onCreateDraft();
			if (post) {
				onOpenPost(post);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setCreating(false);
		}
	}

	const banner = versionBanner(site.version);

	return (
		<div className="postlist">
			<header className="postlist-header">
				<strong className="brand-title">Geist</strong>
				<select
					value={site.base}
					onChange={e => {
						const next = sites.find(s => s.base === e.target.value);
						if (next) {
							onSelectSite(next);
						}
					}}
					aria-label="Site"
				>
					{sites.map(s => (
						<option key={s.base} value={s.base}>
							{s.title} — {s.base}
						</option>
					))}
				</select>
				<span className="muted">
					Ghost {site.version}
					{site.role ? ` · ${site.role}` : ""}
				</span>
				<div className="spacer" />
				<ThemeToggle />
				<button type="button" onClick={load} title="Refresh post list">
					↻
				</button>
				<button
					type="button"
					className="primary-button"
					onClick={handleNewDraft}
					disabled={creating}
				>
					{creating ? "Creating…" : "+ New draft"}
				</button>
				<button type="button" onClick={onDisconnect}>
					Sites
				</button>
			</header>

			{banner && (
				<div className="warn-banner">
					<span>{banner}</span>
				</div>
			)}

			<div className="postlist-controls">
				<nav className="tabs" aria-label="Post status filter">
					<button
						type="button"
						className={tab === "draft" ? "active" : ""}
						onClick={() => setTab("draft")}
					>
						Drafts
					</button>
					<button
						type="button"
						className={tab === "published" ? "active" : ""}
						onClick={() => setTab("published")}
					>
						Published
					</button>
					<button
						type="button"
						className={tab === "scheduled" ? "active" : ""}
						onClick={() => setTab("scheduled")}
					>
						Scheduled
					</button>
					<button
						type="button"
						className={tab === "all" ? "active" : ""}
						onClick={() => setTab("all")}
					>
						All
					</button>
				</nav>

				<div className="filter-bar">
					<input
						type="search"
						className="search-input"
						value={query}
						onChange={e => setQuery(e.target.value)}
						placeholder="Search title, slug, tag, author…"
						aria-label="Search posts"
						data-testid="post-search-input"
					/>
					{availableTags.length > 0 && (
						<select
							className="tag-filter-select"
							value={tagFilter}
							onChange={e => setTagFilter(e.target.value)}
							aria-label="Filter by tag"
							data-testid="post-tag-filter"
						>
							<option value="">All tags</option>
							{availableTags.map(t => {
								const value = t.slug ?? t.name;
								return (
									<option key={value} value={value}>
										#{t.name}
									</option>
								);
							})}
						</select>
					)}
					<button
						type="button"
						className={featuredOnly ? "active-button" : ""}
						onClick={() => setFeaturedOnly(f => !f)}
						title="Filter featured posts"
						data-testid="featured-filter-button"
					>
						★ Featured
					</button>
				</div>
			</div>

			{error && (
				<div className="error-banner" role="alert">
					<span>{error}</span>
					<div className="banner-actions">
						<button type="button" onClick={load}>
							Retry
						</button>
						<button type="button" onClick={onDisconnect}>
							Reconnect site
						</button>
					</div>
				</div>
			)}

			{filteredPosts === null && !error && <p className="muted">Loading…</p>}

			{filteredPosts?.length === 0 && (
				<p className="muted">
					{query || tagFilter || featuredOnly
						? "No posts match the current search or filters."
						: `No ${tab === "all" ? "posts" : `${tab} posts`}.`}
				</p>
			)}

			<ul className="posts" data-testid="post-list">
				{filteredPosts?.map(p => (
					<li key={p.id}>
						<button type="button" onClick={() => onOpenPost(p)}>
							<div className="post-row-top">
								<span className="post-title">{p.title || "Untitled"}</span>
								{p.featured && (
									<span className="badge badge-featured" title="Featured">
										★ Featured
									</span>
								)}
								{tab === "all" && (
									<span className={`badge badge-${p.status}`}>{p.status}</span>
								)}
							</div>
							{p.custom_excerpt && (
								<span className="post-excerpt">{p.custom_excerpt}</span>
							)}
							<div className="post-row-meta">
								{p.tags && p.tags.length > 0 && (
									<span className="post-tags-inline">
										{p.tags.map(t => `#${t.name}`).join("  ")}
									</span>
								)}
								{p.authors && p.authors.length > 0 && (
									<span className="muted">
										By {p.authors.map(a => a.name).join(", ")}
									</span>
								)}
								<span className="muted">
									Updated {new Date(p.updated_at).toLocaleString()}
								</span>
							</div>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

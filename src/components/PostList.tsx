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
	/** Optional controlled status filter; the rail and header share it. */
	filter?: PostStatusFilter;
	onFilterChange?: (filter: PostStatusFilter) => void;
	/** Optional controlled search; the rail Quick Search feeds the list. */
	searchQuery?: string;
	onSearchQueryChange?: (query: string) => void;
};

type SortOrder = "newest" | "oldest" | "title";

const FILTERS: {id: PostStatusFilter; label: string}[] = [
	{id: "all", label: "All"},
	{id: "draft", label: "Drafts"},
	{id: "scheduled", label: "Scheduled"},
	{id: "published", label: "Published"},
];

const STATUS_LABELS: Record<string, string> = {
	draft: "Draft",
	scheduled: "Scheduled",
	published: "Published",
	sent: "Sent",
};

const SORT_LABELS: Record<SortOrder, string> = {
	newest: "Newest first",
	oldest: "Oldest first",
	title: "Title A–Z",
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

function PencilIcon() {
	return (
		<svg {...iconProps}>
			<path d="M10.25 2.75 13.25 5.75 6 13H3v-3z" />
			<path d="m9.25 3.75 3 3" />
		</svg>
	);
}

function ImageIcon() {
	return (
		<svg {...iconProps}>
			<rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
			<circle cx="5.75" cy="6.5" r="1" />
			<path d="m3.25 11 3-3 2.25 2 1.75-1.5 2.5 2.25" />
		</svg>
	);
}

function SortIcon() {
	return (
		<svg {...iconProps}>
			<path d="M4.25 3v10M4.25 3 2 5.25M4.25 3 6.5 5.25" />
			<path d="M8.5 4.25h5M8.5 8h4M8.5 11.75h3" />
		</svg>
	);
}

function RefreshIcon() {
	return (
		<svg {...iconProps}>
			<path d="M13 6.5A5 5 0 0 0 3.6 4.4L2.5 5.75M3 9.5a5 5 0 0 0 9.4 2.1l1.1-1.35" />
			<path d="M2.5 3v2.75H5.25M13.5 13v-2.75h-2.75" />
		</svg>
	);
}

function PlusIcon() {
	return (
		<svg {...iconProps}>
			<path d="M8 3.25v9.5M3.25 8h9.5" />
		</svg>
	);
}

function statusLabel(status: string): string {
	return (
		STATUS_LABELS[status.toLowerCase()] ??
		status.charAt(0).toUpperCase() + status.slice(1)
	);
}

function statusTone(status: string): string {
	const key = status.toLowerCase();
	if (key === "draft" || key === "scheduled" || key === "published") {
		return key;
	}
	return "sent";
}

function formatPostDate(post: Post): string {
	const iso =
		post.status === "published" && post.published_at
			? post.published_at
			: post.updated_at;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) {
		return "";
	}
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function byline(post: Post): string {
	const authors = (post.authors ?? [])
		.map(author => author.name)
		.filter(Boolean)
		.join(", ");
	const date = formatPostDate(post);
	if (authors && date) {
		return `By ${authors} · ${date}`;
	}
	if (authors) {
		return `By ${authors}`;
	}
	return date;
}

export default function PostList({
	site,
	onOpenPost,
	onDisconnect,
	onCreateDraft,
	filter,
	onFilterChange,
	searchQuery,
	onSearchQueryChange,
}: Props) {
	const [localTab, setLocalTab] = useState<PostStatusFilter>("draft");
	const [localQuery, setLocalQuery] = useState("");
	const tab = filter ?? localTab;
	const query = searchQuery ?? localQuery;
	const [siteTags, setSiteTags] = useState<TagSummary[]>([]);
	const [tagFilter, setTagFilter] = useState("");
	const [featuredOnly, setFeaturedOnly] = useState(false);
	const [sort, setSort] = useState<SortOrder>("newest");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [posts, setPosts] = useState<Post[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [refreshTick, setRefreshTick] = useState(0);

	const updateTab = useCallback(
		(next: PostStatusFilter) => {
			setLocalTab(next);
			onFilterChange?.(next);
		},
		[onFilterChange],
	);

	const updateQuery = useCallback(
		(next: string) => {
			setLocalQuery(next);
			onSearchQueryChange?.(next);
		},
		[onSearchQueryChange],
	);

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
		const filtered = filterPosts(posts, {
			query,
			tagSlug: tagFilter,
			featuredOnly,
		});
		const sorted = [...filtered];
		switch (sort) {
			case "oldest":
				sorted.sort(
					(a, b) =>
						Date.parse(a.updated_at) - Date.parse(b.updated_at),
				);
				break;
			case "title":
				sorted.sort((a, b) =>
					(a.title || "Untitled").localeCompare(b.title || "Untitled"),
				);
				break;
			default:
				sorted.sort(
					(a, b) =>
						Date.parse(b.updated_at) - Date.parse(a.updated_at),
				);
				break;
		}
		return sorted;
	}, [posts, query, tagFilter, featuredOnly, sort]);

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
	const hasFilters = Boolean(query || tagFilter || featuredOnly);

	return (
		<div className="postlist post-list-pane">
			{banner && (
				<div className="warn-banner">
					<span>{banner}</span>
				</div>
			)}

			<header className="post-list-header">
				<h1 className="post-list-title">Posts</h1>

				<div className="post-list-toolbar">
					<nav
						className="post-list-filters"
						aria-label="Post status filter"
					>
						{FILTERS.map(f => (
							<button
								key={f.id}
								type="button"
								className={
									tab === f.id
										? "post-filter-pill is-active"
										: "post-filter-pill"
								}
								onClick={() => updateTab(f.id)}
								aria-pressed={tab === f.id}
								data-testid={`post-filter-${f.id}`}
							>
								{f.label}
							</button>
						))}
					</nav>

					<input
						type="search"
						className="post-list-search"
						value={query}
						onChange={e => updateQuery(e.target.value)}
						placeholder="Search posts"
						aria-label="Search posts"
						data-testid="post-search-input"
					/>

					{availableTags.length > 0 && (
						<select
							className="post-list-select"
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
						className={
							featuredOnly
								? "post-filter-pill post-featured-filter is-active"
								: "post-filter-pill post-featured-filter"
						}
						onClick={() => setFeaturedOnly(f => !f)}
						title="Filter featured posts"
						aria-pressed={featuredOnly}
						data-testid="featured-filter-button"
					>
						★ Featured
					</button>

					<label className="post-list-sort">
						<SortIcon />
						<select
							value={sort}
							onChange={e => setSort(e.target.value as SortOrder)}
							aria-label="Sort posts"
							data-testid="post-sort-select"
						>
							{(Object.keys(SORT_LABELS) as SortOrder[]).map(value => (
								<option key={value} value={value}>
									{SORT_LABELS[value]}
								</option>
							))}
						</select>
					</label>

					<button
						type="button"
						className="post-list-icon-button"
						onClick={load}
						title="Refresh post list"
						aria-label="Refresh post list"
						data-testid="refresh-post-list"
					>
						<RefreshIcon />
					</button>

					<button
						type="button"
						className="post-list-new-post"
						onClick={handleNewDraft}
						disabled={creating}
						data-testid="new-post-button"
					>
						<PlusIcon />
						{creating ? "Creating…" : "New post"}
					</button>
				</div>
			</header>

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

			{filteredPosts === null && !error && (
				<p className="post-list-message">Loading…</p>
			)}

			{filteredPosts?.length === 0 && (
				<div className="post-list-empty">
					<p>
						{hasFilters
							? "No posts match the current search or filters."
							: `No ${tab === "all" ? "posts" : `${tab} posts`}.`}
					</p>
					<button
						type="button"
						className="post-list-new-post"
						onClick={handleNewDraft}
						disabled={creating}
						data-testid="new-post-button-empty"
					>
						<PlusIcon />
						New post
					</button>
				</div>
			)}

			<ul className="posts post-list" data-testid="post-list">
				{filteredPosts?.map(p => {
					const title = p.title || "Untitled";
					const selected = selectedId === p.id;
					return (
						<li
							key={p.id}
							className={
								selected ? "post-row is-selected" : "post-row"
							}
							data-testid={`post-row-${p.id}`}
						>
							<button
								type="button"
								className="post-row-main"
								onClick={() => {
									setSelectedId(p.id);
									onOpenPost(p);
								}}
							>
								<span className="post-row-thumb" aria-hidden="true">
									{p.feature_image ? (
										<img
											src={p.feature_image}
											alt=""
											loading="lazy"
										/>
									) : (
										<ImageIcon />
									)}
								</span>
								<span className="post-row-body">
									<span className="post-row-title-row">
										{p.featured && (
											<span
												className="post-row-star"
												role="img"
												aria-label="Featured"
												title="Featured"
											>
												★
											</span>
										)}
										<span className="post-row-title" title={title}>
											{title}
										</span>
									</span>
									<span className="post-row-byline">{byline(p)}</span>
									<span
										className={`post-status post-status-${statusTone(
											p.status,
										)}`}
									>
										{statusLabel(p.status)}
									</span>
								</span>
							</button>
							<button
								type="button"
								className="post-row-edit"
								onClick={() => {
									setSelectedId(p.id);
									onOpenPost(p);
								}}
								aria-label={`Edit ${title}`}
								title={`Edit ${title}`}
							>
								<PencilIcon />
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

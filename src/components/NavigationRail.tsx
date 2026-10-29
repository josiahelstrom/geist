import {
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type {PostStatusFilter, Site} from "../lib/api";

/**
 * Navigation rail (docs/design-system.md §4.3).
 *
 * The rail is a floating 260px card inset 8px from the content edge. Sections
 * are data-driven so v0.7 can append `Scraps` without touching the render
 * tree: pass a `sections` array, each with an optional list of items.
 */
export type NavigationTone = "draft" | "scheduled" | "published" | "muted";

export type NavigationItem = {
	id: string;
	label: string;
	/** Post-list filter this item routes to, when it is part of Posts. */
	filter?: PostStatusFilter;
	/** Top-level list this item routes to, when it is not a post filter. */
	view?: "posts" | "scraps";
	/** Status dot rendered before the label. */
	tone?: NavigationTone;
	/** Optional count rendered next to the label, e.g. `Scraps (3)`. */
	count?: number;
};

export type NavigationSection = {
	id: string;
	label: string;
	/** Custom icon; defaults to a document glyph for the Posts group. */
	icon?: ReactNode;
	/** Groups with items are expandable. Defaults to true when items exist. */
	expandable?: boolean;
	items?: NavigationItem[];
};

export type NavigationRailProps = {
	site: Site;
	/** All connected sites, used by the site switcher. */
	sites?: Site[];
	/** Data-driven navigation. Defaults to the v0.5 Posts group. */
	sections?: NavigationSection[];
	/** Controlled collapse state (`Cmd+\` or the titlebar toggle). */
	sidebarOpen: boolean;
	activeFilter?: PostStatusFilter;
	/** Which top-level list is on screen (Posts or Scraps). */
	activeView?: "posts" | "scraps";
	/** Live count rendered beside the Scraps item. */
	scrapCount?: number;
	query?: string;
	onQueryChange?: (query: string) => void;
	onSelectFilter?: (filter: PostStatusFilter) => void;
	onSelectView?: (view: "posts" | "scraps") => void;
	onSelectSite?: (site: Site) => void;
	/** Custom item routing (the v0.7 `Scraps` seam). */
	onSelectItem?: (item: NavigationItem, section: NavigationSection) => void;
	onNewPost?: () => void;
	onOpenSettings?: () => void;
	staffName?: string;
	staffEmail?: string;
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

function PostsIcon() {
	return (
		<svg {...iconProps}>
			<path d="M10.25 2.75 13.25 5.75 6 13H3v-3z" />
			<path d="m9.25 3.75 3 3" />
		</svg>
	);
}

function FolderIcon() {
	return (
		<svg {...iconProps}>
			<path d="M2.25 4.75a1 1 0 0 1 1-1h2.7l1.3 1.5h5.5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1z" />
		</svg>
	);
}

function SearchIcon() {
	return (
		<svg {...iconProps}>
			<circle cx="7" cy="7" r="4.25" />
			<path d="m10.25 10.25 2.75 2.75" />
		</svg>
	);
}

function ChevronIcon({open}: {open: boolean}) {
	return (
		<svg
			{...iconProps}
			className={open ? "rail-chevron is-open" : "rail-chevron"}
			width={12}
			height={12}
			viewBox="0 0 12 12"
		>
			<path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
		</svg>
	);
}

function SettingsIcon() {
	return (
		<svg {...iconProps}>
			<circle cx="8" cy="8" r="2" />
			<path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M12.4 3.6l-1.05 1.05M4.65 11.35 3.6 12.4" />
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

const DEFAULT_SECTIONS: NavigationSection[] = [
	{
		id: "posts",
		label: "Posts",
		icon: <PostsIcon />,
		expandable: true,
		items: [
			{id: "all", label: "All posts", filter: "all"},
			{id: "draft", label: "Drafts", filter: "draft", tone: "draft"},
			{
				id: "scheduled",
				label: "Scheduled",
				filter: "scheduled",
				tone: "scheduled",
			},
			{
				id: "published",
				label: "Published",
				filter: "published",
				tone: "published",
			},
			{id: "scraps", label: "Scraps", view: "scraps"},
		],
	},
];

function hostFromBase(base: string): string {
	return base.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function siteInitials(title: string): string {
	const words = title.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return "G";
	}
	if (words.length === 1) {
		return words[0].slice(0, 1).toUpperCase();
	}
	return (words[0].slice(0, 1) + words[1].slice(0, 1)).toUpperCase();
}

export default function NavigationRail({
	site,
	sites,
	sections = DEFAULT_SECTIONS,
	sidebarOpen,
	activeFilter,
	activeView = "posts",
	scrapCount,
	query = "",
	onQueryChange,
	onSelectFilter,
	onSelectView,
	onSelectSite,
	onSelectItem,
	onNewPost,
	onOpenSettings,
	staffName,
	staffEmail,
}: NavigationRailProps) {
	const [collapsedSections, setCollapsedSections] = useState<
		Record<string, boolean>
	>({});
	const searchRef = useRef<HTMLInputElement>(null);

	// Quick Search owns ⌘K while the rail is visible.
	useEffect(() => {
		if (!sidebarOpen) {
			return;
		}
		function onKeyDown(event: KeyboardEvent) {
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				event.key.toLowerCase() === "k"
			) {
				event.preventDefault();
				searchRef.current?.focus();
				searchRef.current?.select();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [sidebarOpen]);

	const publicationName = site.title || hostFromBase(site.base);
	const staffLabel = staffName?.trim() || site.role || "Staff account";
	const staffMeta = staffEmail?.trim() || hostFromBase(site.base);
	const multipleSites = Boolean(sites && sites.length > 1 && onSelectSite);

	function selectItem(section: NavigationSection, item: NavigationItem) {
		if (item.view && onSelectView) {
			onSelectView(item.view);
			return;
		}
		if (onSelectItem) {
			onSelectItem(item, section);
			return;
		}
		if (item.filter) {
			onSelectFilter?.(item.filter);
		}
	}

	function itemCount(item: NavigationItem): number | undefined {
		if (item.id === "scraps" && typeof scrapCount === "number") {
			return scrapCount;
		}
		return item.count;
	}

	function toggleSection(section: NavigationSection) {
		setCollapsedSections(current => ({
			...current,
			[section.id]: !current[section.id],
		}));
	}

	return (
		<aside
			className="navigation-rail"
			aria-label="Navigation"
			aria-hidden={!sidebarOpen}
			data-open={sidebarOpen ? "true" : "false"}
			data-testid="navigation-rail"
		>
			<div className="rail-site">
				<span className="rail-site-avatar" aria-hidden="true">
					{siteInitials(publicationName)}
				</span>
				<div className="rail-site-copy">
					{multipleSites ? (
						<select
							className="rail-site-select"
							value={site.base}
							onChange={event => {
								const next = sites?.find(s => s.base === event.target.value);
								if (next) {
									onSelectSite?.(next);
								}
							}}
							aria-label="Site"
						>
							{sites?.map(s => (
								<option key={s.base} value={s.base}>
									{s.title || hostFromBase(s.base)}
								</option>
							))}
						</select>
					) : (
						<span className="rail-site-name" title={publicationName}>
							{publicationName}
						</span>
					)}
					<span className="rail-site-staff">
						{staffLabel}
						{staffMeta ? ` · ${staffMeta}` : ""}
					</span>
				</div>
			</div>

			<div className="rail-search">
				<span className="rail-search-icon" aria-hidden="true">
					<SearchIcon />
				</span>
				<input
					ref={searchRef}
					type="search"
					className="rail-search-input"
					value={query}
					onChange={event => onQueryChange?.(event.target.value)}
					placeholder="Quick search"
					aria-label="Quick search posts"
					data-testid="rail-search-input"
				/>
				<kbd className="rail-search-hint" aria-hidden="true">
					⌘K
				</kbd>
			</div>

			<div className="rail-divider" role="presentation" />

			<nav className="rail-sections" aria-label="Site sections">
				{sections.map(section => {
					const hasItems = Boolean(section.items?.length);
					const expandable = section.expandable ?? hasItems;
					const expanded = !collapsedSections[section.id];
					return (
						<div className="rail-section" key={section.id}>
							<button
								type="button"
								className="rail-nav-row rail-section-toggle"
								onClick={() =>
									expandable ? toggleSection(section) : undefined
								}
								aria-expanded={expandable ? expanded : undefined}
							>
								<span className="rail-nav-icon">
									{section.icon ?? <FolderIcon />}
								</span>
								<span className="rail-nav-label">{section.label}</span>
								{expandable && <ChevronIcon open={expanded} />}
							</button>

							{hasItems && expanded && (
								<div className="rail-section-items">
									{section.items?.map(item => {
										const active =
											(item.filter !== undefined &&
												item.filter === activeFilter &&
												activeView === "posts") ||
											(item.view !== undefined &&
												item.view === activeView);
										const count = itemCount(item);
										return (
											<button
												type="button"
												key={item.id}
												className={
													active
														? "rail-nav-row rail-child-row is-active"
														: "rail-nav-row rail-child-row"
												}
												onClick={() => selectItem(section, item)}
												aria-current={active ? "page" : undefined}
												data-testid={
													item.view === "scraps"
														? "rail-scraps-item"
														: undefined
												}
											>
												{item.tone && (
													<span
														className={`rail-dot rail-dot-${item.tone}`}
														aria-hidden="true"
													/>
												)}
												<span className="rail-nav-label">
													{item.label}
													{typeof count === "number" && count > 0
														? ` (${count})`
														: ""}
												</span>
											</button>
										);
									})}
								</div>
							)}
						</div>
					);
				})}
			</nav>

			<div className="rail-footer">
				<button
					type="button"
					className="rail-nav-row rail-settings"
					onClick={onOpenSettings}
					title="Manage connected sites"
				>
					<span className="rail-nav-icon">
						<SettingsIcon />
					</span>
					<span className="rail-nav-label">Site settings</span>
				</button>

				<button
					type="button"
					className="rail-new-post"
					onClick={onNewPost}
					data-testid="rail-new-post"
				>
					<PlusIcon />
					New post
				</button>
			</div>
		</aside>
	);
}

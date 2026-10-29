import {useCallback, useEffect, useState} from "react";
import {listen} from "@tauri-apps/api/event";
import {type Post, type PostStatusFilter, type Site} from "./lib/api";
import {createDraft} from "./lib/posts";
import {shouldEnforceReadOnly} from "./lib/version";
import {
	applyTheme,
	getStoredTheme,
	setStoredTheme,
	type Theme,
} from "./lib/theme";
import {
	getActiveBase,
	hydrateSitesFromStore,
	loadSites,
	saveSites,
	setActiveBase,
} from "./lib/sites";
import type {SaveStatus} from "./lib/saver";
import Connect from "./components/Connect";
import NavigationRail from "./components/NavigationRail";
import PostList from "./components/PostList";
import Editor from "./components/Editor";
import TitleBar from "./components/TitleBar";

type View =
	| {name: "connect"}
	| {name: "list"}
	| {name: "editor"; postId: string};

const THEME_ORDER: Theme[] = ["light", "dark", "system"];

/**
 * The editor owns the live save state (it drives the saver), so the native
 * chrome mirrors its status label instead of keeping a second copy. `clean`
 * renders an empty label in the editor, which means "saved".
 */
function saveStatusFromCopy(copy: string): SaveStatus {
	const text = copy.trim().toLowerCase();
	if (!text || text === "saved") {
		return "saved";
	}
	if (text.startsWith("saving")) {
		return "saving";
	}
	if (text.startsWith("unsaved")) {
		return "dirty";
	}
	if (text.startsWith("conflict")) {
		return "conflict";
	}
	if (text.includes("failed") || text.startsWith("error")) {
		return "error";
	}
	return "saved";
}

/** Open an editor control from the native menu without duplicating its state. */
function pressControl(testId: string): boolean {
	const control = document.querySelector<HTMLButtonElement>(
		`[data-testid="${testId}"]`,
	);
	if (!control) {
		return false;
	}
	control.click();
	return true;
}

export default function App() {
	const [sites, setSites] = useState<Site[]>(() => loadSites());
	const [site, setSite] = useState<Site | null>(null);
	const [view, setView] = useState<View>({name: "connect"});
	const [activePost, setActivePost] = useState<Post | null>(null);
	const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const [postFilter, setPostFilter] = useState<PostStatusFilter>("draft");
	const [postQuery, setPostQuery] = useState("");

	// Apply the saved theme on boot and keep "system" in sync with the OS.
	useEffect(() => {
		applyTheme();

		if (!window.matchMedia) {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		function onSystemThemeChange() {
			if (getStoredTheme() === "system") {
				applyTheme("system");
			}
		}

		media.addEventListener("change", onSystemThemeChange);
		return () => media.removeEventListener("change", onSystemThemeChange);
	}, []);

	// Restore the last session from local cache first, then hydrate from
	// `tauri-plugin-store` (`geist-sites.json`).
	useEffect(() => {
		let cancelled = false;
		const initial = loadSites();
		if (initial.length) {
			const active =
				initial.find(s => s.base === getActiveBase()) ?? initial[0];
			if (active) {
				setSite(active);
				setView({name: "list"});
			}
		}

		hydrateSitesFromStore().then(({sites: stored, activeBase}) => {
			if (cancelled || !stored.length) {
				return;
			}
			setSites(stored);
			setSite(current => {
				if (current) {
					return stored.find(s => s.base === current.base) ?? current;
				}
				const active =
					stored.find(s => s.base === activeBase) ?? stored[0];
				if (active) {
					setView({name: "list"});
				}
				return active ?? null;
			});
		});

		return () => {
			cancelled = true;
		};
	}, []);

	const handleConnect = useCallback((chosen: Site, nextSites: Site[]) => {
		setSites(nextSites);
		setSite(chosen);
		setActivePost(null);
		setSaveStatus(null);
		setView({name: "list"});
	}, []);

	const handleDisconnect = useCallback(() => {
		setSite(null);
		setActivePost(null);
		setSaveStatus(null);
		setView({name: "connect"});
	}, []);

	const handleSelectSite = useCallback((next: Site) => {
		setSite(next);
		setActiveBase(next.base);
		setActivePost(null);
		setSaveStatus(null);
		setView({name: "list"});
	}, []);

	const handleOpenPost = useCallback((post: Post) => {
		setActivePost(post);
		setSaveStatus("saved");
		setInspectorOpen(false);
		setView({name: "editor", postId: post.id});
	}, []);

	const handleCreateDraft = useCallback(async (): Promise<Post | null> => {
		if (!site) {
			return null;
		}
		return createDraft(site);
	}, [site]);

	const handleBackToList = useCallback(() => {
		setActivePost(null);
		setSaveStatus(null);
		setInspectorOpen(false);
		setView({name: "list"});
	}, []);

	const handleNewPost = useCallback(async () => {
		if (site && shouldEnforceReadOnly(site.version)) {
			const proceed = window.confirm(
				"This site runs a newer Ghost than this app supports. Create a new draft anyway?",
			);
			if (!proceed) {
				return;
			}
		}
		try {
			const post = await handleCreateDraft();
			if (post) {
				handleOpenPost(post);
			}
		} catch (err) {
			window.alert(err instanceof Error ? err.message : String(err));
		}
	}, [handleCreateDraft, handleOpenPost, site]);

	const cycleTheme = useCallback(() => {
		const current = getStoredTheme();
		const next =
			THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] ??
			"system";
		setStoredTheme(next);
		applyTheme(next);
	}, []);

	const toggleSidebar = useCallback(() => {
		setSidebarOpen(open => !open);
	}, []);

	// `Cmd+\` collapses the rail from anywhere in the window. The native menu
	// sends the same intent through `menu-toggle-sidebar`.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				(event.key === "\\" || event.code === "Backslash")
			) {
				event.preventDefault();
				setSidebarOpen(open => !open);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const toggleInspector = useCallback(() => {
		const control = document.querySelector<HTMLButtonElement>(
			'[data-testid="toggle-sidebar-button"]',
		);
		if (control) {
			// The editor is the single source of truth for its drawer state;
			// press its control so both stay in sync.
			setInspectorOpen(
				!(
					control.classList.contains("is-active") ||
					control.classList.contains("active-button")
				),
			);
			control.click();
			return;
		}
		setInspectorOpen(open => !open);
	}, []);

	const openRevisions = useCallback(() => {
		pressControl("toggle-revisions-button");
	}, []);

	const refreshPosts = useCallback(() => {
		// The list owns its loading state; its refresh control is the public
		// entry point. In the editor there is nothing to refresh here.
		if (!pressControl("refresh-post-list")) {
			document
				.querySelector<HTMLButtonElement>('button[title="Refresh post list"]')
				?.click();
		}
	}, []);

	// Native menu events (`src-tauri/src/lib.rs`, Phase 2). The menu is only
	// present in the Tauri webview, so a rejection in `vite dev` is expected.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let cancelled = false;

		listen<string>("geist:menu", event => {
			switch (event.payload) {
				case "menu-new-post":
					void handleNewPost();
					break;
				case "menu-toggle-sidebar":
					toggleSidebar();
					break;
				case "menu-toggle-inspector":
					toggleInspector();
					break;
				case "menu-save-revision":
					// The editor owns saving; it listens for this event so the
					// menu and the Cmd+S shortcut follow the same path.
					window.dispatchEvent(new CustomEvent("geist:save-revision"));
					break;
				case "menu-cycle-theme":
					cycleTheme();
					break;
				default:
					break;
			}
		})
			.then(fn => {
				if (cancelled) {
					fn();
				} else {
					unlisten = fn;
				}
			})
			.catch(() => {
				/* Browser dev server: no Tauri event bridge. */
			});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [handleNewPost, toggleSidebar, toggleInspector, cycleTheme]);

	// Keep the titlebar's title, status and save indicator in step with the
	// editor. The editor remains the owner of all three.
	useEffect(() => {
		if (view.name !== "editor") {
			return;
		}

		let observer: MutationObserver | undefined;
		let retry: number | undefined;
		let attempts = 0;
		let cancelled = false;

		function sync() {
			const statusEl = document.querySelector(
				'[data-testid="save-status"]',
			);
			if (statusEl) {
				setSaveStatus(saveStatusFromCopy(statusEl.textContent ?? ""));
			}
			const badge = document.querySelector(".editor-header .badge");
			const nextStatus = badge?.textContent?.trim();
			if (nextStatus) {
				setActivePost(prev =>
					prev && prev.status !== nextStatus
						? {...prev, status: nextStatus}
						: prev,
				);
			}
		}

		function attach() {
			if (cancelled) {
				return;
			}
			const header = document.querySelector(".editor-header");
			if (!header) {
				attempts += 1;
				if (attempts <= 120) {
					retry = window.setTimeout(attach, 250);
				}
				return;
			}
			sync();
			observer = new MutationObserver(sync);
			observer.observe(header, {
				childList: true,
				characterData: true,
				subtree: true,
			});
		}

		function onTitleInput(event: Event) {
			const target = event.target;
			if (
				target instanceof HTMLInputElement &&
				target.dataset.testid === "title-input"
			) {
				const value = target.value;
				setActivePost(prev => (prev ? {...prev, title: value} : prev));
			}
		}

		attach();
		window.addEventListener("input", onTitleInput, true);

		return () => {
			cancelled = true;
			if (retry !== undefined) {
				window.clearTimeout(retry);
			}
			observer?.disconnect();
			window.removeEventListener("input", onTitleInput, true);
		};
	}, [view]);

	const titleBar = (
		<TitleBar
			postTitle={activePost?.title ?? null}
			postStatus={activePost?.status ?? null}
			saveStatus={view.name === "editor" ? saveStatus : null}
			sidebarOpen={sidebarOpen}
			inspectorOpen={inspectorOpen}
			onToggleSidebar={toggleSidebar}
			onCycleTheme={cycleTheme}
			onRefresh={refreshPosts}
			onOpenRevisions={openRevisions}
			onToggleInspector={toggleInspector}
		/>
	);

	if (view.name === "connect" || !site) {
		return (
			<Connect
				sites={sites}
				onReady={handleConnect}
				onSitesChanged={next => {
					setSites(next);
					saveSites(next);
				}}
			/>
		);
	}

	if (view.name === "list") {
		return (
			<div
				className="app-shell"
				data-sidebar={sidebarOpen ? "open" : "collapsed"}
			>
				{titleBar}
				<div className="app-shell-body app-shell-body-split">
					<div
						className="app-layout"
						data-sidebar={sidebarOpen ? "open" : "collapsed"}
					>
						<NavigationRail
							site={site}
							sites={sites}
							sidebarOpen={sidebarOpen}
							activeFilter={postFilter}
							query={postQuery}
							onQueryChange={setPostQuery}
							onSelectFilter={setPostFilter}
							onSelectSite={handleSelectSite}
							onNewPost={handleNewPost}
							onOpenSettings={handleDisconnect}
						/>
						<main className="app-workspace">
							<PostList
								site={site}
								sites={sites}
								filter={postFilter}
								onFilterChange={setPostFilter}
								searchQuery={postQuery}
								onSearchQueryChange={setPostQuery}
								onOpenPost={handleOpenPost}
								onSelectSite={handleSelectSite}
								onDisconnect={handleDisconnect}
								onCreateDraft={handleCreateDraft}
							/>
						</main>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="app-shell"
			data-sidebar={sidebarOpen ? "open" : "collapsed"}
		>
			{titleBar}
			<div className="app-shell-body">
				<Editor
					site={site}
					postId={view.postId}
					onBack={handleBackToList}
					onReconnect={handleDisconnect}
				/>
			</div>
		</div>
	);
}

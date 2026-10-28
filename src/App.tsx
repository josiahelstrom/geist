import {useCallback, useEffect, useState} from "react";
import {type Post, type Site} from "./lib/api";
import {createDraft} from "./lib/posts";
import {applyTheme, getStoredTheme} from "./lib/theme";
import {
	getActiveBase,
	hydrateSitesFromStore,
	loadSites,
	saveSites,
	setActiveBase,
} from "./lib/sites";
import Connect from "./components/Connect";
import PostList from "./components/PostList";
import Editor from "./components/Editor";

type View =
	| {name: "connect"}
	| {name: "list"}
	| {name: "editor"; postId: string};

export default function App() {
	const [sites, setSites] = useState<Site[]>(() => loadSites());
	const [site, setSite] = useState<Site | null>(null);
	const [view, setView] = useState<View>({name: "connect"});

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
		setView({name: "list"});
	}, []);

	const handleDisconnect = useCallback(() => {
		setSite(null);
		setView({name: "connect"});
	}, []);

	const handleSelectSite = useCallback((next: Site) => {
		setSite(next);
		setActiveBase(next.base);
		setView({name: "list"});
	}, []);

	const handleOpenPost = useCallback((post: Post) => {
		setView({name: "editor", postId: post.id});
	}, []);

	async function handleCreateDraft(): Promise<Post | null> {
		if (!site) {
			return null;
		}
		return createDraft(site);
	}

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
			<PostList
				site={site}
				sites={sites}
				onOpenPost={handleOpenPost}
				onSelectSite={handleSelectSite}
				onDisconnect={handleDisconnect}
				onCreateDraft={handleCreateDraft}
			/>
		);
	}

	return (
		<Editor
			site={site}
			postId={view.postId}
			onBack={() => setView({name: "list"})}
			onReconnect={handleDisconnect}
		/>
	);
}

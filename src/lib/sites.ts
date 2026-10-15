import {LazyStore} from "@tauri-apps/plugin-store";
import type {Site} from "./api";

const STORE_FILE = "geist-sites.json";
const STORE_SITES_KEY = "sites";
const STORE_ACTIVE_KEY = "activeBase";

const KEY = "geist.sites.v1";
const ACTIVE = "geist.activeSite.v1";
const LEGACY_KEY = "draftdesk.sites.v1";
const LEGACY_ACTIVE = "draftdesk.activeSite.v1";

let lazyStore: LazyStore | null = null;

function getStore(): LazyStore | null {
	try {
		if (!lazyStore) {
			lazyStore = new LazyStore(STORE_FILE);
		}
		return lazyStore;
	} catch {
		return null;
	}
}

function getStorage(): Storage | null {
	try {
		return typeof localStorage !== "undefined" ? localStorage : null;
	} catch {
		return null;
	}
}

async function persistToTauriStore(sites: Site[], activeBase: string | null) {
	const store = getStore();
	if (!store) {
		return;
	}
	try {
		await store.set(STORE_SITES_KEY, sites);
		if (activeBase) {
			await store.set(STORE_ACTIVE_KEY, activeBase);
		} else {
			await store.delete(STORE_ACTIVE_KEY);
		}
		await store.save();
	} catch {
		/* Outside Tauri runtime (e.g. unit tests or browser dev); localStorage mirror still holds state */
	}
}

export function loadSites(): Site[] {
	const storage = getStorage();
	if (!storage) {
		return [];
	}
	try {
		const raw = storage.getItem(KEY) ?? storage.getItem(LEGACY_KEY);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		// Migrate legacy key if needed
		if (!storage.getItem(KEY) && storage.getItem(LEGACY_KEY)) {
			storage.setItem(KEY, raw);
		}
		return parsed as Site[];
	} catch {
		return [];
	}
}

export function getActiveBase(): string | null {
	const storage = getStorage();
	if (!storage) {
		return null;
	}
	const active = storage.getItem(ACTIVE) ?? storage.getItem(LEGACY_ACTIVE);
	if (!storage.getItem(ACTIVE) && active) {
		storage.setItem(ACTIVE, active);
	}
	return active;
}

/**
 * Loads site metadata from `tauri-plugin-store` (`geist-sites.json`), or
 * migrates existing `localStorage` sites into the Tauri store on first run.
 */
export async function hydrateSitesFromStore(): Promise<{
	sites: Site[];
	activeBase: string | null;
}> {
	const localSites = loadSites();
	const localActive = getActiveBase();
	const store = getStore();
	if (!store) {
		return {sites: localSites, activeBase: localActive};
	}

	try {
		const storedSites = await store.get<Site[]>(STORE_SITES_KEY);
		const storedActive = await store.get<string>(STORE_ACTIVE_KEY);

		if (Array.isArray(storedSites) && storedSites.length > 0) {
			const storage = getStorage();
			storage?.setItem(KEY, JSON.stringify(storedSites));
			const resolvedActive =
				storedActive ?? localActive ?? storedSites[0]?.base ?? null;
			if (resolvedActive) {
				storage?.setItem(ACTIVE, resolvedActive);
			}
			return {sites: storedSites, activeBase: resolvedActive};
		}

		if (localSites.length > 0) {
			await persistToTauriStore(localSites, localActive ?? localSites[0].base);
		}
	} catch {
		/* Fall back to local state if store IPC is unavailable */
	}

	return {sites: localSites, activeBase: localActive};
}

export function saveSites(sites: Site[]) {
	const storage = getStorage();
	storage?.setItem(KEY, JSON.stringify(sites));
	void persistToTauriStore(sites, getActiveBase());
}

export function upsertSite(site: Site): Site[] {
	const sites = loadSites();
	const next = sites.some(s => s.base === site.base)
		? sites.map(s => (s.base === site.base ? site : s))
		: [...sites, site];
	const storage = getStorage();
	storage?.setItem(KEY, JSON.stringify(next));
	storage?.setItem(ACTIVE, site.base);
	void persistToTauriStore(next, site.base);
	return next;
}

export function setActiveBase(base: string) {
	const storage = getStorage();
	storage?.setItem(ACTIVE, base);
	void persistToTauriStore(loadSites(), base);
}

export function removeSite(base: string): Site[] {
	const next = loadSites().filter(s => s.base !== base);
	const storage = getStorage();
	storage?.setItem(KEY, JSON.stringify(next));

	let nextActive = getActiveBase();
	if (nextActive === base) {
		nextActive = next[0]?.base ?? null;
		if (nextActive) {
			storage?.setItem(ACTIVE, nextActive);
		} else {
			storage?.removeItem(ACTIVE);
			storage?.removeItem(LEGACY_ACTIVE);
		}
	}
	void persistToTauriStore(next, nextActive);
	return next;
}

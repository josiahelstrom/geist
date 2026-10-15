import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Site} from "./api";

const storeMap = new Map<string, unknown>();
let storeSavedCount = 0;

vi.mock("@tauri-apps/plugin-store", () => ({
	LazyStore: class MockLazyStore {
		async get<T>(key: string): Promise<T | undefined> {
			return storeMap.get(key) as T | undefined;
		}
		async set(key: string, value: unknown): Promise<void> {
			storeMap.set(key, value);
		}
		async delete(key: string): Promise<boolean> {
			return storeMap.delete(key);
		}
		async save(): Promise<void> {
			storeSavedCount += 1;
		}
	},
}));

const localMap = new Map<string, string>();
const mockLocalStorage = {
	getItem: (k: string) => localMap.get(k) ?? null,
	setItem: (k: string, v: string) => {
		localMap.set(k, v);
	},
	removeItem: (k: string) => {
		localMap.delete(k);
	},
};

Object.defineProperty(globalThis, "localStorage", {
	value: mockLocalStorage,
	configurable: true,
});

const {
	loadSites,
	getActiveBase,
	upsertSite,
	removeSite,
	hydrateSitesFromStore,
} = await import("./sites");

const SAMPLE_SITE: Site = {
	base: "https://everywayhuman.com",
	siteUrl: "https://everywayhuman.com/",
	title: "every way human",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

beforeEach(() => {
	storeMap.clear();
	localMap.clear();
	storeSavedCount = 0;
});

describe("sites store & v0.1 -> v0.2 migration", () => {
	it("migrates legacy draftdesk.sites.v1 entries into geist.sites.v1 and tauri-plugin-store", async () => {
		localMap.set("draftdesk.sites.v1", JSON.stringify([SAMPLE_SITE]));
		localMap.set("draftdesk.activeSite.v1", SAMPLE_SITE.base);

		const loaded = loadSites();
		expect(loaded).toEqual([SAMPLE_SITE]);
		expect(localMap.get("geist.sites.v1")).toBeTruthy();
		expect(getActiveBase()).toBe(SAMPLE_SITE.base);

		const hydrated = await hydrateSitesFromStore();
		expect(hydrated.sites).toEqual([SAMPLE_SITE]);
		expect(hydrated.activeBase).toBe(SAMPLE_SITE.base);
		expect(storeMap.get("sites")).toEqual([SAMPLE_SITE]);
		expect(storeMap.get("activeBase")).toBe(SAMPLE_SITE.base);
		expect(storeSavedCount).toBeGreaterThan(0);
	});

	it("hydrates from tauri-plugin-store when on-disk store has sites", async () => {
		storeMap.set("sites", [SAMPLE_SITE]);
		storeMap.set("activeBase", SAMPLE_SITE.base);

		const hydrated = await hydrateSitesFromStore();
		expect(hydrated.sites).toEqual([SAMPLE_SITE]);
		expect(hydrated.activeBase).toBe(SAMPLE_SITE.base);
		expect(loadSites()).toEqual([SAMPLE_SITE]);
	});

	it("upserts and removes sites across both localStorage and tauri-plugin-store", async () => {
		const afterUpsert = upsertSite(SAMPLE_SITE);
		expect(afterUpsert).toHaveLength(1);
		// Let async store persistence settle
		await new Promise(r => setTimeout(r, 5));
		expect(storeMap.get("sites")).toEqual([SAMPLE_SITE]);

		const afterRemove = removeSite(SAMPLE_SITE.base);
		expect(afterRemove).toEqual([]);
		await new Promise(r => setTimeout(r, 5));
		expect(storeMap.get("sites")).toEqual([]);
		expect(storeMap.get("activeBase")).toBeUndefined();
	});
});

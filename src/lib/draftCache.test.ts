import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {PostDetail} from "./api";

const storeMock = vi.hoisted(() => ({
	data: new Map<string, unknown>(),
	deleted: [] as string[],
	failGet: false,
}));

vi.mock("@tauri-apps/plugin-store", () => ({
	LazyStore: class MockLazyStore {
		async get(key: string) {
			if (storeMock.failGet) {
				throw new Error("store unavailable");
			}
			return storeMock.data.get(key);
		}

		async set(key: string, value: unknown) {
			storeMock.data.set(key, value);
		}

		async delete(key: string) {
			storeMock.deleted.push(key);
			storeMock.data.delete(key);
		}

		async save() {
			/* no-op */
		}
	},
}));

import {
	__resetDraftCacheForTests,
	cacheDraft,
	clearSiteDraftCache,
	getCachedDraft,
	hasTauriRuntime,
	listCachedDrafts,
	listPendingPatches,
	markDraftClean,
	removeCachedDraft,
} from "./draftCache";

const SITE = "https://example.com";
const OTHER_SITE = "https://other.example.com";

function storeKey(siteBase: string): string {
	return `drafts_${encodeURIComponent(siteBase)}`;
}

function makePost(overrides: Partial<PostDetail> = {}): PostDetail {
	return {
		id: "post-1",
		uuid: "uuid-1",
		title: "Offline draft",
		status: "draft",
		updated_at: "2026-01-01T00:00:00.000Z",
		lexical: JSON.stringify({root: {type: "root", children: []}}),
		custom_excerpt: null,
		...overrides,
	};
}

function setTime(iso: string): void {
	vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
	vi.useFakeTimers({toFake: ["Date"]});
	setTime("2026-02-01T10:00:00.000Z");
	__resetDraftCacheForTests();
	storeMock.data.clear();
	storeMock.deleted.length = 0;
	storeMock.failGet = false;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("cacheDraft / getCachedDraft", () => {
	it("caches a clean draft", async () => {
		const post = makePost();

		await cacheDraft(SITE, post);
		const cached = await getCachedDraft(SITE, post.id);

		expect(cached).not.toBeNull();
		expect(cached?.postId).toBe(post.id);
		expect(cached?.siteBase).toBe(SITE);
		expect(cached?.post).toEqual(post);
		expect(cached?.cachedAt).toBe("2026-02-01T10:00:00.000Z");
		expect(cached?.dirty).toBe(false);
		expect(cached?.pendingPatch).toBeNull();
	});

	it("caches a dirty draft with a pending patch", async () => {
		const post = makePost();
		const pendingPatch: Partial<PostDetail> = {
			title: "Unsynced title",
			custom_excerpt: "Local excerpt",
		};

		await cacheDraft(SITE, post, {dirty: true, pendingPatch});
		const cached = await getCachedDraft(SITE, post.id);

		expect(cached?.dirty).toBe(true);
		expect(cached?.pendingPatch).toEqual(pendingPatch);
	});

	it("updates an existing entry instead of duplicating it", async () => {
		await cacheDraft(SITE, makePost());
		setTime("2026-02-01T10:05:00.000Z");
		await cacheDraft(
			SITE,
			makePost({title: "Edited title"}),
			{dirty: true, pendingPatch: {title: "Edited title"}},
		);

		const drafts = await listCachedDrafts(SITE);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].post.title).toBe("Edited title");
		expect(drafts[0].cachedAt).toBe("2026-02-01T10:05:00.000Z");
		expect(drafts[0].dirty).toBe(true);
	});

	it("returns copies so callers cannot mutate the cache", async () => {
		const post = makePost();
		await cacheDraft(SITE, post, {
			dirty: true,
			pendingPatch: {title: "Queued"},
		});

		const first = await getCachedDraft(SITE, post.id);
		expect(first).not.toBeNull();
		if (first) {
			first.post.title = "Mutated locally";
			first.pendingPatch = {title: "Mutated patch"};
		}

		const second = await getCachedDraft(SITE, post.id);
		expect(second?.post.title).toBe("Offline draft");
		expect(second?.pendingPatch).toEqual({title: "Queued"});
	});

	it("returns null for an uncached post", async () => {
		await expect(getCachedDraft(SITE, "missing")).resolves.toBeNull();
	});
});

describe("listCachedDrafts", () => {
	it("returns cached drafts newest first", async () => {
		setTime("2026-02-01T10:00:00.000Z");
		await cacheDraft(SITE, makePost({id: "old", title: "Old"}));

		setTime("2026-02-01T10:01:00.000Z");
		await cacheDraft(SITE, makePost({id: "middle", title: "Middle"}));

		setTime("2026-02-01T10:02:00.000Z");
		await cacheDraft(SITE, makePost({id: "new", title: "New"}));

		const drafts = await listCachedDrafts(SITE);

		expect(drafts.map(draft => draft.postId)).toEqual([
			"new",
			"middle",
			"old",
		]);
	});

	it("returns an empty list when nothing is cached", async () => {
		await expect(listCachedDrafts(SITE)).resolves.toEqual([]);
	});
});

describe("listPendingPatches", () => {
	it("returns only dirty drafts with a non-empty patch", async () => {
		await cacheDraft(SITE, makePost({id: "clean"}));

		setTime("2026-02-01T10:01:00.000Z");
		await cacheDraft(SITE, makePost({id: "queued", title: "Queued"}), {
			dirty: true,
			pendingPatch: {title: "Queued"},
		});

		setTime("2026-02-01T10:02:00.000Z");
		await cacheDraft(SITE, makePost({id: "empty-patch"}), {
			dirty: true,
			pendingPatch: {},
		});

		setTime("2026-02-01T10:03:00.000Z");
		await cacheDraft(SITE, makePost({id: "dirty-no-patch"}), {
			dirty: true,
		});

		await cacheDraft(SITE, makePost({id: "not-dirty-with-patch"}), {
			dirty: false,
			pendingPatch: {title: "Ignored"},
		});

		const pending = await listPendingPatches(SITE);

		expect(pending.map(draft => draft.postId)).toEqual(["queued"]);
		expect(pending[0].pendingPatch).toEqual({title: "Queued"});
	});

	it("orders pending patches newest first", async () => {
		setTime("2026-02-01T10:00:00.000Z");
		await cacheDraft(SITE, makePost({id: "first"}), {
			dirty: true,
			pendingPatch: {title: "First"},
		});

		setTime("2026-02-01T10:01:00.000Z");
		await cacheDraft(SITE, makePost({id: "second"}), {
			dirty: true,
			pendingPatch: {title: "Second"},
		});

		const pending = await listPendingPatches(SITE);

		expect(pending.map(draft => draft.postId)).toEqual([
			"second",
			"first",
		]);
	});
});

describe("markDraftClean", () => {
	it("clears the patch and updates the cached post and timestamp", async () => {
		const original = makePost();
		await cacheDraft(SITE, original, {
			dirty: true,
			pendingPatch: {title: "Unsynced title"},
		});

		setTime("2026-02-01T10:30:00.000Z");
		const updated = makePost({title: "Synced title"});
		await markDraftClean(SITE, original.id, updated);

		const cached = await getCachedDraft(SITE, original.id);
		expect(cached?.dirty).toBe(false);
		expect(cached?.pendingPatch).toBeNull();
		expect(cached?.post).toEqual(updated);
		expect(cached?.cachedAt).toBe("2026-02-01T10:30:00.000Z");
		await expect(listPendingPatches(SITE)).resolves.toEqual([]);
	});

	it("is a no-op for an uncached post", async () => {
		await expect(
			markDraftClean(SITE, "missing", makePost()),
		).resolves.toBeUndefined();
		await expect(listCachedDrafts(SITE)).resolves.toEqual([]);
	});
});

describe("removeCachedDraft", () => {
	it("removes a single cached draft", async () => {
		const post = makePost();
		const other = makePost({id: "post-2"});
		await cacheDraft(SITE, post);
		await cacheDraft(SITE, other);

		await expect(removeCachedDraft(SITE, post.id)).resolves.toBe(true);
		await expect(getCachedDraft(SITE, post.id)).resolves.toBeNull();
		await expect(getCachedDraft(SITE, other.id)).resolves.not.toBeNull();
	});

	it("returns false when the draft is not cached", async () => {
		await expect(removeCachedDraft(SITE, "missing")).resolves.toBe(false);
	});
});

describe("clearSiteDraftCache", () => {
	it("removes every cached draft for a site", async () => {
		await cacheDraft(SITE, makePost({id: "post-1"}));
		await cacheDraft(SITE, makePost({id: "post-2"}));

		await clearSiteDraftCache(SITE);

		await expect(listCachedDrafts(SITE)).resolves.toEqual([]);
		await expect(listPendingPatches(SITE)).resolves.toEqual([]);
	});
});

describe("per-site isolation", () => {
	it("does not leak drafts between publications", async () => {
		await cacheDraft(SITE, makePost({id: "shared", title: "Site A"}));
		await cacheDraft(OTHER_SITE, makePost({id: "shared", title: "Site B"}));
		await cacheDraft(OTHER_SITE, makePost({id: "other-only"}));

		const siteDrafts = await listCachedDrafts(SITE);
		const otherDrafts = await listCachedDrafts(OTHER_SITE);

		expect(siteDrafts.map(draft => draft.postId)).toEqual(["shared"]);
		expect(siteDrafts[0].post.title).toBe("Site A");

		expect(otherDrafts.map(draft => draft.postId).sort()).toEqual([
			"other-only",
			"shared",
		]);
		expect(
			otherDrafts.find(draft => draft.postId === "shared")?.post.title,
		).toBe("Site B");

		await expect(getCachedDraft(OTHER_SITE, "other-only")).resolves.not.toBeNull();
		await expect(getCachedDraft(SITE, "other-only")).resolves.toBeNull();
	});

	it("clearing one site leaves the other site intact", async () => {
		await cacheDraft(SITE, makePost({id: "a"}));
		await cacheDraft(OTHER_SITE, makePost({id: "b"}));

		await clearSiteDraftCache(SITE);

		await expect(listCachedDrafts(SITE)).resolves.toEqual([]);
		await expect(listCachedDrafts(OTHER_SITE)).resolves.toHaveLength(1);
	});
});

describe("Tauri store adapter", () => {
	it("detects the Tauri runtime", () => {
		expect(hasTauriRuntime()).toBe(false);

		vi.stubGlobal("window", {});
		expect(hasTauriRuntime()).toBe(false);

		vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
		expect(hasTauriRuntime()).toBe(true);
	});

	it("persists drafts under the encoded per-site key", async () => {
		vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
		const post = makePost();

		await cacheDraft(SITE, post, {
			dirty: true,
			pendingPatch: {title: "Queued"},
		});

		const stored = storeMock.data.get(storeKey(SITE)) as
			| {postId: string; dirty: boolean}[]
			| undefined;
		expect(stored).toHaveLength(1);
		expect(stored?.[0].postId).toBe(post.id);
		expect(stored?.[0].dirty).toBe(true);
	});

	it("reads and normalizes drafts from the store", async () => {
		vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
		storeMock.data.set(storeKey(SITE), [
			{
				postId: "post-1",
				siteBase: SITE,
				post: makePost(),
				cachedAt: "2026-02-01T09:00:00.000Z",
				dirty: true,
				pendingPatch: {title: "From disk"},
			},
			{postId: "broken"},
			null,
		]);

		const drafts = await listCachedDrafts(SITE);
		expect(drafts).toHaveLength(1);
		expect(drafts[0].postId).toBe("post-1");
		expect(drafts[0].pendingPatch).toEqual({title: "From disk"});
	});

	it("deletes the store key when a site cache is cleared", async () => {
		vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
		await cacheDraft(SITE, makePost());
		expect(storeMock.data.has(storeKey(SITE))).toBe(true);

		await clearSiteDraftCache(SITE);

		expect(storeMock.deleted).toContain(storeKey(SITE));
		expect(storeMock.data.has(storeKey(SITE))).toBe(false);
		await expect(listCachedDrafts(SITE)).resolves.toEqual([]);
	});
});

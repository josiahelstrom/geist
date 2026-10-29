import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {PostDetail, Site} from "./api";

const mockState = vi.hoisted(() => ({
	requests: [] as {url: string; init: RequestInit}[],
	responder: ((_url: string, _init?: RequestInit) => ({
		posts: [],
	})) as (url: string, init?: RequestInit) => unknown,
}));

const storeMock = vi.hoisted(() => ({
	data: new Map<string, unknown>(),
	failGet: false,
	snapshots: [] as {key: string; value: unknown}[],
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
			storeMock.snapshots.push({key, value});
		}

		async delete(key: string) {
			storeMock.data.delete(key);
		}

		async save() {
			/* no-op */
		}
	},
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: () => Promise.resolve("minted-jwt"),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
	fetch: (url: string, init: RequestInit) => {
		mockState.requests.push({url, init});
		const result = mockState.responder(url, init) as {
			ok?: boolean;
			status?: number;
			headers?: Headers;
			json?: () => Promise<unknown>;
		};
		const status = result.status ?? 200;
		return Promise.resolve({
			ok: result.ok ?? status < 300,
			status,
			url,
			headers: result.headers ?? new Headers(),
			json: result.json ?? (async () => result),
		} as Response);
	},
}));

import {
	__resetScrapsForTests,
	calculateWordCount,
	clearSiteScraps,
	createInitialScrapLexical,
	createScrap,
	deleteScrap,
	demoteDraftToScrap,
	getScrap,
	listScraps,
	promoteScrapToDraft,
	updateScrap,
	type Scrap,
} from "./scraps";

const SITE = "https://example.com";
const OTHER_SITE = "https://other.example.com";

const GHOST_SITE: Site = {
	base: "https://everywayhuman.com",
	siteUrl: "https://everywayhuman.com/",
	title: "every way human",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

function ghostPost(overrides: Partial<PostDetail> = {}): PostDetail {
	return {
		id: "post-1",
		uuid: "uuid-1",
		title: "Promoted scrap",
		status: "draft",
		updated_at: "2026-01-01T00:00:00.000Z",
		lexical: createInitialScrapLexical("Ghost body"),
		custom_excerpt: "Ghost excerpt",
		...overrides,
	};
}

function requestBody(request: {init: RequestInit}): unknown {
	return JSON.parse(request.init.body as string);
}

function setTime(iso: string): void {
	vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
	vi.useFakeTimers({toFake: ["Date"]});
	setTime("2026-01-01T00:00:00.000Z");
	__resetScrapsForTests();
	mockState.requests.length = 0;
	mockState.responder = () => ({posts: []});
	storeMock.data.clear();
	storeMock.failGet = false;
	storeMock.snapshots.length = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

describe("createScrap / getScrap", () => {
	it("creates a scrap with sensible defaults and persists it", async () => {
		const scrap = await createScrap(SITE);

		expect(scrap.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		expect(scrap.title).toBe("Untitled Scrap");
		expect(scrap.customExcerpt).toBeNull();
		expect(scrap.wordCount).toBe(0);
		expect(scrap.createdAt).toBe("2026-01-01T00:00:00.000Z");
		expect(scrap.updatedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(scrap.promotedPostId).toBeNull();

		const document = JSON.parse(scrap.lexical);
		expect(document.root.type).toBe("root");
		expect(document.root.children).toHaveLength(1);

		await expect(getScrap(SITE, scrap.id)).resolves.toEqual(scrap);
	});

	it("accepts a title, initial content, and excerpt", async () => {
		const lexical = createInitialScrapLexical("One two three four");
		const scrap = await createScrap(SITE, {
			title: "Morning pages",
			lexical,
			customExcerpt: "A short excerpt",
		});

		expect(scrap.title).toBe("Morning pages");
		expect(scrap.lexical).toBe(lexical);
		expect(scrap.customExcerpt).toBe("A short excerpt");
		expect(scrap.wordCount).toBe(4);
	});

	it("returns null for an unknown scrap", async () => {
		await expect(getScrap(SITE, "missing-id")).resolves.toBeNull();
	});

	it("keeps scraps isolated per publication", async () => {
		const scrap = await createScrap(SITE, {title: "Example only"});

		await expect(getScrap(OTHER_SITE, scrap.id)).resolves.toBeNull();
		await expect(listScraps(OTHER_SITE)).resolves.toEqual([]);
	});
});

describe("listScraps", () => {
	it("sorts by updatedAt newest first", async () => {
		setTime("2026-01-01T00:00:00.000Z");
		const oldest = await createScrap(SITE, {title: "Oldest"});

		setTime("2026-01-01T00:01:00.000Z");
		const middle = await createScrap(SITE, {title: "Middle"});

		setTime("2026-01-01T00:02:00.000Z");
		const newest = await createScrap(SITE, {title: "Newest"});

		const scraps = await listScraps(SITE);

		expect(scraps.map(scrap => scrap.id)).toEqual([
			newest.id,
			middle.id,
			oldest.id,
		]);
	});

	it("moves an updated scrap to the top", async () => {
		setTime("2026-01-01T00:00:00.000Z");
		const first = await createScrap(SITE, {title: "First"});

		setTime("2026-01-01T00:01:00.000Z");
		const second = await createScrap(SITE, {title: "Second"});

		setTime("2026-01-01T00:02:00.000Z");
		await updateScrap(SITE, first.id, {title: "First, edited"});

		const scraps = await listScraps(SITE);

		expect(scraps.map(scrap => scrap.id)).toEqual([first.id, second.id]);
	});

	it("filters by title case-insensitively", async () => {
		await createScrap(SITE, {title: "Garden plans"});
		await createScrap(SITE, {title: "Kitchen notes"});

		const results = await listScraps(SITE, "GARDEN");

		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("Garden plans");
	});

	it("filters by body text", async () => {
		await createScrap(SITE, {
			title: "Errands",
			lexical: createInitialScrapLexical("Buy oat milk and coffee"),
		});
		await createScrap(SITE, {
			title: "Reading",
			lexical: createInitialScrapLexical("Finish the novel"),
		});

		const results = await listScraps(SITE, "oat milk");

		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("Errands");
	});

	it("filters by custom excerpt and ignores surrounding whitespace", async () => {
		await createScrap(SITE, {
			title: "Trip",
			customExcerpt: "Coastal drive",
		});
		await createScrap(SITE, {title: "Groceries"});

		const results = await listScraps(SITE, "  coastal  ");

		expect(results.map(scrap => scrap.title)).toEqual(["Trip"]);
	});

	it("returns every scrap for an empty query and none for a missing term", async () => {
		await createScrap(SITE, {title: "Alpha"});
		await createScrap(SITE, {title: "Beta"});

		await expect(listScraps(SITE)).resolves.toHaveLength(2);
		await expect(listScraps(SITE, "   ")).resolves.toHaveLength(2);
		await expect(listScraps(SITE, "gamma")).resolves.toEqual([]);
	});
});

describe("updateScrap", () => {
	it("updates fields, recalculates wordCount, and bumps updatedAt", async () => {
		const scrap = await createScrap(SITE, {title: "Draft"});

		setTime("2026-01-02T03:04:05.000Z");
		const updated = await updateScrap(SITE, scrap.id, {
			title: "Final",
			lexical: createInitialScrapLexical("Five words in this scrap"),
			customExcerpt: "Excerpt",
		});

		expect(updated.title).toBe("Final");
		expect(updated.customExcerpt).toBe("Excerpt");
		expect(updated.wordCount).toBe(5);
		expect(updated.createdAt).toBe(scrap.createdAt);
		expect(updated.updatedAt).toBe("2026-01-02T03:04:05.000Z");

		await expect(getScrap(SITE, scrap.id)).resolves.toEqual(updated);
	});

	it("preserves fields that are not part of the patch", async () => {
		const lexical = createInitialScrapLexical("Keep this body");
		const scrap = await createScrap(SITE, {
			title: "Original",
			lexical,
			customExcerpt: "Original excerpt",
		});

		const updated = await updateScrap(SITE, scrap.id, {title: "Renamed"});

		expect(updated.lexical).toBe(lexical);
		expect(updated.customExcerpt).toBe("Original excerpt");
		expect(updated.wordCount).toBe(3);
	});

	it("allows clearing the custom excerpt", async () => {
		const scrap = await createScrap(SITE, {
			title: "Note",
			customExcerpt: "Remove me",
		});

		const updated = await updateScrap(SITE, scrap.id, {
			customExcerpt: null,
		});

		expect(updated.customExcerpt).toBeNull();
	});

	it("throws when the scrap does not exist", async () => {
		await expect(
			updateScrap(SITE, "missing-id", {title: "Nope"}),
		).rejects.toThrow(/Scrap not found/);
	});
});

describe("deleteScrap", () => {
	it("removes an existing scrap and reports deletion", async () => {
		const scrap = await createScrap(SITE, {title: "Temporary"});
		await createScrap(SITE, {title: "Keep me"});

		await expect(deleteScrap(SITE, scrap.id)).resolves.toBe(true);
		await expect(getScrap(SITE, scrap.id)).resolves.toBeNull();

		const remaining = await listScraps(SITE);
		expect(remaining.map(item => item.title)).toEqual(["Keep me"]);
	});

	it("returns false when the scrap is already gone", async () => {
		await expect(deleteScrap(SITE, "missing-id")).resolves.toBe(false);
	});
});

describe("promoteScrapToDraft", () => {
	it("creates a Ghost draft and deletes the scrap by default", async () => {
		mockState.responder = (_url, init) =>
			init?.method === "DELETE"
				? {status: 204}
				: {posts: [ghostPost()]};

		const lexical = createInitialScrapLexical("Promote this scrap");
		const scrap = await createScrap(GHOST_SITE.base, {
			title: "My scrap",
			lexical,
			customExcerpt: "Scrap excerpt",
		});

		const post = await promoteScrapToDraft(GHOST_SITE, scrap.id);

		const createRequest = mockState.requests.find(
			request => request.init.method === "POST",
		);
		expect(createRequest).toBeDefined();
		expect(createRequest?.url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/?formats=lexical",
		);
		expect(requestBody(createRequest!)).toEqual({
			posts: [
				{
					title: "My scrap",
					lexical,
					custom_excerpt: "Scrap excerpt",
					status: "draft",
				},
			],
		});

		expect(
			mockState.requests.some(
				request => request.init.method === "DELETE",
			),
		).toBe(false);
		expect(mockState.requests).toHaveLength(1);

		expect(post).toEqual(ghostPost());
		await expect(getScrap(GHOST_SITE.base, scrap.id)).resolves.toBeNull();
	});

	it("keeps the scrap and records promotedPostId when asked", async () => {
		mockState.responder = () => ({posts: [ghostPost({id: "post-42"})]});

		const scrap = await createScrap(GHOST_SITE.base, {title: "Keep me"});
		const post = await promoteScrapToDraft(GHOST_SITE, scrap.id, {
			deleteScrapAfter: false,
		});

		expect(post.id).toBe("post-42");
		expect(mockState.requests).toHaveLength(1);
		expect(mockState.requests[0].init.method).toBe("POST");

		const stored = await getScrap(GHOST_SITE.base, scrap.id);
		expect(stored).not.toBeNull();
		expect(stored?.promotedPostId).toBe("post-42");
		expect(stored?.title).toBe("Keep me");
	});

	it("reuses the linked draft instead of creating a duplicate on retry", async () => {
		mockState.responder = (_url, init) =>
			init?.method === "POST"
				? {posts: [ghostPost({id: "post-new"})]}
				: {posts: [ghostPost({id: "post-existing"})]};

		const scrap = await createScrap(GHOST_SITE.base, {title: "Retry me"});
		await updateScrap(GHOST_SITE.base, scrap.id, {
			promotedPostId: "post-existing",
		});

		const post = await promoteScrapToDraft(GHOST_SITE, scrap.id, {
			deleteScrapAfter: false,
		});

		expect(post.id).toBe("post-existing");
		expect(
			mockState.requests.some(
				request => request.init.method === "POST",
			),
		).toBe(false);
	});

	it("creates a fresh draft when the linked post is gone", async () => {
		mockState.responder = (_url, init) => {
			if (init?.method === "POST") {
				return {posts: [ghostPost({id: "post-new"})]};
			}
			return {
				ok: false,
				status: 404,
				json: async () => ({
					errors: [
						{code: "NOT_FOUND", message: "Post not found"},
					],
				}),
			};
		};

		const scrap = await createScrap(GHOST_SITE.base, {
			title: "Retry me",
		});
		await updateScrap(GHOST_SITE.base, scrap.id, {
			promotedPostId: "post-deleted",
		});

		const post = await promoteScrapToDraft(GHOST_SITE, scrap.id, {
			deleteScrapAfter: false,
		});

		expect(post.id).toBe("post-new");
		expect(
			mockState.requests.filter(
				request => request.init.method === "POST",
			),
		).toHaveLength(1);

		const stored = await getScrap(GHOST_SITE.base, scrap.id);
		expect(stored?.promotedPostId).toBe("post-new");
	});

	it("sends no newsletter, email_segment, or html fields", async () => {
		mockState.responder = () => ({posts: [ghostPost()]});
		const scrap = await createScrap(GHOST_SITE.base, {title: "Safe"});

		await promoteScrapToDraft(GHOST_SITE, scrap.id);

		const raw = (mockState.requests[0].init.body as string).toLowerCase();
		expect(raw).not.toContain("newsletter");
		expect(raw).not.toContain("email_segment");
		expect(raw).not.toContain('"html"');
	});

	it("throws when the scrap does not exist and makes no API calls", async () => {
		await expect(
			promoteScrapToDraft(GHOST_SITE, "missing-id"),
		).rejects.toThrow(/Scrap not found/);

		expect(mockState.requests).toHaveLength(0);
	});
});

describe("demoteDraftToScrap", () => {
	it("creates a local scrap and deletes the Ghost draft", async () => {
		mockState.responder = () => ({status: 204});

		const lexical = createInitialScrapLexical("Back to local notes");
		const post = ghostPost({
			id: "post-7",
			title: "Draft title",
			lexical,
			custom_excerpt: "Draft excerpt",
		});

		const scrap = await demoteDraftToScrap(GHOST_SITE, post);

		expect(scrap.title).toBe("Draft title");
		expect(scrap.lexical).toBe(lexical);
		expect(scrap.customExcerpt).toBe("Draft excerpt");
		expect(scrap.wordCount).toBe(4);

		await expect(getScrap(GHOST_SITE.base, scrap.id)).resolves.toEqual(scrap);

		expect(mockState.requests).toHaveLength(1);
		expect(mockState.requests[0].init.method).toBe("DELETE");
		expect(mockState.requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/post-7/",
		);
	});

	it("rejects published posts without touching Ghost", async () => {
		await expect(
			demoteDraftToScrap(GHOST_SITE, ghostPost({status: "published"})),
		).rejects.toThrow(/draft/i);

		expect(mockState.requests).toHaveLength(0);
		await expect(listScraps(GHOST_SITE.base)).resolves.toEqual([]);
	});

	it("rejects scheduled posts without touching Ghost", async () => {
		await expect(
			demoteDraftToScrap(GHOST_SITE, ghostPost({status: "scheduled"})),
		).rejects.toThrow(/draft/i);

		expect(mockState.requests).toHaveLength(0);
		await expect(listScraps(GHOST_SITE.base)).resolves.toEqual([]);
	});
});

describe("calculateWordCount", () => {
	it("counts words in plain text", () => {
		expect(calculateWordCount("Hello world")).toBe(2);
		expect(calculateWordCount("  spaced   out\nwords\there  ")).toBe(4);
		expect(calculateWordCount("One, two! Three?")).toBe(3);
	});

	it("returns zero for empty or whitespace-only input", () => {
		expect(calculateWordCount("")).toBe(0);
		expect(calculateWordCount("   \n\t ")).toBe(0);
	});

	it("extracts words from Lexical JSON", () => {
		const lexical = createInitialScrapLexical(
			"First paragraph has four words\nSecond paragraph has four",
		);

		expect(calculateWordCount(lexical)).toBe(9);
	});

	it("treats malformed JSON as plain text", () => {
		expect(calculateWordCount("{not valid json")).toBe(3);
	});

	it("ignores formatting nodes and only counts visible text", () => {
		const lexical = JSON.stringify({
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{type: "text", text: "Bold", format: 1},
							{type: "text", text: " and plain", format: 0},
						],
					},
				],
			},
		});

		expect(calculateWordCount(lexical)).toBe(3);
	});
});

describe("local store resilience", () => {
	function enableTauriRuntime() {
		vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
	}

	function storedScrap(id: string) {
		return {
			id,
			title: "On disk",
			lexical: createInitialScrapLexical("Stored body"),
			customExcerpt: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			wordCount: 2,
			promotedPostId: null,
		};
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("retries the disk read after a failure instead of caching an empty list", async () => {
		enableTauriRuntime();
		const key = `scraps_${encodeURIComponent(SITE)}`;
		storeMock.data.set(key, [storedScrap("scrap-1")]);
		storeMock.failGet = true;

		await expect(listScraps(SITE)).rejects.toThrow(/store unavailable/);

		storeMock.failGet = false;
		const scraps = await listScraps(SITE);

		expect(scraps.map(scrap => scrap.id)).toEqual(["scrap-1"]);
		expect(storeMock.data.get(key)).toEqual([storedScrap("scrap-1")]);
	});

	it("refuses to overwrite stored scraps when the disk read fails", async () => {
		enableTauriRuntime();
		const key = `scraps_${encodeURIComponent(SITE)}`;
		const existing = storedScrap("scrap-1");
		storeMock.data.set(key, [existing]);
		storeMock.failGet = true;

		await expect(createScrap(SITE, {title: "New"})).rejects.toThrow(
			/store unavailable/,
		);

		expect(storeMock.data.get(key)).toEqual([existing]);
		expect(storeMock.snapshots).toHaveLength(0);
	});

	it("links the scrap to the new draft before deleting it", async () => {
		enableTauriRuntime();
		mockState.responder = () => ({posts: [ghostPost({id: "post-99"})]});

		const scrap = await createScrap(GHOST_SITE.base, {title: "Promoted"});
		await promoteScrapToDraft(GHOST_SITE, scrap.id);

		const writes = storeMock.snapshots
			.filter(snapshot => snapshot.key === `scraps_${encodeURIComponent(GHOST_SITE.base)}`)
			.map(snapshot => snapshot.value as Scrap[]);

		// The create, the link update, and finally the removal.
		expect(writes).toHaveLength(3);
		expect(writes[1].map(item => item.promotedPostId)).toEqual(["post-99"]);
		expect(writes[2]).toEqual([]);
	});
	it("clears only the forgotten site's scraps", async () => {
		enableTauriRuntime();
		const siteKey = `scraps_${encodeURIComponent(SITE)}`;
		const otherKey = `scraps_${encodeURIComponent(OTHER_SITE)}`;

		await createScrap(SITE, {title: "Forget me"});
		await createScrap(OTHER_SITE, {title: "Keep me"});
		expect(storeMock.data.has(siteKey)).toBe(true);
		expect(storeMock.data.has(otherKey)).toBe(true);

		await clearSiteScraps(SITE);

		expect(storeMock.data.has(siteKey)).toBe(false);
		expect(storeMock.data.has(otherKey)).toBe(true);
		await expect(listScraps(SITE)).resolves.toEqual([]);
		await expect(listScraps(OTHER_SITE)).resolves.toHaveLength(1);
	});
});

describe("createInitialScrapLexical", () => {
	it("creates valid Lexical JSON for empty content", () => {
		const document = JSON.parse(createInitialScrapLexical());

		expect(document.root.type).toBe("root");
		expect(document.root.children).toHaveLength(1);
		expect(document.root.children[0].type).toBe("paragraph");
		expect(document.root.children[0].children).toEqual([]);
	});

	it("splits initial text into paragraphs and preserves the words", () => {
		const lexical = createInitialScrapLexical("First line\nSecond line");
		const document = JSON.parse(lexical);

		expect(document.root.children).toHaveLength(2);
		expect(document.root.children[0].children[0].text).toBe("First line");
		expect(document.root.children[1].children[0].text).toBe("Second line");
		expect(calculateWordCount(lexical)).toBe(4);
	});

	it("normalizes CRLF input", () => {
		const lexical = createInitialScrapLexical("First\r\nSecond");
		const document = JSON.parse(lexical);

		expect(document.root.children).toHaveLength(2);
		expect(document.root.children[1].children[0].text).toBe("Second");
	});
});

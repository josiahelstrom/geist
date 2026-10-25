import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Site} from "./api";

const calls: {path: string; init?: RequestInit}[] = [];
let responder: (path: string, init?: RequestInit) => unknown = () => ({});

vi.mock("./api", () => ({
	api: async (_site: Site, path: string, init?: RequestInit) => {
		calls.push({path, init});
		const r = responder(path, init);
		if (r instanceof Error) {
			throw r;
		}
		return r;
	},
}));

const {
	parseSettings,
	loadSiteSettings,
	listSnippets,
	saveSnippet,
	removeSnippet,
	fetchLabels,
	nqlString,
	searchLinks,
	fetchAutocompleteLinks,
	buildCardConfig,
	EMPTY_MOBILEDOC,
	DEFAULT_SETTINGS,
} = await import("./cardConfig");

const SITE: Site = {
	base: "https://example.com",
	siteUrl: "https://example.com/",
	title: "Example",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

beforeEach(() => {
	calls.length = 0;
	responder = () => ({});
});

describe("settings", () => {
	it("reads members, stripe and description", () => {
		const s = parseSettings([
			{key: "members_signup_access", value: "all"},
			{key: "paid_members_enabled", value: true},
			{key: "description", value: "A site"},
		]);
		expect(s).toEqual({
			loaded: true,
			membersEnabled: true,
			stripeEnabled: true,
			siteDescription: "A site",
			feature: {transistor: false, paywallImprovements: false},
		});
	});

	it("reads transistor and labs feature flags", () => {
		const s = parseSettings([
			{key: "transistor", value: true},
			{key: "labs", value: JSON.stringify({paywallImprovements: true})},
		]);
		expect(s.feature).toEqual({
			transistor: true,
			paywallImprovements: true,
		});
	});

	it("accepts string booleans and an object labs value", () => {
		const s = parseSettings([
			{key: "transistor", value: "true"},
			{key: "labs", value: {paywallImprovements: "true"}},
		]);
		expect(s.feature).toEqual({
			transistor: true,
			paywallImprovements: true,
		});
	});

	it("ignores malformed labs values without failing settings", () => {
		const s = parseSettings([
			{key: "transistor", value: false},
			{key: "labs", value: "{not json"},
		]);
		expect(s.loaded).toBe(true);
		expect(s.feature).toEqual({
			transistor: false,
			paywallImprovements: false,
		});
	});

	it("trusts the computed paid_members_enabled over the connect account id", () => {
		const s = parseSettings([
			{key: "members_signup_access", value: "all"},
			{key: "paid_members_enabled", value: false},
			{key: "stripe_connect_account_id", value: "acct_1"},
		]);
		expect(s.stripeEnabled).toBe(false);
	});

	it("treats signup access 'none' as members disabled, and stripe with it", () => {
		const s = parseSettings([
			{key: "members_signup_access", value: "none"},
			{key: "stripe_connect_account_id", value: "acct_1"},
		]);
		expect(s.membersEnabled).toBe(false);
		expect(s.stripeEnabled).toBe(false);
	});

	it("falls back to defaults when settings cannot be read", async () => {
		responder = () => new Error("403");
		expect(await loadSiteSettings(SITE)).toEqual(DEFAULT_SETTINGS);
	});
});

describe("snippets", () => {
	it("asks Ghost for the lexical format (the default is mobiledoc only)", async () => {
		await listSnippets(SITE);
		expect(calls[0].path).toContain("formats=lexical");
	});

	it("maps lexical to a string value and skips mobiledoc-only snippets", async () => {
		responder = () => ({
			snippets: [
				{id: "1", name: "A", lexical: '{"nodes":[]}', updated_at: "T"},
				{id: "2", name: "B", lexical: {nodes: []}},
				{id: "3", name: "Old", lexical: null},
			],
		});
		const out = await listSnippets(SITE);
		expect(out.map(s => s.id)).toEqual(["1", "2"]);
		expect(out[1].value).toBe('{"nodes":[]}');
	});

	it("creates a new snippet with POST", async () => {
		await saveSnippet(SITE, [], {name: "N", value: "{}"});
		expect(calls[0].path).toBe("/snippets/");
		expect(calls[0].init?.method).toBe("POST");
		expect(JSON.parse(calls[0].init!.body as string)).toEqual({
			snippets: [{name: "N", mobiledoc: EMPTY_MOBILEDOC, lexical: "{}"}],
		});
	});

	it("updates the snippet with the same name with PUT", async () => {
		await saveSnippet(
			SITE,
			[{id: "9", name: "N", value: "{}", updatedAt: "T1"}],
			{name: "N", value: '{"x":1}'},
		);
		expect(calls[0].path).toBe("/snippets/9/");
		expect(calls[0].init?.method).toBe("PUT");
		// Ghost's schema forbids any field beyond name/mobiledoc/lexical.
		expect(JSON.parse(calls[0].init!.body as string).snippets[0]).toEqual({
			name: "N",
			mobiledoc: EMPTY_MOBILEDOC,
			lexical: '{"x":1}',
		});
	});

	it("deletes by id", async () => {
		await removeSnippet(SITE, {id: "9", name: "N", value: "{}"});
		expect(calls[0].path).toBe("/snippets/9/");
		expect(calls[0].init?.method).toBe("DELETE");
	});
});

describe("labels", () => {
	it("returns names only", async () => {
		responder = () => ({labels: [{name: "VIP"}, {name: "Beta"}]});
		expect(await fetchLabels(SITE)).toEqual(["VIP", "Beta"]);
	});

	it("returns [] on failure", async () => {
		responder = () => new Error("403");
		expect(await fetchLabels(SITE)).toEqual([]);
	});
});

describe("links", () => {
	it("escapes quotes and backslashes in NQL", () => {
		expect(nqlString("it's a\\b")).toBe("'it\\'s a\\\\b'");
	});

	it("offers the homepage and latest posts with no term", async () => {
		responder = () => ({
			posts: [{title: "Hello", url: "https://example.com/hello/", published_at: "2026-01-02T00:00:00Z"}],
		});
		const groups = await searchLinks(SITE);
		expect(groups[0]).toEqual({
			label: "Site",
			items: [{title: "Homepage", url: "https://example.com/"}],
		});
		expect(groups[1].label).toBe("Latest posts");
		expect(groups[1].items[0].url).toBe("https://example.com/hello/");
	});

	it("searches posts, pages and tags and drops empty groups", async () => {
		responder = path =>
			path.startsWith("/posts/")
				? {posts: [{title: "Foo", url: "https://example.com/foo/"}]}
				: path.startsWith("/tags/")
					? {tags: [{name: "foo", url: "https://example.com/tag/foo/"}]}
					: {pages: []};
		const groups = await searchLinks(SITE, "foo");
		expect(groups.map(g => g.label)).toEqual(["Posts", "Tags"]);
		const postCall = calls.find(c => c.path.startsWith("/posts/"))!;
		expect(decodeURIComponent(postCall.path)).toContain(
			"filter=status:published+title:~'foo'",
		);
	});

	it("survives a failing endpoint", async () => {
		responder = () => new Error("500");
		expect(await searchLinks(SITE, "foo")).toEqual([]);
	});

	it("builds autocomplete links with prefixes", async () => {
		responder = path =>
			path.startsWith("/posts/")
				? {posts: [{title: "P", url: "https://example.com/p/"}]}
				: path.startsWith("/pages/")
					? {pages: [{title: "About", url: "https://example.com/about/"}]}
					: {tags: []};
		const out = await fetchAutocompleteLinks(SITE);
		expect(out).toEqual([
			{label: "Homepage", value: "https://example.com/"},
			{label: "Post: P", value: "https://example.com/p/"},
			{label: "Page: About", value: "https://example.com/about/"},
		]);
	});
});

describe("buildCardConfig", () => {
	const loaded = {
		loaded: true,
		membersEnabled: true,
		stripeEnabled: false,
		siteDescription: "Desc",
		feature: {transistor: true, paywallImprovements: false},
	};

	it("exposes snippets and labels to staff keys", () => {
		const cfg = buildCardConfig(SITE, {
			settings: loaded,
			snippets: [],
			onSnippetsChanged: () => {},
		}) as Record<string, unknown>;
		expect(cfg.siteDescription).toBe("Desc");
		expect(cfg.feature).toEqual({
			transistor: true,
			paywallImprovements: false,
		});
		expect(cfg.visibilitySettings).toBe("web and email");
		expect(typeof cfg.createSnippet).toBe("function");
		expect(typeof cfg.deleteSnippet).toBe("function");
		expect(cfg.renderLabels).toBe(true);
		expect(typeof cfg.fetchLabels).toBe("function");
	});

	it("hides staff-only controls from integration keys", () => {
		const cfg = buildCardConfig(
			{...SITE, keyKind: "integration"},
			{settings: loaded, snippets: [], onSnippetsChanged: () => {}},
		) as Record<string, unknown>;
		expect(cfg.createSnippet).toBeUndefined();
		expect(cfg.snippets).toBeUndefined();
		expect(cfg.renderLabels).toBeUndefined();
	});

	it("leaves visibility at Koenig's default when settings failed to load", () => {
		const cfg = buildCardConfig(SITE, {
			settings: DEFAULT_SETTINGS,
			snippets: [],
			onSnippetsChanged: () => {},
		}) as Record<string, unknown>;
		expect("visibilitySettings" in cfg).toBe(false);
	});

	it("turns visibility off when members are disabled", () => {
		const cfg = buildCardConfig(SITE, {
			settings: {...loaded, membersEnabled: false},
			snippets: [],
			onSnippetsChanged: () => {},
		}) as Record<string, unknown>;
		expect(cfg.visibilitySettings).toBe("none");
		expect(cfg.renderLabels).toBeUndefined();
	});

	it("refreshes snippets after create and delete", async () => {
		const changed = vi.fn();
		const cfg = buildCardConfig(SITE, {
			settings: loaded,
			snippets: [],
			onSnippetsChanged: changed,
		}) as {
			createSnippet: (s: {name: string; value: string}) => Promise<void>;
			deleteSnippet: (s: {id: string; name: string; value: string}) => Promise<void>;
		};
		await cfg.createSnippet({name: "N", value: "{}"});
		await cfg.deleteSnippet({id: "1", name: "N", value: "{}"});
		expect(changed).toHaveBeenCalledTimes(2);
	});
});

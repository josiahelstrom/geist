import {describe, expect, it, vi} from "vitest";
import type {Post, Site} from "./api";

const requests: {url: string; init: RequestInit}[] = [];
const invoked: {cmd: string; args: unknown}[] = [];
let responder: (url: string) => unknown = () => ({
	posts: [{status: "published", updated_at: "T2"}],
});

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string, args: unknown) => {
		invoked.push({cmd, args});
		return Promise.resolve("minted-jwt");
	},
}));

vi.mock("@tauri-apps/plugin-http", () => ({
	fetch: (url: string, init: RequestInit) => {
		requests.push({url, init});
		const r = responder(url) as {
			ok?: boolean;
			status?: number;
			headers?: Headers;
			json?: () => Promise<unknown>;
		};
		const status = r.status ?? 200;
		return Promise.resolve({
			ok: r.ok ?? status < 300,
			status,
			url,
			headers: r.headers ?? new Headers(),
			json: r.json ?? (async () => r),
		} as Response);
	},
}));

const {
	setPostStatus,
	createDraft,
	deletePost,
	previewUrl,
	openInAppPreview,
	fetchEmbed,
	canPublishRole,
	canEditAuthorsRole,
	canEditVisibilityRole,
	serializeTagsForSave,
	serializeTiersForSave,
	buildNewsletterQuery,
	publishWithNewsletter,
	schedulePost,
	unschedulePost,
	filterPosts,
} = await import("./posts");

const SITE: Site = {
	base: "https://everywayhuman.com",
	siteUrl: "https://everywayhuman.com/",
	title: "every way human",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

function body(i = 0) {
	return JSON.parse(requests[i].init.body as string);
}

describe("publish safety (rule 4.2)", () => {
	it("sends only status and updated_at", async () => {
		requests.length = 0;
		await setPostStatus(SITE, "p1", "T1", "published");

		expect(requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p1/",
		);
		expect(requests[0].url).not.toContain("newsletter");
		expect(requests[0].url).not.toContain("email_segment");
		expect(body().posts).toEqual([{status: "published", updated_at: "T1"}]);
	});

	it("never puts newsletter or email_segment in the body", async () => {
		requests.length = 0;
		await setPostStatus(SITE, "p1", "T1", "published");
		const raw = (requests[0].init.body as string).toLowerCase();
		expect(raw).not.toContain("newsletter");
		expect(raw).not.toContain("email_segment");

		requests.length = 0;
		await setPostStatus(SITE, "p1", "T1", "draft");
		expect((requests[0].init.body as string).toLowerCase()).not.toContain(
			"newsletter",
		);
	});

	it("never sends html or source=html (rule 4.3)", async () => {
		requests.length = 0;
		await setPostStatus(SITE, "p1", "T1", "published");
		expect(requests[0].init.body as string).not.toContain("html");
		expect(requests[0].url).not.toContain("source");
	});

	it("does not follow redirects (rule 4.5)", async () => {
		requests.length = 0;
		await setPostStatus(SITE, "p1", "T1", "published");
		expect(
			(requests[0].init as {maxRedirections?: number}).maxRedirections,
		).toBe(0);
	});

	it("returns the server's new status", async () => {
		responder = () => ({
			posts: [{status: "draft", updated_at: "T9"}],
		});
		const result = await setPostStatus(SITE, "p1", "T1", "draft");
		expect(result.status).toBe("draft");
		responder = () => ({posts: [{status: "published", updated_at: "T2"}]});
	});

	it("surfaces a permission error from the server", async () => {
		responder = () => ({
			ok: false,
			status: 403,
			headers: new Headers(),
			json: async () => ({
				errors: [
					{code: "NO_PERMISSION", message: "You do not have permission"},
				],
			}),
		});
		await expect(
			setPostStatus(SITE, "p1", "T1", "published"),
		).rejects.toThrow(/permission/);

		responder = () => ({
			ok: false,
			status: 403,
			headers: new Headers(),
			json: async () => ({}),
		});
		await expect(setPostStatus(SITE, "p1", "T1", "published")).rejects.toThrow(
			/HTTP 403/,
		);
		responder = () => ({posts: [{status: "published", updated_at: "T2"}]});
	});
});

describe("newsletter publish, scheduling & visibility (v0.4)", () => {
	it("allows visibility edits for everyone but Contributors and Authors", () => {
		expect(canEditVisibilityRole("Contributor")).toBe(false);
		expect(canEditVisibilityRole("Author")).toBe(false);
		expect(canEditVisibilityRole("Editor")).toBe(true);
		expect(canEditVisibilityRole("Administrator")).toBe(true);
		expect(canEditVisibilityRole("Owner")).toBe(true);
		expect(canEditVisibilityRole(undefined)).toBe(true);
	});

	it("serializes tiers by trimmed, deduplicated id", () => {
		expect(
			serializeTiersForSave([
				{id: "t1"},
				{id: "  t1  "},
				{id: ""},
				{},
				{id: "t2"},
			]),
		).toEqual([{id: "t1"}, {id: "t2"}]);
	});

	it("builds no query when no newsletter is selected", () => {
		expect(buildNewsletterQuery()).toBe("");
		expect(buildNewsletterQuery("")).toBe("");
		expect(buildNewsletterQuery("   ")).toBe("");
	});

	it("builds the newsletter query and omits the all segment", () => {
		expect(buildNewsletterQuery("weekly")).toBe("?newsletter=weekly");
		expect(buildNewsletterQuery("weekly", "all")).toBe("?newsletter=weekly");
		expect(buildNewsletterQuery("weekly", "status:free")).toBe(
			"?newsletter=weekly&email_segment=status%3Afree",
		);
		expect(buildNewsletterQuery("weekly", "status:-free")).toBe(
			"?newsletter=weekly&email_segment=status%3A-free",
		);
		expect(buildNewsletterQuery("a b", "status:free")).toBe(
			"?newsletter=a%20b&email_segment=status%3Afree",
		);
	});

	it("publishes with a newsletter and confirmed recipient count", async () => {
		requests.length = 0;
		responder = () => ({
			posts: [{status: "published", updated_at: "T9"}],
		});
		const result = await publishWithNewsletter(SITE, "p1", "T1", {
			newsletterSlug: "weekly",
			emailSegment: "status:free",
			confirmedRecipientCount: 120,
		});
		expect(requests[0].init.method).toBe("PUT");
		expect(requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p1/?newsletter=weekly&email_segment=status%3Afree",
		);
		expect(body().posts).toEqual([
			{status: "published", updated_at: "T1"},
		]);
		expect(result.status).toBe("published");
		responder = () => ({posts: [{status: "published", updated_at: "T2"}]});
	});

	it("adds email_only when publishing email-only", async () => {
		requests.length = 0;
		await publishWithNewsletter(SITE, "p2", "T1", {
			newsletterSlug: "weekly",
			emailOnly: true,
			confirmedRecipientCount: 0,
		});
		expect(requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p2/?newsletter=weekly",
		);
		expect(body().posts).toEqual([
			{status: "published", email_only: true, updated_at: "T1"},
		]);
	});

	it("refuses to publish without a newsletter or a confirmed count", async () => {
		requests.length = 0;
		await expect(
			publishWithNewsletter(SITE, "p1", "T1", {
				newsletterSlug: "   ",
				confirmedRecipientCount: 1,
			}),
		).rejects.toThrow(/newsletter/i);
		await expect(
			publishWithNewsletter(SITE, "p1", "T1", {
				newsletterSlug: "weekly",
				confirmedRecipientCount: -1,
			}),
		).rejects.toThrow(/recipient count/i);
		await expect(
			publishWithNewsletter(SITE, "p1", "T1", {
				newsletterSlug: "weekly",
				confirmedRecipientCount: 1.5,
			}),
		).rejects.toThrow(/recipient count/i);
		expect(requests).toHaveLength(0);
	});

	it("schedules a post in the future", async () => {
		requests.length = 0;
		const when = new Date(Date.now() + 86_400_000);
		const result = await schedulePost(SITE, "p1", "T1", {
			publishedAt: when.toISOString(),
			newsletterSlug: "weekly",
			emailSegment: "status:-free",
		});
		expect(requests[0].init.method).toBe("PUT");
		expect(requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p1/?newsletter=weekly&email_segment=status%3A-free",
		);
		expect(body().posts).toEqual([
			{
				status: "scheduled",
				published_at: when.toISOString(),
				updated_at: "T1",
			},
		]);
		expect(result.status).toBe("published");
	});

	it("adds email_only for email-only schedules", async () => {
		requests.length = 0;
		const when = new Date(Date.now() + 86_400_000).toISOString();
		await schedulePost(SITE, "p1", "T1", {
			publishedAt: when,
			newsletterSlug: "weekly",
			emailOnly: true,
		});
		expect(body().posts).toEqual([
			{
				status: "scheduled",
				published_at: when,
				email_only: true,
				updated_at: "T1",
			},
		]);
	});

	it("rejects invalid and past dates, and email-only without a newsletter", async () => {
		requests.length = 0;
		await expect(
			schedulePost(SITE, "p1", "T1", {publishedAt: "not-a-date"}),
		).rejects.toThrow(/valid publish date/i);
		await expect(
			schedulePost(SITE, "p1", "T1", {
				publishedAt: new Date(Date.now() - 60_000).toISOString(),
			}),
		).rejects.toThrow(/future/i);
		await expect(
			schedulePost(SITE, "p1", "T1", {
				publishedAt: new Date(Date.now() + 86_400_000).toISOString(),
				emailOnly: true,
			}),
		).rejects.toThrow(/newsletter/i);
		expect(requests).toHaveLength(0);
	});

	it("unschedules a post back to draft", async () => {
		requests.length = 0;
		const result = await unschedulePost(SITE, "p1", "T1");
		expect(requests[0].init.method).toBe("PUT");
		expect(requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p1/",
		);
		expect(body().posts).toEqual([
			{
				status: "draft",
				published_at: null,
				email_only: false,
				updated_at: "T1",
			},
		]);
		expect(result.status).toBe("published");
	});
});

describe("createDraft & deletePost", () => {
	it("creates a draft and returns the fields the list needs", async () => {
		requests.length = 0;
		responder = () => ({
			posts: [
				{
					id: "abc",
					uuid: "u-1",
					title: "",
					slug: "untitled",
					status: "draft",
					updated_at: "T1",
				},
			],
		});
		const post = await createDraft(SITE);
		expect(requests[0].init.method).toBe("POST");
		expect(body().posts).toEqual([{title: "", status: "draft"}]);
		expect(post).toEqual({
			id: "abc",
			uuid: "u-1",
			title: "",
			slug: "untitled",
			status: "draft",
			updated_at: "T1",
		});
	});

	it("deletes a post by id", async () => {
		requests.length = 0;
		responder = () => ({status: 204, ok: true});
		await deletePost(SITE, "post-99");
		expect(requests[0].init.method).toBe("DELETE");
		expect(requests[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/post-99/",
		);
		responder = () => ({posts: [{status: "published", updated_at: "T2"}]});
	});
});

describe("previewUrl & openInAppPreview (plan §9 & §12)", () => {
	it("builds the draft preview path", () => {
		expect(previewUrl("https://everywayhuman.com/", "uuid-1")).toBe(
			"https://everywayhuman.com/p/uuid-1/",
		);
	});

	it("keeps a subdirectory install working", () => {
		expect(previewUrl("https://example.com/blog/", "u")).toBe(
			"https://example.com/blog/p/u/",
		);
	});

	it("supports ?member_status=free|paid|anonymous toggles", () => {
		expect(previewUrl("https://everywayhuman.com/", "u1", "free")).toBe(
			"https://everywayhuman.com/p/u1/?member_status=free",
		);
		expect(previewUrl("https://everywayhuman.com/", "u1", "paid")).toBe(
			"https://everywayhuman.com/p/u1/?member_status=paid",
		);
		expect(previewUrl("https://everywayhuman.com/", "u1", "anonymous")).toBe(
			"https://everywayhuman.com/p/u1/?member_status=anonymous",
		);
	});

	it("opens the isolated preview WebviewWindow via Rust command", async () => {
		invoked.length = 0;
		await openInAppPreview(
			"https://everywayhuman.com/",
			"uuid-42",
			"My Post",
			"paid",
		);
		expect(invoked).toContainEqual({
			cmd: "open_preview_window",
			args: {
				url: "https://everywayhuman.com/p/uuid-42/?member_status=paid",
				title: "My Post",
			},
		});
	});
});

describe("role rules & metadata helpers", () => {
	it("hides publish for Contributors only", () => {
		expect(canPublishRole("Contributor")).toBe(false);
		expect(canPublishRole("Author")).toBe(true);
		expect(canPublishRole("Editor")).toBe(true);
		expect(canPublishRole("Owner")).toBe(true);
		expect(canPublishRole(undefined)).toBe(true);
	});

	it("restricts author reassignment for Contributors and Authors", () => {
		expect(canEditAuthorsRole("Contributor")).toBe(false);
		expect(canEditAuthorsRole("Author")).toBe(false);
		expect(canEditAuthorsRole("Editor")).toBe(true);
		expect(canEditAuthorsRole("Administrator")).toBe(true);
		expect(canEditAuthorsRole("Owner")).toBe(true);
		expect(canEditAuthorsRole(undefined)).toBe(true);
	});

	it("deduplicates and normalizes tags for saving", () => {
		const out = serializeTagsForSave([
			{id: "t1", name: "Essay", slug: "essay"},
			{name: "  essay  "},
			{name: "New Tag"},
			{name: "   "},
		]);
		expect(out).toEqual([
			{id: "t1", name: "Essay", slug: "essay"},
			{name: "New Tag"},
		]);
	});
});

describe("filterPosts (v0.2 search/filter)", () => {
	const sample: Post[] = [
		{
			id: "1",
			uuid: "u1",
			title: "The opportunity to wait",
			slug: "the-opportunity-to-wait",
			status: "draft",
			featured: true,
			custom_excerpt: "Patience in a hurried season.",
			updated_at: "2026-10-14T12:00:00.000Z",
			tags: [{id: "t1", name: "Reflections", slug: "reflections"}],
			authors: [{id: "a1", name: "Josiah Elstrom", slug: "josiah"}],
		},
		{
			id: "2",
			uuid: "u2",
			title: "Notes on software craft",
			slug: "software-craft",
			status: "published",
			featured: false,
			custom_excerpt: "Building small desktop tools.",
			updated_at: "2026-10-15T12:00:00.000Z",
			tags: [{id: "t2", name: "Coding", slug: "coding"}],
			authors: [{id: "a2", name: "Ada Lovelace", slug: "ada"}],
		},
	];

	it("filters by query across title, slug, excerpt, tag, and author", () => {
		expect(filterPosts(sample, {query: "opportunity"})).toHaveLength(1);
		expect(filterPosts(sample, {query: "software-craft"})).toHaveLength(1);
		expect(filterPosts(sample, {query: "hurried"})).toHaveLength(1);
		expect(filterPosts(sample, {query: "reflections"})).toHaveLength(1);
		expect(filterPosts(sample, {query: "lovelace"})).toHaveLength(1);
		expect(filterPosts(sample, {query: "nonexistent"})).toHaveLength(0);
	});

	it("filters by tagSlug and featuredOnly", () => {
		expect(filterPosts(sample, {tagSlug: "coding"})).toEqual([sample[1]]);
		expect(filterPosts(sample, {featuredOnly: true})).toEqual([sample[0]]);
		expect(
			filterPosts(sample, {tagSlug: "coding", featuredOnly: true}),
		).toHaveLength(0);
	});
});

describe("fetchEmbed", () => {
	it("escapes the url and asks for the right type", async () => {
		requests.length = 0;
		await fetchEmbed(SITE, "https://youtube.com/watch?v=a&b=c", "embed");
		expect(requests[0].url).toContain(
			"url=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3Da%26b%3Dc",
		);
		expect(requests[0].url).toContain("type=embed");
		expect(requests[0].url).toContain("/oembed/");
	});

	it("requests bookmark metadata when asked", async () => {
		requests.length = 0;
		await fetchEmbed(SITE, "https://example.com", "bookmark");
		expect(requests[0].url).toContain("type=bookmark");
	});
});

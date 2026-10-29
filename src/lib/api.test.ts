import {beforeEach, describe, expect, it, vi} from "vitest";

const calls: {cmd: string; args: unknown}[] = [];

let invokeResult: unknown = "minted-jwt";

vi.mock("@tauri-apps/api/core", () => ({
	invoke: (cmd: string, args: unknown) => {
		calls.push({cmd, args});
		return Promise.resolve(invokeResult);
	},
}));

const fetchCalls: {url: string; init: RequestInit & {maxRedirections?: number}}[] =
	[];

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		url: "",
		headers: new Headers(headers),
		json: async () => body,
	} as unknown as Response;
}

vi.mock("@tauri-apps/plugin-http", () => ({
	fetch: (url: string, init: RequestInit) => {
		fetchCalls.push({url, init});
		// The /site/ probe and the authenticated calls are separate requests;
		// tests set `probeResponse` for the former and `authResponse` for the rest.
		if (url.endsWith("/site/")) {
			return Promise.resolve(probeResponse);
		}
		return Promise.resolve(currentResponse);
	},
}));

let currentResponse: Response = jsonResponse(200, {});
let probeResponse: Response = jsonResponse(200, {});

import {
	api,
	GhostError,
	connect,
	fetchSite,
	loginWithPassword,
	normalizeBase,
	fetchPost,
	listSiteTiers,
	listActiveNewsletters,
	resend2faCode,
	rotateStaffToken,
	verify2faCode,
	type Site,
} from "./api";

const SITE: Site = {
	base: "https://everywayhuman.com",
	siteUrl: "https://everywayhuman.com/",
	title: "every way human",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

beforeEach(() => {
	calls.length = 0;
	fetchCalls.length = 0;
	invokeResult = "minted-jwt";
	currentResponse = jsonResponse(200, {});
});

describe("normalizeBase", () => {
	it("defaults to https", () => {
		expect(normalizeBase("example.com")).toBe("https://example.com");
	});
	it("strips /ghost", () => {
		expect(normalizeBase("https://example.com/ghost")).toBe("https://example.com");
	});
	it("strips a deep ghost admin path", () => {
		expect(normalizeBase("https://example.com/ghost/#/editor/post/abc")).toBe(
			"https://example.com",
		);
	});
	it("strips trailing slashes", () => {
		expect(normalizeBase("https://example.com///")).toBe("https://example.com");
	});
	it("keeps a subdirectory install", () => {
		expect(normalizeBase("https://example.com/blog/ghost")).toBe(
			"https://example.com/blog",
		);
	});
});

describe("api", () => {
	it("signs with a Ghost token and asks for v6.0", async () => {
		await api(SITE, "/posts/");
		const call = fetchCalls[0];
		const headers = call.init.headers as Headers;
		expect(headers.get("Authorization")).toBe("Ghost minted-jwt");
		expect(headers.get("Accept-Version")).toBe("v6.0");
		expect(calls[0].cmd).toBe("get_jwt");
		expect(calls[0].args).toEqual({
			base: SITE.base,
			clockOffsetSecs: SITE.clockOffset,
		});
	});

	it("never follows redirects on an authenticated call (rule 4.5)", async () => {
		await api(SITE, "/posts/");
		expect(fetchCalls[0].init.maxRedirections).toBe(0);
	});

	it("builds the admin URL from the stored base", async () => {
		await api(SITE, "/posts/?limit=5");
		expect(fetchCalls[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/?limit=5",
		);
	});

	it("sets JSON content type for a JSON body but not for FormData", async () => {
		await api(SITE, "/posts/", {
			method: "PUT",
			body: JSON.stringify({posts: []}),
		});
		expect((fetchCalls[0].init.headers as Headers).get("Content-Type")).toBe(
			"application/json",
		);

		fetchCalls.length = 0;
		await api(SITE, "/images/upload/", {method: "POST", body: new FormData()});
		expect(
			(fetchCalls[0].init.headers as Headers).get("Content-Type"),
		).toBeNull();
	});

	it("returns null for a 204", async () => {
		currentResponse = jsonResponse(204, {});
		expect(await api(SITE, "/posts/abc/", {method: "DELETE"})).toBeNull();
	});

	it("surfaces the server's error code and message", async () => {
		currentResponse = jsonResponse(403, {
			errors: [{code: "NO_SUBSCRIBERS", message: "nope"}],
		});
		await expect(api(SITE, "/posts/")).rejects.toMatchObject({
			status: 403,
			code: "NO_SUBSCRIBERS",
			message: "nope",
		});
	});

	it("turns a redirect into a reconnect message (rule 4.5)", async () => {
		currentResponse = {
			ok: false,
			status: 301,
			url: "",
			headers: new Headers({location: "https://new.example.com"}),
			json: async () => ({}),
		} as unknown as Response;
		await expect(api(SITE, "/posts/")).rejects.toThrow(/Reconnect/);
	});
});

describe("fetchers", () => {
	it("fetchPost asks for lexical plus tiers, newsletter, and revisions", async () => {
		currentResponse = jsonResponse(200, {
			posts: [
				{
					id: "p1",
					uuid: "u1",
					title: "Hello",
					status: "draft",
					updated_at: "T1",
					lexical: "{}",
				},
			],
		});
		const post = await fetchPost(SITE, "p1");
		expect(post.id).toBe("p1");
		expect(fetchCalls[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p1/?formats=lexical&include=tags,authors,tiers,newsletter,post_revisions,post_revisions.author",
		);
		expect(fetchCalls[0].init.method).toBeUndefined();
	});

	it("listSiteTiers returns only active paid tiers", async () => {
		currentResponse = jsonResponse(200, {
			tiers: [
				{id: "t1", name: "Free", slug: "free", type: "free", active: true},
				{id: "t2", name: "Gold", slug: "gold", type: "paid", active: true},
				{id: "t3", name: "Old", slug: "old", type: "paid", active: false},
			],
		});
		const tiers = await listSiteTiers(SITE);
		expect(fetchCalls[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/tiers/?limit=all",
		);
		expect(tiers).toEqual([
			{id: "t2", name: "Gold", slug: "gold", type: "paid", active: true},
		]);
	});

	it("listSiteTiers returns [] when the request fails", async () => {
		currentResponse = jsonResponse(403, {
			errors: [{code: "NO_PERMISSION", message: "nope"}],
		});
		expect(await listSiteTiers(SITE)).toEqual([]);
	});

	it("listActiveNewsletters asks for active newsletters with member counts", async () => {
		currentResponse = jsonResponse(200, {
			newsletters: [
				{
					id: "n1",
					name: "Weekly",
					slug: "weekly",
					status: "active",
					count: {active_members: 42},
				},
			],
		});
		const newsletters = await listActiveNewsletters(SITE);
		expect(fetchCalls[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/newsletters/?filter=status:active&include=count.active_members&limit=all",
		);
		expect(newsletters[0].count?.active_members).toBe(42);
	});

	it("listActiveNewsletters returns [] when there is no field or on error", async () => {
		currentResponse = jsonResponse(200, {});
		expect(await listActiveNewsletters(SITE)).toEqual([]);

		currentResponse = jsonResponse(500, {
			errors: [{code: "UNKNOWN", message: "boom"}],
		});
		expect(await listActiveNewsletters(SITE)).toEqual([]);
	});
});

describe("connect", () => {
	function defaultProbe(overrides: Partial<Response> = {}) {
		return {
			ok: true,
			status: 200,
			url: "https://everywayhuman.com/ghost/api/admin/site/",
			headers: new Headers({
				date: new Date(Date.now() + 60_000).toUTCString(),
			}),
			json: async () => ({
				site: {
					title: "every way human",
					url: "https://everywayhuman.com/",
					version: "6.68",
				},
			}),
			...overrides,
		} as unknown as Response;
	}

	beforeEach(() => {
		probeResponse = defaultProbe();
		currentResponse = jsonResponse(200, {
			users: [{name: "Josiah", roles: [{name: "Owner"}]}],
		});
	});

	it("stores the key and resolves the admin base", async () => {
		const site = await connect("everywayhuman.com", "abc:deadbeef");
		expect(fetchCalls[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/site/",
		);
		expect(calls.map(c => c.cmd)).toContain("save_key");
		expect(site.base).toBe("https://everywayhuman.com");
		expect(site.version).toBe("6.68");
	});

	it("measures clock skew from the Date header", async () => {
		const site = await connect("everywayhuman.com", "abc:deadbeef");
		// The stubbed Date header is 60s in the future.
		expect(site.clockOffset).toBeGreaterThanOrEqual(55);
		expect(site.clockOffset).toBeLessThanOrEqual(65);
	});

	it("detects a staff key via /users/me/", async () => {
		currentResponse = jsonResponse(200, {
			users: [{name: "Josiah", roles: [{name: "Owner"}]}],
		});
		const site = await connect("everywayhuman.com", "abc:deadbeef");
		expect(site.keyKind).toBe("staff");
		expect(site.role).toBe("Owner");
	});

	it("treats a 404 from /users/me/ as an integration key", async () => {
		currentResponse = jsonResponse(404, {
			errors: [{code: "NOT_FOUND", message: "not found"}],
		});
		const site = await connect("everywayhuman.com", "abc:deadbeef");
		expect(site.keyKind).toBe("integration");
		expect(site.role).toBeUndefined();
	});

	it("cleans up the key when the key is rejected (401)", async () => {
		currentResponse = jsonResponse(401, {
			errors: [{code: "INVALID_JWT", message: "Invalid token"}],
		});
		await expect(connect("everywayhuman.com", "abc:dead")).rejects.toThrow(
			"Invalid token",
		);
		expect(calls.map(c => c.cmd)).toContain("delete_key");
	});

	it("reports a non-Ghost address clearly", async () => {
		probeResponse = jsonResponse(404, {});
		await expect(connect("example.com", "abc:deadbeef")).rejects.toThrow(
			/Couldn't find a Ghost site/,
		);
	});
});

describe("password auth commands", () => {
	it("loginWithPassword forwards the credentials once", async () => {
		invokeResult = {
			status: "Success",
			key_kind: "staff",
			staff_id: "staff-1",
		};
		const result = await loginWithPassword(
			"https://everywayhuman.com",
			"josiah@example.com",
			"hunter2",
		);
		expect(result).toEqual({
			status: "Success",
			key_kind: "staff",
			staff_id: "staff-1",
		});
		expect(calls).toEqual([
			{
				cmd: "login_with_password",
				args: {
					url: "https://everywayhuman.com",
					email: "josiah@example.com",
					password: "hunter2",
				},
			},
		]);
	});

	it("returns a pending 2FA challenge", async () => {
		invokeResult = {
			status: "Needs2FA",
			pending_id: "pending-1",
			email: "josiah@example.com",
			message: "We emailed a verification code.",
		};
		const result = await loginWithPassword(
			"everywayhuman.com",
			"josiah@example.com",
			"hunter2",
		);
		expect(result.status).toBe("Needs2FA");
	});

	it("verify2faCode sends the pending id and code", async () => {
		invokeResult = {
			status: "Success",
			key_kind: "staff",
			staff_id: "staff-1",
		};
		await verify2faCode("pending-1", "123456");
		expect(calls[0]).toEqual({
			cmd: "verify_2fa_code",
			args: {pendingId: "pending-1", code: "123456"},
		});
	});

	it("resend2faCode resolves without a value", async () => {
		invokeResult = null;
		await expect(resend2faCode("pending-1")).resolves.toBeUndefined();
		expect(calls[0]).toEqual({
			cmd: "resend_2fa_code",
			args: {pendingId: "pending-1"},
		});
	});

	it("rotateStaffToken returns the new token id", async () => {
		invokeResult = "staff-2";
		await expect(
			rotateStaffToken("https://everywayhuman.com", 42),
		).resolves.toBe("staff-2");
		expect(calls[0]).toEqual({
			cmd: "rotate_staff_token",
			args: {base: "https://everywayhuman.com", clockOffset: 42},
		});
	});
});

describe("fetchSite", () => {
	beforeEach(() => {
		probeResponse = {
			ok: true,
			status: 200,
			url: "https://everywayhuman.com/ghost/api/admin/site/",
			headers: new Headers({
				date: new Date(Date.now() + 60_000).toUTCString(),
			}),
			json: async () => ({
				site: {
					title: "every way human",
					url: "https://everywayhuman.com/",
					version: "6.68",
				},
			}),
		} as unknown as Response;
		currentResponse = jsonResponse(200, {
			users: [{name: "Josiah", roles: [{name: "Owner"}]}],
		});
	});

	it("resolves site metadata without saving a key", async () => {
		const site = await fetchSite({
			url: "everywayhuman.com",
			keyKind: "staff",
		});
		expect(site.base).toBe("https://everywayhuman.com");
		expect(site.title).toBe("every way human");
		expect(site.version).toBe("6.68");
		expect(site.keyKind).toBe("staff");
		expect(site.role).toBe("Owner");
		expect(calls.map(c => c.cmd)).not.toContain("save_key");
	});

	it("honors explicit title and role overrides without probing /users/me/", async () => {
		const site = await fetchSite({
			title: "My publication",
			url: "everywayhuman.com",
			role: "Editor",
			keyKind: "staff",
		});
		expect(site.title).toBe("My publication");
		expect(site.role).toBe("Editor");
		expect(fetchCalls).toHaveLength(1);
	});

	it("keeps going when the role lookup fails", async () => {
		currentResponse = jsonResponse(403, {
			errors: [{code: "NO_PERMISSION", message: "nope"}],
		});
		const site = await fetchSite({url: "everywayhuman.com"});
		expect(site.base).toBe("https://everywayhuman.com");
		expect(site.role).toBeUndefined();
	});
});

describe("GhostError", () => {
	it("falls back to a status message when the body is not JSON", async () => {
		const res = {
			ok: false,
			status: 500,
			headers: new Headers(),
			json: async () => {
				throw new Error("not json");
			},
		} as unknown as Response;
		const err = await GhostError.from(res);
		expect(err.message).toBe("HTTP 500");
		expect(err.code).toBeUndefined();
	});
});
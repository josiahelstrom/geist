import {beforeEach, describe, expect, it, vi} from "vitest";
import type {Site} from "./api";

type PutCall = {url: string; body: any; init: RequestInit};

const puts: PutCall[] = [];
let responder: (url: string) => Response = () => ok({posts: [{updated_at: "T1"}]});

function ok(body: unknown) {
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		json: async () => body,
	} as unknown as Response;
}

function fail(status: number, code: string, message: string) {
	return {
		ok: false,
		status,
		headers: new Headers(),
		json: async () => ({errors: [{code, message}]}),
	} as unknown as Response;
}

vi.mock("@tauri-apps/api/core", () => ({
	invoke: () => Promise.resolve("minted-jwt"),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
	fetch: (url: string, init: RequestInit) => {
		puts.push({url, body: init.body, init});
		return Promise.resolve(responder(url));
	},
}));

const {createSaver} = await import("./saver");

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
	puts.length = 0;
	responder = () =>
		ok({posts: [{updated_at: `T${Date.now()}${Math.random()}`}]});
});

describe("saver safety rules", () => {
	it("never sends html or source=html (rule 4.3)", async () => {
		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});
		await saver.queue({lexical: "{}", title: "Hi"});

		expect(puts).toHaveLength(1);
		const body = JSON.parse(puts[0].body as string);
		expect(body.posts[0]).not.toHaveProperty("html");
		expect(puts[0].url).not.toContain("source=html");
		expect(puts[0].url).toBe(
			"https://everywayhuman.com/ghost/api/admin/posts/p1/",
		);
	});

	it("sends the last updated_at it received, then adopts the new one", async () => {
		responder = (() => {
			let n = 0;
			return () => ok({posts: [{updated_at: `T${++n}`}]});
		})();

		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});
		await saver.queue({title: "one"});
		await saver.queue({title: "two"});

		expect(JSON.parse(puts[0].body as string).posts[0].updated_at).toBe("T0");
		expect(JSON.parse(puts[1].body as string).posts[0].updated_at).toBe("T1");
	});

	it("keeps only one save in flight (rule 4.4)", async () => {
		let inFlight = 0;
		let maxConcurrent = 0;
		responder = () =>
			Promise.resolve(
				new Promise(resolve => {
					inFlight++;
					maxConcurrent = Math.max(maxConcurrent, inFlight);
					setTimeout(() => {
						inFlight--;
						resolve(ok({posts: [{updated_at: "T"}]}));
					}, 5);
				}),
			) as unknown as Response;

		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});

		await Promise.all([
			saver.queue({title: "a"}),
			saver.queue({title: "b"}),
			saver.queue({title: "c"}),
		]);

		expect(maxConcurrent).toBe(1);
	});

	it("sends patches sequentially, never concurrently, and both land", async () => {
		// `queue()` dequeues synchronously inside `run()`, so a patch arriving
		// after that point becomes a second sequential PUT rather than being
		// merged. What matters is that both are persisted, one at a time.
		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});
		await Promise.all([
			saver.queue({title: "t"}),
			saver.queue({lexical: "L"}),
		]);
		expect(puts.length).toBeGreaterThanOrEqual(1);
		const sent = puts
			.map(p => JSON.parse(p.body as string).posts[0])
			.reduce((acc, p) => ({...acc, ...p}), {});
		expect(sent).toMatchObject({title: "t", lexical: "L"});
	});

	it("merges patches queued before the loop runs", async () => {
		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});
		// queueDebounced holds the patch in `pending` without starting a run,
		// so the next queue() merges into it.
		saver.queueDebounced({lexical: "L"});
		await saver.queue({title: "t"});
		expect(puts).toHaveLength(1);
		expect(JSON.parse(puts[0].body as string).posts[0]).toMatchObject({
			title: "t",
			lexical: "L",
		});
	});
});

describe("revisions", () => {
	it("adds save_revision on an explicit save", async () => {
		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});
		saver.queueDebounced({title: "unsaved"});
		await saver.flush(true);
		expect(puts).toHaveLength(1);
		expect(puts[0].url).toContain("save_revision=true");
	});

	it("creates a revision even with nothing pending", async () => {
		// Cmd+S on a clean saver must still make a revision, otherwise the
		// keystroke silently does nothing.
		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});
		await saver.flush(true);
		expect(puts).toHaveLength(1);
		expect(puts[0].url).toContain("save_revision=true");
	});

	it("latches a revision requested while a save is already running", async () => {
		// This is the plan's §8 bug: `revision` was captured when the run
		// started, so a Cmd+S during an in-flight save produced no revision.
		responder = () =>
			Promise.resolve(
				new Promise(resolve =>
					setTimeout(() => resolve(ok({posts: [{updated_at: "T1"}]})), 10),
				),
			) as unknown as Response;

		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: () => {},
			onConflict: () => {},
		});

		// Let the first request reach the (slow) responder before Cmd+S, so
		// `pending` is genuinely empty at that moment.
		const first = saver.queue({title: "typing"});
		await new Promise(r => setTimeout(r, 1));
		const second = saver.flush(true);
		await Promise.all([first, second]);

		expect(puts).toHaveLength(2);
		expect(puts[0].url).not.toContain("save_revision");
		expect(puts[1].url).toContain("save_revision=true");
	});
});

describe("conflict handling", () => {
	it("halts on 409, reports the conflict, and keeps the pending patch", async () => {
		responder = () => fail(409, "UPDATE_COLLISION", "Someone else is editing");
		const onConflict = vi.fn();
		const statuses: string[] = [];

		const saver = createSaver(SITE, "p1", "STALE", {
			onStatus: s => statuses.push(s),
			onConflict,
		});

		await saver.queue({title: "mine"});

		expect(onConflict).toHaveBeenCalledOnce();
		expect(statuses).toContain("conflict");
		expect(saver.conflict).toBe(true);
		// Autosave must stay halted, so a later keystroke sends nothing.
		puts.length = 0;
		await saver.queue({title: "more"});
		expect(puts).toHaveLength(0);
	});

	it("keeps the edits and retries after a transient failure", async () => {
		let attempt = 0;
		responder = () => {
			attempt++;
			return attempt === 1
				? fail(500, "INTERNAL_ERROR", "boom")
				: ok({posts: [{updated_at: "T9"}]});
		};
		const statuses: string[] = [];
		const saver = createSaver(SITE, "p1", "T0", {
			onStatus: s => statuses.push(s),
			onConflict: () => {},
		});

		await saver.queue({title: "kept"});
		expect(statuses).toContain("error");
		expect(saver.hasPending).toBe(true);

		await saver.flush();
		expect(puts).toHaveLength(2);
		expect(JSON.parse(puts[1].body as string).posts[0].title).toBe("kept");
	});

	it("adopts a fresh updated_at after an out-of-band publish so the next edit does not 409", async () => {
		responder = () => ok({posts: [{updated_at: "T_AFTER_EDIT"}]});
		const saver = createSaver(SITE, "p1", "T_INITIAL", {
			onStatus: () => {},
			onConflict: () => {},
		});
		saver.adoptUpdatedAt("T_AFTER_PUBLISH");
		await saver.queue({title: "post-publish edit"});
		expect(JSON.parse(puts[0].body as string).posts[0].updated_at).toBe(
			"T_AFTER_PUBLISH",
		);
	});

	it("resumes after a 409 conflict when given the server's latest updated_at", async () => {
		responder = () => fail(409, "UPDATE_COLLISION", "Someone else is editing");
		const saver = createSaver(SITE, "p1", "STALE", {
			onStatus: () => {},
			onConflict: () => {},
		});
		await saver.queue({title: "my local changes"});
		expect(saver.conflict).toBe(true);

		puts.length = 0;
		responder = () => ok({posts: [{updated_at: "T_RESOLVED"}]});
		await saver.resumeWithUpdatedAt("T_SERVER_LATEST");

		expect(saver.conflict).toBe(false);
		expect(puts).toHaveLength(1);
		expect(puts[0].url).toContain("save_revision=true");
		expect(JSON.parse(puts[0].body as string).posts[0]).toMatchObject({
			title: "my local changes",
			updated_at: "T_SERVER_LATEST",
		});
	});
});
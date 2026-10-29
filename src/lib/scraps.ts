import {LazyStore} from "@tauri-apps/plugin-store";
import {GhostError, createPost, fetchPost} from "./api";
import type {PostDetail, Site} from "./api";
import {deletePost} from "./posts";
import {extractLexicalPlainText} from "./revisions";

/**
 * A local-first writing scrap. Scraps are stored per publication so notes stay
 * organized by blog and never touch the Ghost API until they are promoted.
 */
export type Scrap = {
	id: string; // uuid v4 or crypto.randomUUID()
	title: string;
	lexical: string; // Lexical JSON string representing scrap content
	customExcerpt?: string | null;
	createdAt: string; // ISO timestamp
	updatedAt: string; // ISO timestamp
	wordCount: number;
	// Optional link tracking back to a promoted Ghost draft post id
	promotedPostId?: string | null;
};

const DEFAULT_TITLE = "Untitled Scrap";
const STORE_FILE = "scraps.json";

/**
 * In-memory mirror used outside the Tauri runtime (Node/Vitest, browser dev)
 * and as a safety net if a Tauri store operation fails mid-session.
 */
const memoryStore = new Map<string, Scrap[]>();

/** Serializes mutations per site so concurrent creates cannot clobber each other. */
const siteQueues = new Map<string, Promise<void>>();

let lazyStore: LazyStore | null = null;
let lazyStoreUnavailable = false;

function hasTauriRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const candidate = window as unknown as Record<string, unknown>;
	return (
		"__TAURI_INTERNALS__" in candidate || "__TAURI__" in candidate
	);
}

function getStore(): LazyStore | null {
	if (!hasTauriRuntime() || lazyStoreUnavailable) {
		return null;
	}
	if (!lazyStore) {
		try {
			lazyStore = new LazyStore(STORE_FILE);
		} catch {
			lazyStoreUnavailable = true;
			return null;
		}
	}
	return lazyStore;
}

function storageKey(siteBase: string): string {
	return `scraps_${encodeURIComponent(siteBase)}`;
}

function cloneScrap(scrap: Scrap): Scrap {
	return {...scrap};
}

function runExclusive<T>(
	siteBase: string,
	task: () => Promise<T>,
): Promise<T> {
	const key = storageKey(siteBase);
	const previous = siteQueues.get(key) ?? Promise.resolve();
	const result = previous.then(task, task);
	const tail = result.then(
		() => undefined,
		() => undefined,
	);
	siteQueues.set(key, tail);
	void tail.then(() => {
		if (siteQueues.get(key) === tail) {
			siteQueues.delete(key);
		}
	});
	return result;
}

function createId(): string {
	const maybeCrypto = globalThis.crypto as Crypto | undefined;
	if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
		return maybeCrypto.randomUUID();
	}

	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
		const random = Math.floor(Math.random() * 16);
		const value = char === "x" ? random : (random & 0x3) | 0x8;
		return value.toString(16);
	});
}

function isLexicalDocument(
	value: unknown,
): value is {root: unknown} {
	return (
		typeof value === "object" &&
		value !== null &&
		"root" in value &&
		(value as {root?: unknown}).root !== null &&
		typeof (value as {root?: unknown}).root === "object"
	);
}

/**
 * Extracts readable text from either a Lexical JSON document or a plain-text
 * string and counts whitespace-delimited words. Malformed JSON is treated as
 * plain text so callers never have to guard the input.
 */
export function calculateWordCount(textOrLexical: string): number {
	if (typeof textOrLexical !== "string" || textOrLexical.trim() === "") {
		return 0;
	}

	let text = textOrLexical;
	try {
		const parsed: unknown = JSON.parse(textOrLexical);
		if (isLexicalDocument(parsed)) {
			text = extractLexicalPlainText(textOrLexical);
		}
	} catch {
		/* Treat non-JSON input as plain text. */
	}

	const trimmed = text.trim();
	return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

type LexicalTextNode = {
	type: "text";
	text: string;
	format: number;
	style: string;
	mode: "normal";
	detail: number;
	version: 1;
};

type LexicalParagraphNode = {
	type: "paragraph";
	version: 1;
	format: string;
	indent: number;
	direction: string;
	children: LexicalTextNode[];
};

/**
 * Builds minimal, valid Lexical JSON for a new scrap. Each input line becomes
 * a paragraph, which keeps pasted notes readable in the Ghost editor.
 */
export function createInitialScrapLexical(initialText?: string): string {
	const normalized = (initialText ?? "").replace(/\r\n?/g, "\n");
	const lines = normalized === "" ? [""] : normalized.split("\n");

	const children: LexicalParagraphNode[] = lines.map(line => ({
		type: "paragraph",
		version: 1,
		format: "",
		indent: 0,
		direction: "ltr",
		children:
			line === ""
				? []
				: [
						{
							type: "text",
							text: line,
							format: 0,
							style: "",
							mode: "normal",
							detail: 0,
							version: 1,
						},
					],
	}));

	return JSON.stringify({
		root: {
			type: "root",
			format: "",
			indent: 0,
			version: 1,
			direction: "ltr",
			children,
		},
	});
}

function normalizeScrap(value: unknown): Scrap | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || record.id === "") {
		return null;
	}

	const lexical =
		typeof record.lexical === "string"
			? record.lexical
			: createInitialScrapLexical();
	const createdAt =
		typeof record.createdAt === "string"
			? record.createdAt
			: new Date(0).toISOString();
	const updatedAt =
		typeof record.updatedAt === "string" ? record.updatedAt : createdAt;

	return {
		id: record.id,
		title:
			typeof record.title === "string" ? record.title : DEFAULT_TITLE,
		lexical,
		customExcerpt:
			typeof record.customExcerpt === "string"
				? record.customExcerpt
				: null,
		createdAt,
		updatedAt,
		wordCount:
			typeof record.wordCount === "number" &&
			Number.isFinite(record.wordCount)
				? record.wordCount
				: calculateWordCount(lexical),
		promotedPostId:
			typeof record.promotedPostId === "string"
				? record.promotedPostId
				: null,
	};
}

function normalizeScraps(value: unknown): Scrap[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const scraps: Scrap[] = [];
	for (const entry of value) {
		const scrap = normalizeScrap(entry);
		if (scrap) {
			scraps.push(scrap);
		}
	}
	return scraps;
}

async function readScraps(siteBase: string): Promise<Scrap[]> {
	const key = storageKey(siteBase);
	const cached = memoryStore.get(key);
	if (cached) {
		return cached.map(cloneScrap);
	}

	const store = getStore();
	if (!store) {
		memoryStore.set(key, []);
		return [];
	}

	// Never cache an empty list when the disk read fails: doing so would make
	// every later call serve `[]` from memory and, on the next write, replace
	// the user's scraps on disk with that empty list. Rethrowing keeps the
	// data intact and lets the next call retry the read.
	const stored = await store.get<unknown>(key);
	const scraps = normalizeScraps(stored);
	memoryStore.set(key, scraps);
	return scraps.map(cloneScrap);
}

async function writeScraps(
	siteBase: string,
	scraps: Scrap[],
): Promise<void> {
	const key = storageKey(siteBase);
	const snapshot = scraps.map(cloneScrap);
	memoryStore.set(key, snapshot);

	const store = getStore();
	if (!store) {
		return;
	}

	try {
		await store.set(key, snapshot);
		await store.save();
	} catch {
		/* The in-memory mirror retains the change for this session. */
	}
}

function scrapTimestamp(scrap: Scrap): number {
	const parsed = Date.parse(scrap.updatedAt);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function matchesQuery(scrap: Scrap, query: string): boolean {
	if (!query) {
		return true;
	}
	const haystacks = [
		scrap.title,
		extractLexicalPlainText(scrap.lexical),
		scrap.customExcerpt ?? "",
	];
	return haystacks.some(haystack =>
		haystack.toLowerCase().includes(query),
	);
}

/**
 * Creates and persists a new scrap. Content defaults to an empty Lexical
 * document, and the word count is derived from the stored Lexical JSON.
 */
export async function createScrap(
	siteBase: string,
	draft?: Partial<Pick<Scrap, "title" | "lexical" | "customExcerpt">>,
): Promise<Scrap> {
	return runExclusive(siteBase, async () => {
		const now = new Date().toISOString();
		const lexical = draft?.lexical ?? createInitialScrapLexical();
		const scrap: Scrap = {
			id: createId(),
			title: draft?.title ?? DEFAULT_TITLE,
			lexical,
			customExcerpt: draft?.customExcerpt ?? null,
			createdAt: now,
			updatedAt: now,
			wordCount: calculateWordCount(lexical),
			promotedPostId: null,
		};

		const scraps = await readScraps(siteBase);
		await writeScraps(siteBase, [...scraps, scrap]);
		return cloneScrap(scrap);
	});
}

export async function getScrap(
	siteBase: string,
	id: string,
): Promise<Scrap | null> {
	return runExclusive(siteBase, async () => {
		const scraps = await readScraps(siteBase);
		const scrap = scraps.find(candidate => candidate.id === id);
		return scrap ? cloneScrap(scrap) : null;
	});
}

/**
 * Lists scraps newest-updated first. A query filters case-insensitively across
 * the title, scrap body text, and custom excerpt.
 */
export async function listScraps(
	siteBase: string,
	query?: string,
): Promise<Scrap[]> {
	return runExclusive(siteBase, async () => {
		const scraps = await readScraps(siteBase);
		const normalizedQuery = query?.trim().toLowerCase() ?? "";
		return scraps
			.filter(scrap => matchesQuery(scrap, normalizedQuery))
			.sort((a, b) => scrapTimestamp(b) - scrapTimestamp(a))
			.map(cloneScrap);
	});
}

export async function updateScrap(
	siteBase: string,
	id: string,
	patch: Partial<
		Pick<Scrap, "title" | "lexical" | "customExcerpt" | "promotedPostId">
	>,
): Promise<Scrap> {
	return runExclusive(siteBase, async () => {
		const scraps = await readScraps(siteBase);
		const index = scraps.findIndex(candidate => candidate.id === id);
		if (index === -1) {
			throw new Error(`Scrap not found: ${id}`);
		}

		const current = scraps[index];
		const lexical = patch.lexical ?? current.lexical;
		const updated: Scrap = {
			...current,
			title: patch.title ?? current.title,
			lexical,
			customExcerpt:
				patch.customExcerpt !== undefined
					? patch.customExcerpt
					: current.customExcerpt,
			updatedAt: new Date().toISOString(),
			wordCount: calculateWordCount(lexical),
			promotedPostId:
				patch.promotedPostId !== undefined
					? patch.promotedPostId
					: current.promotedPostId,
		};

		const next = [...scraps];
		next[index] = updated;
		await writeScraps(siteBase, next);
		return cloneScrap(updated);
	});
}

export async function deleteScrap(
	siteBase: string,
	id: string,
): Promise<boolean> {
	return runExclusive(siteBase, async () => {
		const scraps = await readScraps(siteBase);
		const next = scraps.filter(scrap => scrap.id !== id);
		if (next.length === scraps.length) {
			return false;
		}

		await writeScraps(siteBase, next);
		return true;
	});
}

/**
 * Promotes a local scrap into a Ghost draft.
 *
 * By default the scrap is removed once the draft exists, so the writer is not
 * left with two copies of the same text. Pass `deleteScrapAfter: false` to keep
 * the scrap and link it to the new post through `promotedPostId` instead.
 */
export async function promoteScrapToDraft(
	site: Site,
	scrapId: string,
	options?: {deleteScrapAfter?: boolean},
): Promise<PostDetail> {
	const scrap = await getScrap(site.base, scrapId);
	if (!scrap) {
		throw new Error(`Scrap not found: ${scrapId}`);
	}

	const deleteScrapAfter = options?.deleteScrapAfter ?? true;

	// Idempotent retry: a previous promote may have created the draft but
	// failed before the scrap was removed/linked. Reuse that post instead of
	// creating a duplicate on the next attempt.
	if (scrap.promotedPostId) {
		try {
			const existing = await fetchPost(site, scrap.promotedPostId);
			if (existing) {
				if (deleteScrapAfter) {
					await deleteScrap(site.base, scrapId);
				}
				return existing;
			}
		} catch (err) {
			// A 404 means the linked draft was deleted, so it is safe to create
			// a fresh one. Any other failure (offline, auth, server error) must
			// surface instead of risking a duplicate post.
			if (!(err instanceof GhostError && err.status === 404)) {
				throw err;
			}
		}
	}

	const post = await createPost(site, {
		title: scrap.title,
		lexical: scrap.lexical,
		custom_excerpt: scrap.customExcerpt ?? null,
	});

	// Link the scrap to the new draft before deleting it. If the local delete
	// then fails, the scrap keeps pointing at the post that was just created
	// instead of leaving the writer with an unlinked orphan.
	await updateScrap(site.base, scrapId, {promotedPostId: post.id});

	if (deleteScrapAfter) {
		await deleteScrap(site.base, scrapId);
	}

	return post;
}

/**
 * Demotes a Ghost draft back into a local scrap and deletes the remote draft.
 *
 * Safety rule: only drafts can be demoted. Published or scheduled posts have
 * either gone out to readers or are queued to, and deleting them from under the
 * user would be destructive, so those are rejected before any API call.
 */
export async function demoteDraftToScrap(
	site: Site,
	post: PostDetail,
): Promise<Scrap> {
	if (post.status !== "draft") {
		throw new Error(
			`Only draft posts can be demoted to scraps (post "${post.id}" is ${post.status}).`,
		);
	}

	const scrap = await createScrap(site.base, {
		title: post.title ?? undefined,
		lexical: post.lexical,
		customExcerpt: post.custom_excerpt ?? null,
	});

	await deletePost(site, post.id);

	return scrap;
}

/**
 * Removes every scrap for a publication, both from the in-memory mirror and
 * the on-disk store. Used when a site is forgotten so its local notes and any
 * stale state do not linger.
 */
export async function clearSiteScraps(siteBase: string): Promise<void> {
	return runExclusive(siteBase, async () => {
		const key = storageKey(siteBase);
		memoryStore.set(key, []);

		const store = getStore();
		if (!store) {
			return;
		}

		try {
			await store.delete(key);
			await store.save();
		} catch {
			/* The in-memory mirror is already empty for this session. */
		}
	});
}

/**
 * Clears the in-memory mirror. Intended for tests so each case starts with a
 * clean slate; it does not delete data from the Tauri store on disk.
 */
export function __resetScrapsForTests(): void {
	memoryStore.clear();
	siteQueues.clear();
}

import {LazyStore} from "@tauri-apps/plugin-store";
import type {PostDetail} from "./api";

/**
 * A locally cached Ghost draft used by the offline-first editor.
 *
 * Drafts are scoped per publication so two sites can cache posts with the same
 * id without colliding. `dirty` marks a draft that has local edits which have
 * not been pushed to Ghost yet, and `pendingPatch` stores those edits so they
 * can be replayed when the network comes back.
 */
export type CachedDraft = {
	postId: string;
	siteBase: string;
	post: PostDetail;
	cachedAt: string; // ISO timestamp
	dirty: boolean; // whether there are un-synced local edits
	pendingPatch?: Partial<PostDetail> | null;
};

const STORE_FILE = "draft_cache.json";

/**
 * In-memory mirror used outside the Tauri runtime (Node/Vitest, browser dev)
 * and as a safety net if a Tauri store operation fails mid-session.
 */
const memoryStore = new Map<string, CachedDraft[]>();

/** Serializes mutations per site so concurrent writes cannot clobber each other. */
const siteQueues = new Map<string, Promise<void>>();

let lazyStore: LazyStore | null = null;
let lazyStoreUnavailable = false;

/** True when running inside the Tauri shell, where the plugin store is usable. */
export function hasTauriRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const candidate = window as unknown as Record<string, unknown>;
	return "__TAURI_INTERNALS__" in candidate;
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
	return `drafts_${encodeURIComponent(siteBase)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
	if (typeof structuredClone === "function") {
		try {
			return structuredClone(value);
		} catch {
			/* Fall through to the JSON clone below. */
		}
	}
	return JSON.parse(JSON.stringify(value)) as T;
}

function cloneDraft(draft: CachedDraft): CachedDraft {
	return {
		...draft,
		post: cloneValue(draft.post),
		pendingPatch: draft.pendingPatch
			? cloneValue(draft.pendingPatch)
			: draft.pendingPatch ?? null,
	};
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

function normalizeDraft(value: unknown, siteBase: string): CachedDraft | null {
	if (!isRecord(value)) {
		return null;
	}
	if (typeof value.postId !== "string" || value.postId === "") {
		return null;
	}
	if (!isRecord(value.post) || typeof value.post.id !== "string") {
		return null;
	}

	const pendingPatch = isRecord(value.pendingPatch)
		? (value.pendingPatch as Partial<PostDetail>)
		: null;

	return {
		postId: value.postId,
		siteBase:
			typeof value.siteBase === "string" && value.siteBase !== ""
				? value.siteBase
				: siteBase,
		post: value.post as unknown as PostDetail,
		cachedAt:
			typeof value.cachedAt === "string"
				? value.cachedAt
				: new Date(0).toISOString(),
		dirty: value.dirty === true,
		pendingPatch,
	};
}

function normalizeDrafts(value: unknown, siteBase: string): CachedDraft[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const drafts: CachedDraft[] = [];
	for (const entry of value) {
		const draft = normalizeDraft(entry, siteBase);
		if (draft) {
			drafts.push(draft);
		}
	}
	return drafts;
}

async function readDrafts(siteBase: string): Promise<CachedDraft[]> {
	const key = storageKey(siteBase);
	const cached = memoryStore.get(key);
	if (cached) {
		return cached.map(cloneDraft);
	}

	const store = getStore();
	if (!store) {
		memoryStore.set(key, []);
		return [];
	}

	// Never cache an empty list when the disk read fails: doing so would make
	// every later call serve `[]` from memory and, on the next write, replace
	// the cached drafts on disk with that empty list. Rethrowing keeps the data
	// intact and lets the next call retry the read.
	const stored = await store.get<unknown>(key);
	const drafts = normalizeDrafts(stored, siteBase);
	memoryStore.set(key, drafts);
	return drafts.map(cloneDraft);
}

async function writeDrafts(
	siteBase: string,
	drafts: CachedDraft[],
): Promise<void> {
	const key = storageKey(siteBase);
	const snapshot = drafts.map(cloneDraft);
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

function draftTimestamp(draft: CachedDraft): number {
	const parsed = Date.parse(draft.cachedAt);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function hasPendingPatch(draft: CachedDraft): boolean {
	return (
		isRecord(draft.pendingPatch) &&
		Object.keys(draft.pendingPatch).length > 0
	);
}

/**
 * Saves or updates the cached draft for `post.id` under `siteBase`.
 *
 * Passing no options caches a clean copy (no pending local edits). Pass
 * `dirty: true` together with `pendingPatch` to queue unsynced edits.
 */
export async function cacheDraft(
	siteBase: string,
	post: PostDetail,
	options?: {dirty?: boolean; pendingPatch?: Partial<PostDetail>},
): Promise<void> {
	return runExclusive(siteBase, async () => {
		const drafts = await readDrafts(siteBase);
		const cached: CachedDraft = {
			postId: post.id,
			siteBase,
			post: cloneValue(post),
			cachedAt: new Date().toISOString(),
			dirty: options?.dirty ?? false,
			pendingPatch: options?.pendingPatch
				? cloneValue(options.pendingPatch)
				: null,
		};

		const index = drafts.findIndex(draft => draft.postId === post.id);
		const next =
			index === -1
				? [...drafts, cached]
				: drafts.map((draft, current) =>
						current === index ? cached : draft,
					);

		await writeDrafts(siteBase, next);
	});
}

export async function getCachedDraft(
	siteBase: string,
	postId: string,
): Promise<CachedDraft | null> {
	return runExclusive(siteBase, async () => {
		const drafts = await readDrafts(siteBase);
		const draft = drafts.find(candidate => candidate.postId === postId);
		return draft ? cloneDraft(draft) : null;
	});
}

/** Lists cached drafts for a site, newest `cachedAt` first. */
export async function listCachedDrafts(
	siteBase: string,
): Promise<CachedDraft[]> {
	return runExclusive(siteBase, async () => {
		const drafts = await readDrafts(siteBase);
		return drafts
			.sort((a, b) => draftTimestamp(b) - draftTimestamp(a))
			.map(cloneDraft);
	});
}

export async function removeCachedDraft(
	siteBase: string,
	postId: string,
): Promise<boolean> {
	return runExclusive(siteBase, async () => {
		const drafts = await readDrafts(siteBase);
		const next = drafts.filter(draft => draft.postId !== postId);
		if (next.length === drafts.length) {
			return false;
		}

		await writeDrafts(siteBase, next);
		return true;
	});
}

/**
 * Records that a draft's pending edits were successfully pushed to Ghost.
 * Updates the canonical post and timestamp, clears the queue, and marks the
 * cache clean. Missing entries are treated as a no-op.
 */
export async function markDraftClean(
	siteBase: string,
	postId: string,
	updatedPost: PostDetail,
): Promise<void> {
	return runExclusive(siteBase, async () => {
		const drafts = await readDrafts(siteBase);
		const index = drafts.findIndex(draft => draft.postId === postId);
		if (index === -1) {
			return;
		}

		const current = drafts[index];
		const cleaned: CachedDraft = {
			...current,
			post: cloneValue(updatedPost),
			cachedAt: new Date().toISOString(),
			dirty: false,
			pendingPatch: null,
		};

		await writeDrafts(
			siteBase,
			drafts.map((draft, position) =>
				position === index ? cleaned : draft,
			),
		);
	});
}

/**
 * Returns every dirty draft that has local edits waiting to be synced, newest
 * first. A dirty draft with an empty patch is ignored because there is nothing
 * to replay.
 */
export async function listPendingPatches(
	siteBase: string,
): Promise<CachedDraft[]> {
	return runExclusive(siteBase, async () => {
		const drafts = await readDrafts(siteBase);
		return drafts
			.filter(draft => draft.dirty && hasPendingPatch(draft))
			.sort((a, b) => draftTimestamp(b) - draftTimestamp(a))
			.map(cloneDraft);
	});
}

/** Removes every cached draft for a publication. */
export async function clearSiteDraftCache(siteBase: string): Promise<void> {
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
 * Clears the in-memory mirror and cached store handle. Intended for tests so
 * each case starts with a clean slate; it does not delete data from the Tauri
 * store on disk unless a test also clears its mock.
 */
export function __resetDraftCacheForTests(): void {
	memoryStore.clear();
	siteQueues.clear();
	lazyStore = null;
	lazyStoreUnavailable = false;
}

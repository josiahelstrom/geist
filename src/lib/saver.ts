import {GhostError, api} from "./api";

export type SaveStatus =
	| "clean"
	| "dirty"
	| "saving"
	| "saved"
	| "conflict"
	| "error"
	| "offline";

type Patch = Record<string, unknown>;

type SaverOptions = {
	onStatus: (status: SaveStatus, message?: string) => void;
	onConflict: () => void;
	/**
	 * Called when a save fails because the network is unavailable. The patch
	 * passed in is everything still unsaved (the failed patch merged with any
	 * later edits), so callers can persist it locally and replay it later.
	 */
	onOfflineSave?: (patch: Patch) => Promise<void> | void;
	/** Called after every successful PUT with the response's `updated_at`. */
	onSaveSuccess?: (updatedAt: string, patch: Patch) => void;
};

/**
 * True for failures that mean "the request never reached Ghost" (offline,
 * DNS, refused connection, timeout), as opposed to an HTTP response such as a
 * 409 conflict or a 5xx from the server.
 */
export function isNetworkError(err: unknown): boolean {
	if (err instanceof GhostError) {
		return false;
	}
	if (typeof navigator !== "undefined" && navigator.onLine === false) {
		return true;
	}
	if (err instanceof TypeError) {
		return true;
	}
	if (typeof err === "object" && err !== null) {
		const name = (err as {name?: unknown}).name;
		if (
			name === "TypeError" ||
			name === "NetworkError" ||
			name === "AbortError" ||
			name === "TimeoutError"
		) {
			return true;
		}
	}
	const message = err instanceof Error ? err.message : String(err);
	// Tauri's HTTP plugin surfaces transport failures through reqwest, whose
	// messages differ from the browser's ("Failed to fetch"). Match those too:
	// `error sending request for url (...)`, `dns error: ...`, and the
	// underlying socket errors ("connection reset", "broken pipe", ...).
	return /failed to fetch|network|offline|timed? ?out|load failed|error sending request for url|dns error|broken pipe|connection reset|connection refused|connection/i.test(
		message,
	);
}

/**
 * Single-flight saver.
 *
 * Rule 4.4: one save in flight at a time, always send the last `updated_at` we
 * saw, and take the new one from every response. On 409 stop autosaving and
 * ask the user rather than clobbering their work.
 *
 * Note the `pendingRevision` flag: the plan captured `revision` when the run
 * started, which meant a Cmd+S arriving while a save was already in flight was
 * dropped and never produced a revision. Latching the flag inside the loop
 * fixes that.
 */
export function createSaver(
	site: import("./api").Site,
	postId: string,
	initialUpdatedAt: string,
	{onStatus, onConflict, onOfflineSave, onSaveSuccess}: SaverOptions,
) {
	let updatedAt = initialUpdatedAt;
	let pending: Patch | null = null;
	let pendingRevision = false;
	let running: Promise<void> | null = null;
	let stopped = false;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let lastError: unknown = null;

	async function run() {
		while (pending && !stopped) {
			const patch = pending;
			const revision = pendingRevision;
			pending = null;
			pendingRevision = false;
			onStatus("saving");
			try {
				const query = revision ? "?save_revision=true" : "";
				const res = await api<{posts: {updated_at: string}[]}>(
					site,
					`/posts/${postId}/${query}`,
					{
						method: "PUT",
						// Rule 4.3: no `html`, no `source=html`. Lexical only.
						body: JSON.stringify({posts: [{...patch, updated_at: updatedAt}]}),
					},
				);
				updatedAt = res.posts[0].updated_at;
				lastError = null;
				try {
					onSaveSuccess?.(updatedAt, patch);
				} catch {
					/* Cache bookkeeping must never break the saver. */
				}
				if (!pending) {
					onStatus("saved");
				}
			} catch (err) {
				lastError = err;
				// Keep the edits so a later save can retry them.
				pending = {...patch, ...(pending ?? {})};
				// Rule 4.4: a 409 is a server response, not a network failure.
				// It must still halt immediately so the server copy is never
				// clobbered. Only network failures are given the offline path.
				if (err instanceof GhostError && err.status === 409) {
					stopped = true;
					onStatus("conflict");
					onConflict();
				} else if (isNetworkError(err)) {
					const message =
						err instanceof Error ? err.message : String(err);
					onStatus("offline", message);
					if (onOfflineSave) {
						try {
							await onOfflineSave({...pending});
						} catch {
							/* The in-memory patch is still kept for a retry. */
						}
					}
				} else {
					onStatus("error", err instanceof Error ? err.message : String(err));
				}
				return;
			}
		}
	}

	function start(): Promise<void> {
		if (!running) {
			running = run().finally(() => {
				running = null;
			});
		}
		return running;
	}

	return {
		get updatedAt() {
			return updatedAt;
		},
		get hasPending() {
			return pending !== null || running !== null;
		},
		get conflict() {
			return stopped;
		},
		get lastError() {
			return lastError;
		},

		/** Queue a patch. `revision: true` means "make a revision", as Cmd+S does. */
		queue(patch: Patch, revision = false) {
			if (stopped) {
				// After a 409 the saver is halted, but an explicit queue is
				// deliberate: keep the patch so "Keep my edits & overwrite"
				// can send everything typed while the conflict banner was up.
				// Do not start a save or change status while halted.
				pending = {...pending, ...patch};
				if (revision) {
					pendingRevision = true;
				}
				return Promise.resolve();
			}
			pending = {...pending, ...patch};
			if (revision) {
				pendingRevision = true;
			}
			onStatus("dirty");
			return start();
		},

		/** Debounced queue, used for typing. */
		queueDebounced(patch: Patch, delayMs = 1500) {
			// After a 409 the saver is halted; a keystroke must not flip the
			// status back to "unsaved" or schedule a save that will never run.
			if (stopped) {
				return;
			}
			pending = {...pending, ...patch};
			onStatus("dirty");
			if (debounce) {
				clearTimeout(debounce);
			}
			debounce = setTimeout(() => start(), delayMs);
		},

		/** Save immediately, optionally as a revision. */
		async flush(revision = false): Promise<void> {
			if (debounce) {
				clearTimeout(debounce);
				debounce = null;
			}
			if (revision && !stopped) {
				// Latch the revision unconditionally. If a save is already in
				// flight `pending` is null here, and a guarded
				// `pendingRevision = true` would be dropped -- so Cmd+S would
				// silently create no revision. Queue an empty patch to force
				// the PUT to happen.
				pendingRevision = true;
				if (!pending) {
					pending = {};
				}
			}
			if (!pending && !running) {
				return;
			}
			// `run()` drains `pending` internally, so one await normally
			// suffices. Loop in case a keystroke queued a patch while we
			// waited, but bail out on failure so a dead server cannot spin.
			for (let i = 0; i < 10 && !stopped; i++) {
				const errorBefore = lastError;
				await start();
				if (lastError !== errorBefore) {
					return; // failed; `pending` is kept for a later retry
				}
				if (!pending && !running) {
					return;
				}
			}
		},

		/** Stop autosaving; used after a conflict. */
		halt() {
			stopped = true;
			if (debounce) {
				clearTimeout(debounce);
				debounce = null;
			}
		},

		/**
		 * Updates `updatedAt` after an out-of-band mutation (e.g. publish or
		 * unpublish) so the next autosave does not trigger a spurious 409.
		 */
		adoptUpdatedAt(nextUpdatedAt: string) {
			updatedAt = nextUpdatedAt;
		},

		/**
		 * Resolves a 409 conflict by adopting the server's latest `updated_at`
		 * and flushing the user's pending changes as a revision.
		 */
		async resumeWithUpdatedAt(nextUpdatedAt: string): Promise<void> {
			updatedAt = nextUpdatedAt;
			stopped = false;
			lastError = null;
			await this.flush(true);
		},
	};
}
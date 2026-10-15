import {GhostError, api} from "./api";

export type SaveStatus = "clean" | "dirty" | "saving" | "saved" | "conflict" | "error";

type Patch = Record<string, unknown>;

type SaverOptions = {
	onStatus: (status: SaveStatus, message?: string) => void;
	onConflict: () => void;
};

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
	{onStatus, onConflict}: SaverOptions,
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
				if (!pending) {
					onStatus("saved");
				}
			} catch (err) {
				lastError = err;
				// Keep the edits so a later save can retry them.
				pending = {...patch, ...(pending ?? {})};
				if (err instanceof GhostError && err.status === 409) {
					stopped = true;
					onStatus("conflict");
					onConflict();
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
import {check, type Update} from "@tauri-apps/plugin-updater";
import {relaunch} from "@tauri-apps/plugin-process";

/** Metadata for an available release, as reported by the update manifest. */
export type UpdateInfo = {
	version: string;
	currentVersion: string;
	date?: string;
	body?: string;
};

export type UpdateProgress = {
	downloaded: number;
	total: number | null;
	percent: number | null; // 0-100, null when total is unknown
};

/**
 * The `Update` handle from the last check. Keeping it means "install" does not
 * have to hit the network a second time; it is dropped whenever it goes stale.
 */
let cachedUpdate: Update | null = null;

/** True when running inside the Tauri shell, where the updater plugin exists. */
export function hasTauriRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const candidate = window as unknown as Record<string, unknown>;
	return "__TAURI_INTERNALS__" in candidate;
}

/**
 * Ask the configured endpoint for an update. Never throws: a failed check must
 * not block launch or surface an error banner in the UI.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
	if (!hasTauriRuntime()) {
		return null;
	}

	try {
		const update = await check();
		if (!update) {
			cachedUpdate = null;
			return null;
		}

		cachedUpdate = update;
		const info: UpdateInfo = {
			version: update.version,
			currentVersion: update.currentVersion,
		};
		if (update.date) {
			info.date = update.date;
		}
		if (update.body) {
			info.body = update.body;
		}
		return info;
	} catch (err) {
		console.debug("[updater] update check failed", err);
		cachedUpdate = null;
		return null;
	}
}

/**
 * The install currently in flight, if any. The banner also disables its button,
 * but the updater must be safe on its own: a second call while a download is
 * running would start a concurrent install of the same update. Concurrent
 * callers share this promise; it is cleared when the install settles so a
 * retry after a failure still starts fresh.
 */
let installInFlight: Promise<void> | null = null;

/**
 * Download and install the cached update, reporting byte progress as it goes.
 * Re-checks when nothing is cached. Plugin failures propagate so the UI can
 * offer a retry; the stale handle is cleared so the retry starts fresh.
 *
 * A call made while an install is already running joins that install instead
 * of starting a second download.
 */
export function installUpdate(
	onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
	if (installInFlight) {
		return installInFlight;
	}

	installInFlight = runInstall(onProgress).finally(() => {
		installInFlight = null;
	});
	return installInFlight;
}

async function runInstall(
	onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
	let update = cachedUpdate;
	if (!update) {
		await checkForUpdate();
		update = cachedUpdate;
	}
	if (!update) {
		return;
	}

	let downloaded = 0;
	let total: number | null = null;
	let percent: number | null = null;

	function report() {
		onProgress?.({downloaded, total, percent});
	}

	try {
		await update.downloadAndInstall(event => {
			switch (event.event) {
				case "Started": {
					const contentLength = event.data.contentLength;
					total =
						typeof contentLength === "number" && contentLength > 0
							? contentLength
							: null;
					percent = total === null ? null : 0;
					report();
					break;
				}
				case "Progress":
					downloaded += event.data.chunkLength;
					percent =
						total === null || total <= 0
							? null
							: Math.min(100, Math.round((downloaded / total) * 100));
					report();
					break;
				case "Finished":
					downloaded = total ?? downloaded;
					percent = 100;
					report();
					break;
			}
		});
		cachedUpdate = null;
	} catch (err) {
		cachedUpdate = null;
		throw err;
	}
}

/** Restart into the freshly installed build; a no-op in the browser. */
export async function relaunchApp(): Promise<void> {
	if (!hasTauriRuntime()) {
		return;
	}
	await relaunch();
}

/** Test-only: drop module state between cases. */
export function __resetUpdaterForTests(): void {
	cachedUpdate = null;
	installInFlight = null;
}

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {DownloadEvent} from "@tauri-apps/plugin-updater";

const updaterMock = vi.hoisted(() => ({
	check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
	check: updaterMock.check,
}));

const processMock = vi.hoisted(() => ({
	relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
	relaunch: processMock.relaunch,
}));

import {
	__resetUpdaterForTests,
	checkForUpdate,
	hasTauriRuntime,
	installUpdate,
	relaunchApp,
	type UpdateProgress,
} from "./updater";

type FakeUpdate = {
	version: string;
	currentVersion: string;
	date?: string;
	body?: string;
	downloadAndInstall: (cb?: (event: DownloadEvent) => void) => Promise<void>;
};

function fakeUpdate(overrides: Partial<FakeUpdate> = {}): FakeUpdate {
	return {
		version: "1.0.0",
		currentVersion: "1.0.0-rc.1",
		downloadAndInstall: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function enableTauri(): void {
	vi.stubGlobal("window", {__TAURI_INTERNALS__: {}});
}

beforeEach(() => {
	__resetUpdaterForTests();
	updaterMock.check.mockReset();
	processMock.relaunch.mockReset();
	vi.stubGlobal("window", {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("update checks", () => {
	it("returns null outside Tauri without touching the plugin", async () => {
		expect(hasTauriRuntime()).toBe(false);

		await expect(checkForUpdate()).resolves.toBeNull();
		expect(updaterMock.check).not.toHaveBeenCalled();
	});

	it("maps an available update to plain metadata", async () => {
		enableTauri();
		updaterMock.check.mockResolvedValue(
			fakeUpdate({
				version: "1.0.0-rc.2",
				currentVersion: "1.0.0-rc.1",
				date: "2026-10-30T00:00:00Z",
				body: "Fixes the updater.",
			}),
		);

		await expect(checkForUpdate()).resolves.toEqual({
			version: "1.0.0-rc.2",
			currentVersion: "1.0.0-rc.1",
			date: "2026-10-30T00:00:00Z",
			body: "Fixes the updater.",
		});
		expect(updaterMock.check).toHaveBeenCalledTimes(1);
	});

	it("returns null when the app is up to date", async () => {
		enableTauri();
		updaterMock.check.mockResolvedValue(null);

		await expect(checkForUpdate()).resolves.toBeNull();
		expect(updaterMock.check).toHaveBeenCalledTimes(1);
	});

	it("swallows a rejected check instead of blocking launch", async () => {
		enableTauri();
		vi.spyOn(console, "debug").mockImplementation(() => {});
		updaterMock.check.mockRejectedValue(new Error("404 not found"));

		await expect(checkForUpdate()).resolves.toBeNull();
	});
});

describe("installing updates", () => {
	it("reports monotonic byte progress from 0 to 100", async () => {
		enableTauri();
		const update = fakeUpdate({
			downloadAndInstall: vi.fn(
				async (cb?: (event: DownloadEvent) => void) => {
					cb?.({event: "Started", data: {contentLength: 1000}});
					cb?.({event: "Progress", data: {chunkLength: 250}});
					cb?.({event: "Progress", data: {chunkLength: 250}});
					cb?.({event: "Finished"});
				},
			),
		});
		updaterMock.check.mockResolvedValue(update);

		await checkForUpdate();
		const seen: UpdateProgress[] = [];
		await installUpdate(progress => seen.push(progress));

		expect(seen).toContainEqual({downloaded: 0, total: 1000, percent: 0});
		expect(seen).toContainEqual({downloaded: 250, total: 1000, percent: 25});
		expect(seen).toContainEqual({downloaded: 500, total: 1000, percent: 50});
		expect(seen[seen.length - 1]).toEqual({
			downloaded: 1000,
			total: 1000,
			percent: 100,
		});
		// The cached handle is reused; installing must not re-check.
		expect(updaterMock.check).toHaveBeenCalledTimes(1);
	});

	it("keeps percent null when the content length is unknown", async () => {
		enableTauri();
		const update = fakeUpdate({
			downloadAndInstall: vi.fn(
				async (cb?: (event: DownloadEvent) => void) => {
					cb?.({event: "Started", data: {}});
					cb?.({event: "Progress", data: {chunkLength: 300}});
					cb?.({event: "Progress", data: {chunkLength: 400}});
				},
			),
		});
		updaterMock.check.mockResolvedValue(update);

		await checkForUpdate();
		const seen: UpdateProgress[] = [];
		await installUpdate(progress => seen.push(progress));

		expect(seen.map(p => p.downloaded)).toEqual([0, 300, 700]);
		for (const progress of seen) {
			expect(progress.total).toBeNull();
			expect(progress.percent).toBeNull();
		}
	});

	it("propagates install errors and clears the cached handle", async () => {
		enableTauri();
		updaterMock.check.mockResolvedValue(
			fakeUpdate({
				downloadAndInstall: vi
					.fn()
					.mockRejectedValue(new Error("download failed")),
			}),
		);
		vi.spyOn(console, "debug").mockImplementation(() => {});

		await checkForUpdate();
		await expect(installUpdate()).rejects.toThrow("download failed");
		expect(updaterMock.check).toHaveBeenCalledTimes(1);

		updaterMock.check.mockResolvedValue(fakeUpdate());
		await installUpdate();

		expect(updaterMock.check).toHaveBeenCalledTimes(2);
	});

	it("joins an in-flight install instead of downloading twice", async () => {
		enableTauri();
		let finish: (() => void) | undefined;
		const downloadAndInstall = vi.fn(
			() =>
				new Promise<void>(resolve => {
					finish = resolve;
				}),
		);
		updaterMock.check.mockResolvedValue(fakeUpdate({downloadAndInstall}));

		await checkForUpdate();

		const first = installUpdate();
		const second = installUpdate();

		expect(second).toBe(first);
		expect(downloadAndInstall).toHaveBeenCalledTimes(1);

		finish?.();
		await Promise.all([first, second]);
		expect(downloadAndInstall).toHaveBeenCalledTimes(1);

		// The guard clears on settle, so a later call starts a fresh install.
		const nextUpdate = fakeUpdate();
		updaterMock.check.mockResolvedValue(nextUpdate);
		await installUpdate();

		expect(nextUpdate.downloadAndInstall).toHaveBeenCalledTimes(1);
		expect(updaterMock.check).toHaveBeenCalledTimes(2);
	});

	it("resolves silently when there is no update to install", async () => {
		enableTauri();
		updaterMock.check.mockResolvedValue(null);

		await expect(installUpdate()).resolves.toBeUndefined();
		expect(updaterMock.check).toHaveBeenCalledTimes(1);
	});
});

describe("relaunch", () => {
	it("is a no-op outside Tauri", async () => {
		await relaunchApp();
		expect(processMock.relaunch).not.toHaveBeenCalled();
	});

	it("relaunches through the process plugin inside Tauri", async () => {
		enableTauri();
		processMock.relaunch.mockResolvedValue(undefined);

		await relaunchApp();
		expect(processMock.relaunch).toHaveBeenCalledTimes(1);
	});
});

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

type FakeWindow = {
	localStorage: Storage;
	dispatched: unknown[];
};

class FakeCustomEvent {
	type: string;
	detail: unknown;

	constructor(type: string, init?: {detail?: unknown}) {
		this.type = type;
		this.detail = init?.detail;
	}
}

function installWindow(options: {stored?: string} = {}): FakeWindow {
	const values = new Map<string, string>();
	if (options.stored !== undefined) {
		values.set("geist.ui-prefs.v1", options.stored);
	}

	const localStorage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
		clear: () => values.clear(),
		key: (index: number) => Array.from(values.keys())[index] ?? null,
		get length() {
			return values.size;
		},
	} as Storage;

	const dispatched: unknown[] = [];
	const windowStub = {
		localStorage,
		dispatchEvent: vi.fn((event: unknown) => {
			dispatched.push(event);
			return true;
		}),
	};

	vi.stubGlobal("window", windowStub);
	vi.stubGlobal("localStorage", localStorage);

	return {localStorage, dispatched};
}

/** Load a fresh module instance so the module-level cache starts empty. */
async function loadModule() {
	vi.resetModules();
	return import("./uiPrefs");
}

beforeEach(() => {
	vi.stubGlobal("CustomEvent", FakeCustomEvent);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("ui preferences storage", () => {
	it("returns defaults when storage is empty", async () => {
		installWindow();
		const {DEFAULT_UI_PREFS, getUiPrefs} = await loadModule();

		expect(getUiPrefs()).toEqual({
			alwaysShowExcerpt: false,
			showFeatureImage: true,
			editorFont: "serif",
			typewriterMode: false,
		});
		expect(DEFAULT_UI_PREFS).toEqual({
			alwaysShowExcerpt: false,
			showFeatureImage: true,
			editorFont: "serif",
			typewriterMode: false,
		});
	});

	it("returns defaults when no window is available", async () => {
		const {getUiPrefs} = await loadModule();

		expect(getUiPrefs()).toEqual({
			alwaysShowExcerpt: false,
			showFeatureImage: true,
			editorFont: "serif",
			typewriterMode: false,
		});
	});

	it("falls back to all defaults on corrupt JSON", async () => {
		installWindow({stored: "{not valid json"});
		const {getUiPrefs} = await loadModule();

		expect(getUiPrefs()).toEqual({
			alwaysShowExcerpt: false,
			showFeatureImage: true,
			editorFont: "serif",
			typewriterMode: false,
		});
	});

	it("fills missing fields from defaults and ignores unknown or wrong-typed values", async () => {
		installWindow({
			stored: JSON.stringify({
				alwaysShowExcerpt: true,
				showFeatureImage: "yes",
				editorFont: "comic-sans",
				typewriterMode: "enabled",
				unknownKey: "ignored",
			}),
		});
		const {getUiPrefs} = await loadModule();

		expect(getUiPrefs()).toEqual({
			alwaysShowExcerpt: true,
			showFeatureImage: true,
			editorFont: "serif",
			typewriterMode: false,
		});
	});

	it("keeps a valid field while defaulting a missing one", async () => {
		installWindow({
			stored: JSON.stringify({
				showFeatureImage: false,
				editorFont: "mono",
				typewriterMode: true,
			}),
		});
		const {getUiPrefs} = await loadModule();

		expect(getUiPrefs()).toEqual({
			alwaysShowExcerpt: false,
			showFeatureImage: false,
			editorFont: "mono",
			typewriterMode: true,
		});
	});
});

describe("setUiPrefs", () => {
	it("merges a patch, persists it, and notifies subscribers and the window", async () => {
		const {localStorage, dispatched} = installWindow();
		const {getUiPrefs, setUiPrefs, subscribeUiPrefs} = await loadModule();
		const listener = vi.fn();
		subscribeUiPrefs(listener);

		const first = setUiPrefs({showFeatureImage: false});

		expect(first).toEqual({
			alwaysShowExcerpt: false,
			showFeatureImage: false,
			editorFont: "serif",
			typewriterMode: false,
		});
		expect(getUiPrefs()).toEqual(first);

		const second = setUiPrefs({
			alwaysShowExcerpt: true,
			editorFont: "sans",
			typewriterMode: true,
		});

		expect(second).toEqual({
			alwaysShowExcerpt: true,
			showFeatureImage: false,
			editorFont: "sans",
			typewriterMode: true,
		});
		expect(getUiPrefs()).toEqual(second);
		expect(localStorage.getItem("geist.ui-prefs.v1")).toBe(
			JSON.stringify(second),
		);

		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith(second);
		expect(dispatched).toHaveLength(2);
		expect(dispatched[1]).toMatchObject({
			type: "geist:ui-prefs-change",
			detail: second,
		});
	});

	it("updates typewriterMode independently", async () => {
		installWindow();
		const {getUiPrefs, setUiPrefs} = await loadModule();

		expect(getUiPrefs().typewriterMode).toBe(false);
		setUiPrefs({typewriterMode: true});
		expect(getUiPrefs().typewriterMode).toBe(true);
		setUiPrefs({typewriterMode: false});
		expect(getUiPrefs().typewriterMode).toBe(false);
	});

	it("ignores invalid editorFont values in patch", async () => {
		installWindow();
		const {getUiPrefs, setUiPrefs} = await loadModule();

		setUiPrefs({editorFont: "mono"});
		expect(getUiPrefs().editorFont).toBe("mono");

		// @ts-expect-error test invalid value runtime protection
		setUiPrefs({editorFont: "invalid"});
		expect(getUiPrefs().editorFont).toBe("mono");
	});

	it("stops notifying after unsubscribe", async () => {
		installWindow();
		const {setUiPrefs, subscribeUiPrefs} = await loadModule();
		const listener = vi.fn();
		const unsubscribe = subscribeUiPrefs(listener);

		setUiPrefs({alwaysShowExcerpt: true});
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		setUiPrefs({alwaysShowExcerpt: false});

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("shouldShowExcerpt", () => {
	it("keeps the row visible only for a real excerpt unless always-show is on", async () => {
		installWindow();
		const {shouldShowExcerpt} = await loadModule();

		expect(shouldShowExcerpt("", false)).toBe(false);
		expect(shouldShowExcerpt("hi", false)).toBe(true);
		expect(shouldShowExcerpt("   ", false)).toBe(false);
		expect(shouldShowExcerpt("", true)).toBe(true);
		expect(shouldShowExcerpt("hi", true)).toBe(true);
	});
});

import {afterEach, describe, expect, it, vi} from "vitest";
import {
	applyTheme,
	getStoredTheme,
	resolveIsDark,
	setStoredTheme,
} from "./theme";

type FakeWindow = {
	localStorage: Storage;
	dispatched: unknown[];
	classes: Set<string>;
};

class FakeCustomEvent {
	type: string;
	detail: unknown;

	constructor(type: string, init?: {detail?: unknown}) {
		this.type = type;
		this.detail = init?.detail;
	}
}

function installWindow(
	options: {stored?: string; prefersDark?: boolean} = {},
): FakeWindow {
	const values = new Map<string, string>();
	if (options.stored !== undefined) {
		values.set("geist.theme.v1", options.stored);
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

	const classes = new Set<string>();
	const classList = {
		toggle: (name: string, force?: boolean) => {
			const next = force ?? !classes.has(name);
			if (next) {
				classes.add(name);
			} else {
				classes.delete(name);
			}
			return next;
		},
		contains: (name: string) => classes.has(name),
	};

	const matchMedia = vi.fn((query: string) => ({
		matches:
			query === "(prefers-color-scheme: dark)"
				? Boolean(options.prefersDark)
				: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));

	const dispatched: unknown[] = [];
	const windowStub = {
		localStorage,
		matchMedia,
		dispatchEvent: vi.fn((event: unknown) => {
			dispatched.push(event);
			return true;
		}),
	};

	vi.stubGlobal("window", windowStub);
	vi.stubGlobal("localStorage", localStorage);
	vi.stubGlobal("document", {
		documentElement: {classList},
	});

	return {localStorage, dispatched, classes};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("theme storage", () => {
	it("falls back to system when no window is available", () => {
		expect(getStoredTheme()).toBe("system");
	});

	it("reads valid stored themes and ignores invalid values", () => {
		installWindow({stored: "dark"});
		expect(getStoredTheme()).toBe("dark");

		installWindow({stored: "light"});
		expect(getStoredTheme()).toBe("light");

		installWindow({stored: "system"});
		expect(getStoredTheme()).toBe("system");

		installWindow({stored: "banana"});
		expect(getStoredTheme()).toBe("system");
	});

	it("persists the selected theme", () => {
		const {localStorage} = installWindow();

		setStoredTheme("dark");

		expect(localStorage.getItem("geist.theme.v1")).toBe("dark");
		expect(getStoredTheme()).toBe("dark");
	});
});

describe("theme resolution", () => {
	it("resolves explicit dark and light themes", () => {
		expect(resolveIsDark("dark")).toBe(true);
		expect(resolveIsDark("light")).toBe(false);
	});

	it("follows the OS preference for the system theme", () => {
		installWindow({prefersDark: true});
		expect(resolveIsDark("system")).toBe(true);

		installWindow({prefersDark: false});
		expect(resolveIsDark("system")).toBe(false);
	});
});

describe("applyTheme", () => {
	it("applies the stored theme to the document and emits an event", () => {
		vi.stubGlobal("CustomEvent", FakeCustomEvent);
		const {classes, dispatched} = installWindow({stored: "dark"});

		expect(applyTheme()).toBe(true);
		expect(classes.has("dark")).toBe(true);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			type: "geist:theme-change",
			detail: {isDark: true},
		});
	});

	it("removes the dark class when applying light", () => {
		vi.stubGlobal("CustomEvent", FakeCustomEvent);
		const {classes} = installWindow({stored: "light"});
		classes.add("dark");

		expect(applyTheme()).toBe(false);
		expect(classes.has("dark")).toBe(false);
	});
});

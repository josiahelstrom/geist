// @vitest-environment jsdom
import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {getUiPrefs, setUiPrefs} from "./lib/uiPrefs";
import App from "./App";

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn().mockRejectedValue(new Error("no tauri")),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
	Store: class {
		get() {
			return Promise.resolve(null);
		}
		set() {
			return Promise.resolve();
		}
		save() {
			return Promise.resolve();
		}
	},
}));

afterEach(cleanup);

describe("App keyboard shortcuts", () => {
	beforeEach(() => {
		setUiPrefs({editorEngine: "lexical-lab"});
	});

	it("toggles editorEngine between lexical-lab and koenig on Cmd+Option+E / Ctrl+Alt+E", () => {
		render(<App />);

		expect(getUiPrefs().editorEngine).toBe("lexical-lab");

		// Cmd+Option+E
		fireEvent.keyDown(window, {
			key: "e",
			code: "KeyE",
			metaKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("koenig");

		// Press again to toggle back to lexical-lab
		fireEvent.keyDown(window, {
			key: "e",
			code: "KeyE",
			metaKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("lexical-lab");

		// Ctrl+Alt+E works too (e.g. on Windows/Linux)
		fireEvent.keyDown(window, {
			key: "e",
			code: "KeyE",
			ctrlKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("koenig");
	});

	it("handles dead key / acute character when altKey is pressed on macOS (key: '´', code: 'KeyE')", () => {
		render(<App />);

		expect(getUiPrefs().editorEngine).toBe("lexical-lab");

		fireEvent.keyDown(window, {
			key: "´",
			code: "KeyE",
			metaKey: true,
			altKey: true,
		});

		expect(getUiPrefs().editorEngine).toBe("koenig");
	});
});

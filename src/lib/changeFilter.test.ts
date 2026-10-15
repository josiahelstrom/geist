import {describe, expect, it} from "vitest";
import {createChangeFilter} from "./changeFilter";

describe("createChangeFilter", () => {
	it("ignores mount-time emissions before any user interaction", () => {
		const f = createChangeFilter();
		expect(f.accept("a")).toBe(false);
		expect(f.accept("a-normalised")).toBe(false);
	});

	it("accepts the first real change after interaction", () => {
		const f = createChangeFilter();
		f.accept("a");
		f.markInteraction();
		expect(f.accept("ab")).toBe(true);
	});

	it("drops identical emissions after interaction (selection-only updates)", () => {
		const f = createChangeFilter();
		f.accept("a");
		f.markInteraction();
		expect(f.accept("a")).toBe(false);
		expect(f.accept("ab")).toBe(true);
		expect(f.accept("ab")).toBe(false);
	});

	it("treats an undo back to the original content as an edit", () => {
		const f = createChangeFilter();
		f.accept("a");
		f.markInteraction();
		expect(f.accept("ab")).toBe(true);
		expect(f.accept("a")).toBe(true);
	});

	it("does not swallow the first keystroke when mount emitted nothing", () => {
		const f = createChangeFilter();
		f.markInteraction();
		expect(f.accept("x")).toBe(true);
	});

	it("resets when a different post or server version is bound", () => {
		const f = createChangeFilter();
		f.accept("a");
		f.markInteraction();
		f.reset();
		expect(f.accept("b")).toBe(false);
	});
});

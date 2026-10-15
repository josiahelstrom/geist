import {describe, expect, it} from "vitest";
import {resolveIsDark} from "./theme";

describe("theme resolution", () => {
	it("resolves dark to true and light to false", () => {
		expect(resolveIsDark("dark")).toBe(true);
		expect(resolveIsDark("light")).toBe(false);
	});
});

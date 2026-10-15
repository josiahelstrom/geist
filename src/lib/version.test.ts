import {describe, expect, it} from "vitest";
import {checkVersion, versionBanner, TESTED_GHOST, KOENIG_VERSION} from "./version";

describe("version policy (plan §10)", () => {
	it("treats the tested version as fine and shows no banner", () => {
		expect(checkVersion(TESTED_GHOST[0])).toBe("tested");
		expect(versionBanner(TESTED_GHOST[0])).toBeNull();
	});

	it("warns, but does not block, on a newer Ghost", () => {
		expect(checkVersion("6.99")).toBe("newer");
		expect(versionBanner("6.99")).toMatch(/newer Ghost/);
	});

	it("warns on an older Ghost", () => {
		expect(checkVersion("5.30")).toBe("older");
		expect(versionBanner("5.30")).toMatch(/older Ghost/);
	});

	it("handles a new major version", () => {
		expect(checkVersion("7.0")).toBe("newer");
	});

	it("does not throw on an unparseable version", () => {
		expect(checkVersion("unknown")).toBe("unknown");
		expect(versionBanner("")).toBeTruthy();
	});

	it("pins a Koenig version", () => {
		expect(KOENIG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
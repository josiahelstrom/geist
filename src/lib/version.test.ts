import {describe, expect, it} from "vitest";
import {checkVersion, shouldEnforceReadOnly, versionBanner} from "./version";

describe("version compatibility policy", () => {
	it("returns tested for matching version", () => {
		expect(checkVersion("6.68")).toBe("tested");
		expect(versionBanner("6.68")).toBeNull();
		expect(shouldEnforceReadOnly("6.68")).toBe(false);
	});

	it("returns newer and enforces read-only for future Ghost releases", () => {
		expect(checkVersion("6.69")).toBe("newer");
		expect(checkVersion("7.0")).toBe("newer");
		expect(shouldEnforceReadOnly("6.69")).toBe(true);
		expect(versionBanner("6.69")).toContain("read-only unless overridden");
	});

	it("returns older for earlier releases without enforcing read-only", () => {
		expect(checkVersion("5.80")).toBe("older");
		expect(shouldEnforceReadOnly("5.80")).toBe(false);
		expect(versionBanner("5.80")).toContain("older Ghost");
	});

	it("handles malformed version strings safely", () => {
		expect(checkVersion("beta")).toBe("unknown");
		expect(shouldEnforceReadOnly("beta")).toBe(false);
	});
});

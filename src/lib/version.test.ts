import {describe, expect, it} from "vitest";
import {
	MAX_GHOST,
	MIN_GHOST,
	TESTED_GHOST,
	checkVersion,
	shouldEnforceReadOnly,
	versionBanner,
} from "./version";

describe("version compatibility policy", () => {
	it("keeps the tested version fully editable without a banner", () => {
		expect(TESTED_GHOST).toContain(MAX_GHOST);
		for (const version of TESTED_GHOST) {
			expect(checkVersion(version)).toBe("tested");
			expect(versionBanner(version)).toBeNull();
			expect(shouldEnforceReadOnly(version)).toBe(false);
		}
	});

	it("treats versions between the minimum and maximum as supported", () => {
		for (const version of [MIN_GHOST, "5.80", "6.0", "6.67"]) {
			expect(checkVersion(version)).toBe("supported");
			expect(versionBanner(version)).toBeNull();
			expect(shouldEnforceReadOnly(version)).toBe(false);
		}
	});

	it("enforces read-only above the maximum", () => {
		for (const version of ["6.69", "6.68.1", "7.0"]) {
			expect(checkVersion(version)).toBe("newer");
			expect(shouldEnforceReadOnly(version)).toBe(true);
			expect(versionBanner(version)).toContain("read-only unless overridden");
		}
	});

	it("warns but stays editable below the minimum", () => {
		expect(checkVersion("4.48")).toBe("older");
		expect(shouldEnforceReadOnly("4.48")).toBe(false);
		expect(versionBanner("4.48")).toContain("older Ghost");
		expect(versionBanner("4.48")).toContain("Newer cards may not render");
	});

	it("handles malformed version strings safely", () => {
		expect(checkVersion("beta")).toBe("unknown");
		expect(checkVersion("6")).toBe("unknown");
		expect(checkVersion("6.x")).toBe("unknown");
		expect(shouldEnforceReadOnly("beta")).toBe(false);
		expect(versionBanner("beta")).toContain("Couldn't determine");
	});
});

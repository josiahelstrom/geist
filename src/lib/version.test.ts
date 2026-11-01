import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";
import pkg from "../../package.json";
import {
	KOENIG_VERSION,
	MAX_GHOST,
	MIN_GHOST,
	TESTED_GHOST,
	checkVersion,
	shouldEnforceReadOnly,
	versionBanner,
} from "./version";

describe("repo version consistency", () => {
	it("asserts package.json, package-lock.json, tauri.conf.json, Cargo.toml, and Cargo.lock have identical versions", () => {
		const root = path.resolve(__dirname, "../..");
		const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
		const pkgLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
		const tauriConf = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
		const cargoToml = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8");
		const cargoLock = fs.readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8");

		const cargoTomlMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
		const cargoLockMatch = cargoLock.match(/\[\[package\]\]\r?\nname\s*=\s*"geist"\r?\nversion\s*=\s*"([^"]+)"/);

		expect(cargoTomlMatch).not.toBeNull();
		expect(cargoLockMatch).not.toBeNull();

		const expected = pkgJson.version;
		expect(expected).toBeTruthy();
		expect(pkgLock.version).toBe(expected);
		expect(tauriConf.version).toBe(expected);
		expect(cargoTomlMatch?.[1]).toBe(expected);
		expect(cargoLockMatch?.[1]).toBe(expected);
	});
});

describe("version compatibility policy", () => {
	it("keeps the tested version fully editable without a banner", () => {
		expect(TESTED_GHOST).toContain(MAX_GHOST);
		expect(TESTED_GHOST).toEqual(["6.68", "6.73"]);
		for (const version of TESTED_GHOST) {
			expect(checkVersion(version)).toBe("tested");
			expect(versionBanner(version)).toBeNull();
			expect(shouldEnforceReadOnly(version)).toBe(false);
		}
	});

	it("treats versions between the minimum and maximum as supported", () => {
		for (const version of [MIN_GHOST, "5.80", "6.0", "6.68", "6.69", "6.71", "6.72"]) {
			expect(versionBanner(version)).toBeNull();
			expect(shouldEnforceReadOnly(version)).toBe(false);
			// 6.68 is also in TESTED_GHOST, so it reports "tested" rather than
			// "supported"; both are editable without a banner.
			if (!TESTED_GHOST.includes(version)) {
				expect(checkVersion(version)).toBe("supported");
			}
		}
	});

	it("enforces read-only above the maximum", () => {
		for (const version of ["6.74", "6.73.1", "7.0"]) {
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

	it("keeps KOENIG_VERSION in step with the bundled editor", () => {
		// The constant is what the app reports and pins to; drift from the
		// installed dependency would silently mis-advertise compatibility.
		expect(pkg.dependencies["@tryghost/koenig-lexical"]).toBe(KOENIG_VERSION);
	});
});

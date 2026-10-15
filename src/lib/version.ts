/** Ghost versions this build has been checked against (plan §10). */
export const TESTED_GHOST = ["6.68"];

/** The Koenig version this app bundles; pin it to the target site's version. */
export const KOENIG_VERSION = "1.11.1";

export type VersionStatus = "tested" | "newer" | "older" | "unknown";

export function checkVersion(version: string): VersionStatus {
	const tested = TESTED_GHOST[TESTED_GHOST.length - 1];
	if (!/^\d+\.\d+$/.test(version) || !/^\d+\.\d+$/.test(tested)) {
		return "unknown";
	}
	const [major, minor] = version.split(".").map(Number);
	const [tMajor, tMinor] = tested.split(".").map(Number);
	if (major !== tMajor) {
		return major > tMajor ? "newer" : "older";
	}
	if (minor === tMinor) {
		return "tested";
	}
	return minor > tMinor ? "newer" : "older";
}

const COPY: Record<VersionStatus, string | null> = {
	tested: null,
	newer:
		"This site runs a newer Ghost than this app was tested against. Cards may not render correctly.",
	older:
		"This site runs an older Ghost than this app was tested against. Newer cards may not render.",
	unknown: "Couldn't determine this site's Ghost version.",
};

export function versionBanner(version: string): string | null {
	return COPY[checkVersion(version)];
}
/**
 * Ghost versions this build has been checked against (plan §10). This is a
 * stricter signal than the MIN/MAX range: it drives the banner copy only, not
 * whether editing is allowed.
 */
export const TESTED_GHOST = ["6.68"];

/** The Koenig version this app bundles; pin it to the target site's version. */
export const KOENIG_VERSION = "1.11.1";

/** Oldest Ghost this Koenig build supports. */
export const MIN_GHOST = "5.0";
/** Newest Ghost this Koenig build supports; above it, editing is read-only. */
export const MAX_GHOST = "6.68";

export type VersionStatus =
	| "tested"
	| "supported"
	| "newer"
	| "older"
	| "unknown";

type ParsedVersion = [number, number, number];

/** Ghost reports "6.68"; accept an optional patch segment defensively. */
function parseVersion(version: string): ParsedVersion | null {
	const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
	if (!match) {
		return null;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compare(a: ParsedVersion, b: ParsedVersion): number {
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return a[i] > b[i] ? 1 : -1;
		}
	}
	return 0;
}

/**
 * Plan §10: above `MAX_GHOST` is unsafe (read-only, with an override), below
 * `MIN_GHOST` is untested enough to warn, and everything in between is
 * supported. A version in the range that isn't in `TESTED_GHOST` is still
 * editable and does not show a banner.
 */
export function checkVersion(version: string): VersionStatus {
	const parsed = parseVersion(version);
	const min = parseVersion(MIN_GHOST);
	const max = parseVersion(MAX_GHOST);
	if (!parsed || !min || !max) {
		return "unknown";
	}
	if (
		TESTED_GHOST.some(tested => {
			const t = parseVersion(tested);
			return t !== null && compare(parsed, t) === 0;
		})
	) {
		return "tested";
	}
	if (compare(parsed, max) > 0) {
		return "newer";
	}
	if (compare(parsed, min) < 0) {
		return "older";
	}
	return "supported";
}

const COPY: Record<VersionStatus, string | null> = {
	tested: null,
	supported: null,
	newer: `This site runs a newer Ghost than this app supports (up to ${MAX_GHOST}). To protect your posts from incompatible card schemas, editing is read-only unless overridden.`,
	older: `This site runs an older Ghost than this app supports (${MIN_GHOST}+). Newer cards may not render.`,
	unknown: "Couldn't determine this site's Ghost version.",
};

export function versionBanner(version: string): string | null {
	return COPY[checkVersion(version)];
}

/** Only versions above the supported maximum are read-only. */
export function shouldEnforceReadOnly(version: string): boolean {
	return checkVersion(version) === "newer";
}

export type Theme = "system" | "dark" | "light";

export type AppearancePreferences = {
	prefersReducedTransparency: boolean;
	prefersReducedMotion: boolean;
};

const THEME_KEY = "geist.theme.v1";

export const REDUCED_TRANSPARENCY_QUERY =
	"(prefers-reduced-transparency: reduce)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function mediaMatches(query: string): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	try {
		return window.matchMedia(query).matches;
	} catch {
		return false;
	}
}

/**
 * macOS "Reduce transparency" (System Settings → Accessibility → Display).
 * tokens.css mirrors this query and swaps the glass fills for solid ones.
 */
export function prefersReducedTransparency(): boolean {
	return mediaMatches(REDUCED_TRANSPARENCY_QUERY);
}

/**
 * macOS "Reduce motion". tokens.css sets --motion-duration: 0ms and base.css
 * disables transitions, so no component may rely on animation for state.
 */
export function prefersReducedMotion(): boolean {
	return mediaMatches(REDUCED_MOTION_QUERY);
}

export function getAppearancePreferences(): AppearancePreferences {
	return {
		prefersReducedTransparency: prefersReducedTransparency(),
		prefersReducedMotion: prefersReducedMotion(),
	};
}

/**
 * Subscribe to changes in the accessibility appearance preferences.
 * Returns an unsubscribe function; safe to call when matchMedia is unavailable.
 */
export function watchAppearancePreferences(
	listener: (preferences: AppearancePreferences) => void,
): () => void {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return () => {};
	}

	const queries = [REDUCED_TRANSPARENCY_QUERY, REDUCED_MOTION_QUERY];
	const media = queries.map((query) => window.matchMedia(query));
	const onChange = () => listener(getAppearancePreferences());

	for (const entry of media) {
		if (typeof entry.addEventListener === "function") {
			entry.addEventListener("change", onChange);
		} else if (typeof entry.addListener === "function") {
			entry.addListener(onChange);
		}
	}

	return () => {
		for (const entry of media) {
			if (typeof entry.removeEventListener === "function") {
				entry.removeEventListener("change", onChange);
			} else if (typeof entry.removeListener === "function") {
				entry.removeListener(onChange);
			}
		}
	};
}

export function getStoredTheme(): Theme {
	if (typeof window === "undefined" || !window.localStorage) {
		return "system";
	}
	const val = window.localStorage.getItem(THEME_KEY);
	if (val === "dark" || val === "light" || val === "system") {
		return val;
	}
	return "system";
}

export function setStoredTheme(theme: Theme) {
	if (typeof window !== "undefined" && window.localStorage) {
		window.localStorage.setItem(THEME_KEY, theme);
	}
}

export function resolveIsDark(theme: Theme): boolean {
	if (theme === "dark") {
		return true;
	}
	if (theme === "light") {
		return false;
	}
	if (
		typeof window !== "undefined" &&
		window.matchMedia &&
		window.matchMedia("(prefers-color-scheme: dark)").matches
	) {
		return true;
	}
	return false;
}

/**
 * Resolve and apply the given theme (or the stored theme) to the document,
 * then notify listeners so mounted components can react to the change.
 *
 * The `dark` class on <html> is the only switch: tokens.css defines the full
 * token set under `html.dark`, so this is what swaps every surface, label,
 * border, status, and material variable. No second theme system.
 */
export function applyTheme(theme?: Theme): boolean {
	const isDark = resolveIsDark(theme ?? getStoredTheme());

	if (typeof document !== "undefined") {
		const root = document.documentElement;
		root.classList.toggle("dark", isDark);
		// Keep the native scrollbars, form controls, and window chrome in the
		// same appearance as the token set (mirrors tokens.css `color-scheme`).
		if (root.style) {
			root.style.setProperty("color-scheme", isDark ? "dark" : "light");
		}
	}

	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("geist:theme-change", {detail: {isDark}}),
		);
	}

	return isDark;
}

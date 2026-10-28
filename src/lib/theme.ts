export type Theme = "system" | "dark" | "light";

const THEME_KEY = "geist.theme.v1";

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
 */
export function applyTheme(theme?: Theme): boolean {
	const isDark = resolveIsDark(theme ?? getStoredTheme());

	if (typeof document !== "undefined") {
		document.documentElement.classList.toggle("dark", isDark);
	}

	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("geist:theme-change", {detail: {isDark}}),
		);
	}

	return isDark;
}

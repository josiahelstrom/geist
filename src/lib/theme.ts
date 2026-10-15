export type Theme = "system" | "dark" | "light";

const THEME_KEY = "geist.theme.v1";

export function getStoredTheme(): Theme {
	if (typeof window === "undefined" || !window.localStorage) {
		return "system";
	}
	const val = localStorage.getItem(THEME_KEY);
	if (val === "dark" || val === "light" || val === "system") {
		return val;
	}
	return "system";
}

export function setStoredTheme(theme: Theme) {
	if (typeof window !== "undefined" && window.localStorage) {
		localStorage.setItem(THEME_KEY, theme);
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

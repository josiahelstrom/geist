import {useEffect, useState} from "react";
import {
	applyTheme,
	getStoredTheme,
	resolveIsDark,
	setStoredTheme,
	type Theme,
} from "../lib/theme";

export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
	const [isDark, setIsDark] = useState(() => resolveIsDark(getStoredTheme()));

	useEffect(() => {
		setStoredTheme(theme);
		setIsDark(applyTheme(theme));
	}, [theme]);

	useEffect(() => {
		function onThemeChange(event: Event) {
			const detail = (event as CustomEvent<{isDark: boolean}>).detail;
			if (detail && typeof detail.isDark === "boolean") {
				setIsDark(detail.isDark);
			}
		}
		window.addEventListener("geist:theme-change", onThemeChange);
		return () => window.removeEventListener("geist:theme-change", onThemeChange);
	}, []);

	function toggle() {
		setTheme(current => {
			if (current === "system") {
				return isDark ? "light" : "dark";
			}
			return current === "dark" ? "light" : "dark";
		});
	}

	return (
		<button
			type="button"
			onClick={toggle}
			title={`Current theme: ${theme}. Click to toggle.`}
			aria-label="Toggle dark/light theme"
			data-testid="theme-toggle"
		>
			{isDark ? "☀️ Light" : "🌙 Dark"}
		</button>
	);
}

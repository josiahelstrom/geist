import {useEffect, useState} from "react";
import {
	getStoredTheme,
	resolveIsDark,
	setStoredTheme,
	type Theme,
} from "../lib/theme";

export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

	useEffect(() => {
		const isDark = resolveIsDark(theme);
		document.documentElement.classList.toggle("dark", isDark);
		setStoredTheme(theme);
	}, [theme]);

	function toggle() {
		setTheme(current => {
			if (current === "system") {
				return resolveIsDark("system") ? "light" : "dark";
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
			{resolveIsDark(theme) ? "☀️ Light" : "🌙 Dark"}
		</button>
	);
}

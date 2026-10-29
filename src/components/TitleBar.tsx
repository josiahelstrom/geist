import {useCallback, useEffect, useState} from "react";
import {
	applyTheme,
	getStoredTheme,
	resolveIsDark,
	setStoredTheme,
	type Theme,
} from "../lib/theme";
import type {SaveStatus} from "../lib/saver";

export type TitleBarProps = {
	/** Title of the post currently open in the editor, if any. */
	postTitle?: string | null;
	/** Ghost status of the open post (`draft`, `scheduled`, `published`, `sent`). */
	postStatus?: string | null;
	/** Live autosave state mirrored from the editor. */
	saveStatus?: SaveStatus | null;
	sidebarOpen?: boolean;
	inspectorOpen?: boolean;
	onToggleSidebar?: () => void;
	onCycleTheme?: () => void;
	onRefresh?: () => void;
	onOpenRevisions?: () => void;
	onToggleInspector?: () => void;
};

const STATUS_LABELS: Record<string, string> = {
	draft: "Draft",
	scheduled: "Scheduled",
	published: "Published",
	sent: "Sent",
};

const SAVE_LABELS: Record<SaveStatus, string> = {
	clean: "Saved",
	dirty: "Unsaved edits",
	saving: "Saving...",
	saved: "Saved",
	conflict: "Conflict",
	error: "Save failed",
	offline: "Offline (Saved locally)",
};

const THEME_LABELS: Record<Theme, string> = {
	system: "System",
	light: "Light",
	dark: "Dark",
};

const THEME_ORDER: Theme[] = ["light", "dark", "system"];

function statusLabel(status: string): string {
	return (
		STATUS_LABELS[status.toLowerCase()] ??
		status.charAt(0).toUpperCase() + status.slice(1)
	);
}

function statusClass(status: string): string {
	return status
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "");
}

/*
 * 16px hairline glyphs. They inherit `currentColor`, so hover, pressed and
 * dark-mode states are handled entirely by the button styles in chrome.css.
 */
const iconProps = {
	width: 16,
	height: 16,
	viewBox: "0 0 16 16",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 1.5,
	strokeLinecap: "round" as const,
	strokeLinejoin: "round" as const,
	"aria-hidden": true,
};

function SidebarIcon() {
	return (
		<svg {...iconProps}>
			<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
			<path d="M6.25 2.75v10.5" />
		</svg>
	);
}

function SunIcon() {
	return (
		<svg {...iconProps}>
			<circle cx="8" cy="8" r="2.75" />
			<path d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
		</svg>
	);
}

function MoonIcon() {
	return (
		<svg {...iconProps}>
			<path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75 5.5 5.5 0 1 0 13.25 9.6Z" />
		</svg>
	);
}

function SyncIcon() {
	return (
		<svg {...iconProps}>
			<path d="M13 6.5A5 5 0 0 0 3.6 4.4L2.5 5.75M3 9.5a5 5 0 0 0 9.4 2.1l1.1-1.35" />
			<path d="M2.5 3v2.75H5.25M13.5 13v-2.75h-2.75" />
		</svg>
	);
}

function HistoryIcon() {
	return (
		<svg {...iconProps}>
			<circle cx="8" cy="8" r="5.75" />
			<path d="M8 4.75V8l2.25 1.5" />
		</svg>
	);
}

function InspectorIcon() {
	return (
		<svg {...iconProps}>
			<path d="M2.75 4.5h10.5M2.75 11.5h10.5" />
			<circle cx="10" cy="4.5" r="1.5" />
			<circle cx="6" cy="11.5" r="1.5" />
		</svg>
	);
}

export default function TitleBar({
	postTitle,
	postStatus,
	saveStatus,
	sidebarOpen = true,
	inspectorOpen = false,
	onToggleSidebar,
	onCycleTheme,
	onRefresh,
	onOpenRevisions,
	onToggleInspector,
}: TitleBarProps) {
	const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
	const [isDark, setIsDark] = useState(() => resolveIsDark(getStoredTheme()));

	// The theme can be changed from the native menu as well as from here, so
	// follow the shared event instead of owning a private copy of the state.
	useEffect(() => {
		function onThemeChange(event: Event) {
			const detail = (event as CustomEvent<{isDark?: boolean}>).detail;
			if (detail && typeof detail.isDark === "boolean") {
				setIsDark(detail.isDark);
			}
			setTheme(getStoredTheme());
		}
		window.addEventListener("geist:theme-change", onThemeChange);
		return () =>
			window.removeEventListener("geist:theme-change", onThemeChange);
	}, []);

	const cycleAppearance = useCallback(() => {
		if (onCycleTheme) {
			onCycleTheme();
			return;
		}
		// Standalone fallback: light -> dark -> system -> light.
		const current = getStoredTheme();
		const next =
			THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length] ??
			"system";
		setStoredTheme(next);
		applyTheme(next);
	}, [onCycleTheme]);

	const title = postTitle?.trim() || "Geist";
	const hasPost = Boolean(postTitle?.trim() || postStatus);
	const status = postStatus
		? statusLabel(postStatus)
		: null;
	const resolvedSaveStatus: SaveStatus | null =
		saveStatus ?? (hasPost ? "saved" : null);
	const themeLabel = THEME_LABELS[theme];

	return (
		<header
			className="titlebar"
			data-tauri-drag-region
			data-testid="titlebar"
		>
			{/* 78 x 52 reservation under the macOS traffic lights. */}
			<div className="traffic-light-gutter" aria-hidden="true" />

			<div className="titlebar-identity" data-tauri-drag-region>
				<span
					className={
						hasPost ? "titlebar-title" : "titlebar-title titlebar-title-brand"
					}
					title={title}
					data-testid="titlebar-title"
					data-tauri-drag-region
				>
					{title}
				</span>
				{postStatus && (
					<span
						className={`titlebar-status titlebar-status-${statusClass(
							postStatus,
						)}`}
						title={`Post status: ${status}`}
						data-testid="titlebar-post-status"
						data-tauri-drag-region
					>
						{status}
					</span>
				)}
				{resolvedSaveStatus && (
					<span
						className={`titlebar-save titlebar-save-${resolvedSaveStatus}`}
						role="status"
						aria-live="polite"
						data-testid="titlebar-save-status"
						data-tauri-drag-region
					>
						{SAVE_LABELS[resolvedSaveStatus]}
					</span>
				)}
			</div>

			<div
				className="titlebar-actions glass-pill titlebar-no-drag"
				role="toolbar"
				aria-label="Window toolbar"
			>
				<button
					type="button"
					className="titlebar-button titlebar-no-drag"
					onClick={onToggleSidebar}
					title="Toggle sidebar (⌘\\)"
					aria-label="Toggle sidebar"
					aria-pressed={sidebarOpen}
					data-testid="titlebar-sidebar-toggle"
				>
					<SidebarIcon />
				</button>
				<button
					type="button"
					className="titlebar-button titlebar-no-drag"
					onClick={cycleAppearance}
					title={`Cycle appearance: ${themeLabel} (⌘⇧L)`}
					aria-label={`Cycle appearance. Current: ${themeLabel}`}
					data-testid="titlebar-theme-cycle"
				>
					{isDark ? <MoonIcon /> : <SunIcon />}
				</button>
				<button
					type="button"
					className="titlebar-button titlebar-no-drag"
					onClick={onRefresh}
					title="Sync / refresh"
					aria-label="Sync posts"
					data-testid="titlebar-sync"
				>
					<SyncIcon />
				</button>
				<button
					type="button"
					className="titlebar-button titlebar-no-drag"
					onClick={onOpenRevisions}
					title="Post history"
					aria-label="Open post history"
					data-testid="titlebar-revisions"
				>
					<HistoryIcon />
				</button>
				<button
					type="button"
					className="titlebar-button titlebar-no-drag"
					onClick={onToggleInspector}
					title="Post settings (⌘⌥I)"
					aria-label="Toggle post settings inspector"
					aria-pressed={inspectorOpen}
					data-testid="titlebar-inspector-toggle"
				>
					<InspectorIcon />
				</button>
			</div>
		</header>
	);
}

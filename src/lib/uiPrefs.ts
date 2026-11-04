import {useSyncExternalStore} from "react";

export type EditorFont = "serif" | "sans" | "mono";
export type EditorEngine = "koenig" | "lexical-lab";

export type UiPrefs = {
	/** Keep the excerpt row visible under the title even when the post has no excerpt. */
	alwaysShowExcerpt: boolean;
	/** Render the post's feature image at the top of the editor canvas. */
	showFeatureImage: boolean;
	/** Body typography style in the editor canvas. */
	editorFont: EditorFont;
	/** Keep the active line vertically centered while typing. */
	typewriterMode: boolean;
	/** Editor engine for scraps and posts. */
	editorEngine: EditorEngine;
};

const UI_PREFS_KEY = "geist.ui-prefs.v1";
const UI_PREFS_EVENT = "geist:ui-prefs-change";

export const DEFAULT_UI_PREFS: UiPrefs = {
	alwaysShowExcerpt: false,
	showFeatureImage: true,
	editorFont: "serif",
	typewriterMode: false,
	editorEngine: "lexical-lab",
};

const listeners = new Set<(prefs: UiPrefs) => void>();
let cache: UiPrefs | null = null;

function readUiPrefs(): UiPrefs {
	if (typeof window === "undefined" || !window.localStorage) {
		return {...DEFAULT_UI_PREFS};
	}

	let raw: string | null;
	try {
		raw = window.localStorage.getItem(UI_PREFS_KEY);
	} catch {
		return {...DEFAULT_UI_PREFS};
	}
	if (raw === null) {
		return {...DEFAULT_UI_PREFS};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {...DEFAULT_UI_PREFS};
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {...DEFAULT_UI_PREFS};
	}

	// Fill each field independently so one bad value cannot reset the rest.
	// Unknown keys are ignored because only the known fields are read.
	const record = parsed as Record<string, unknown>;
	const editorFont =
		record.editorFont === "serif" ||
		record.editorFont === "sans" ||
		record.editorFont === "mono"
			? record.editorFont
			: DEFAULT_UI_PREFS.editorFont;

	const editorEngine =
		record.editorEngine === "lexical-lab" || record.editorEngine === "koenig"
			? record.editorEngine
			: DEFAULT_UI_PREFS.editorEngine;

	return {
		alwaysShowExcerpt:
			typeof record.alwaysShowExcerpt === "boolean"
				? record.alwaysShowExcerpt
				: DEFAULT_UI_PREFS.alwaysShowExcerpt,
		showFeatureImage:
			typeof record.showFeatureImage === "boolean"
				? record.showFeatureImage
				: DEFAULT_UI_PREFS.showFeatureImage,
		editorFont,
		typewriterMode:
			typeof record.typewriterMode === "boolean"
				? record.typewriterMode
				: DEFAULT_UI_PREFS.typewriterMode,
		editorEngine,
	};
}

function notify(prefs: UiPrefs) {
	for (const listener of Array.from(listeners)) {
		listener(prefs);
	}

	if (typeof window !== "undefined") {
		try {
			window.dispatchEvent(
				new CustomEvent(UI_PREFS_EVENT, {detail: prefs}),
			);
		} catch {
			// CustomEvent unavailable or dispatch blocked; listeners were notified.
		}
	}
}

export function getUiPrefs(): UiPrefs {
	if (cache === null) {
		cache = readUiPrefs();
	}
	return cache;
}

export function setUiPrefs(patch: Partial<UiPrefs>): UiPrefs {
	const current = getUiPrefs();
	const next: UiPrefs = {
		alwaysShowExcerpt:
			typeof patch.alwaysShowExcerpt === "boolean"
				? patch.alwaysShowExcerpt
				: current.alwaysShowExcerpt,
		showFeatureImage:
			typeof patch.showFeatureImage === "boolean"
				? patch.showFeatureImage
				: current.showFeatureImage,
		editorFont:
			patch.editorFont === "serif" ||
			patch.editorFont === "sans" ||
			patch.editorFont === "mono"
				? patch.editorFont
				: current.editorFont,
		typewriterMode:
			typeof patch.typewriterMode === "boolean"
				? patch.typewriterMode
				: current.typewriterMode,
		editorEngine:
			patch.editorEngine === "lexical-lab" || patch.editorEngine === "koenig"
				? patch.editorEngine
				: current.editorEngine,
	};

	cache = next;

	if (typeof window !== "undefined" && window.localStorage) {
		try {
			window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next));
		} catch {
			// Storage unavailable (quota, private mode); keep the in-memory value.
		}
	}

	notify(next);
	return next;
}

export function subscribeUiPrefs(
	listener: (prefs: UiPrefs) => void,
): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Pure rule for the excerpt row: an explicit setting always keeps it visible,
 * otherwise it only stays visible when the post has a non-whitespace excerpt.
 * The editor calls this so hiding logic and the preference never diverge.
 */
export function shouldShowExcerpt(
	customExcerpt: string,
	alwaysShow: boolean,
): boolean {
	return alwaysShow || customExcerpt.trim().length > 0;
}

const subscribeForReact = (onStoreChange: () => void) =>
	subscribeUiPrefs(() => onStoreChange());

export function useUiPrefs(): UiPrefs {
	return useSyncExternalStore(subscribeForReact, getUiPrefs, getUiPrefs);
}

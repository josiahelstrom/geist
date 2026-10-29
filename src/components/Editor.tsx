import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {openUrl} from "@tauri-apps/plugin-opener";
import {KoenigComposer, KoenigEditor} from "@tryghost/koenig-lexical";
import "@tryghost/koenig-lexical/style.css";
import {
	GhostError,
	fetchPost,
	listActiveNewsletters,
	listSiteAuthors,
	listSiteTags,
	listSiteTiers,
	type AuthorSummary,
	type NewsletterSummary,
	type PostDetail,
	type PostRevision,
	type Site,
	type TagSummary,
	type TierSummary,
} from "../lib/api";
import {createSaver, isNetworkError, type SaveStatus} from "../lib/saver";
import {createChangeFilter} from "../lib/changeFilter";
import {
	cacheDraft,
	getCachedDraft,
	listPendingPatches,
	markDraftClean,
	removeCachedDraft,
} from "../lib/draftCache";
import {
	DEFAULT_SETTINGS,
	buildCardConfig,
	listSnippets,
	loadSiteSettings,
	type SiteSettings,
	type Snippet,
} from "../lib/cardConfig";
import {makeFileUploader} from "../lib/uploader";
import {
	MAX_EXCERPT_LENGTH,
	canPublishRole,
	deletePost,
	fetchEmbed,
	openInAppPreview,
	openPostInAdmin,
	previewUrl,
	publishWithNewsletter,
	schedulePost,
	setPostStatus,
	unschedulePost,
	type PreviewMemberStatus,
} from "../lib/posts";
import {buildRestorePatch} from "../lib/revisions";
import {
	demoteDraftToScrap,
	getScrap,
	promoteScrapToDraft,
	updateScrap,
	type Scrap,
} from "../lib/scraps";
import {versionBanner, shouldEnforceReadOnly} from "../lib/version";
import EditorErrorBoundary from "./EditorErrorBoundary";
import MetadataSidebar, {type PostMetadataState} from "./MetadataSidebar";
import PublishModal, {type PublishAction} from "./PublishModal";
import RevisionsDrawer from "./RevisionsDrawer";

type Props = {
	site: Site;
	/** Ghost post being edited, when this is a server-backed editor. */
	postId?: string;
	/** Local scrap being edited, when this is a local-first editor. */
	scrapId?: string;
	onBack: () => void;
	onReconnect?: () => void;
	/** Promote (scrap → draft) hands the new Ghost post to the app. */
	onOpenPost?: (post: PostDetail) => void;
	/** Demote (draft → scrap) hands the new local scrap to the app. */
	onOpenScrap?: (scrap: Scrap) => void;
};

const STATUS_COPY: Record<SaveStatus, string> = {
	clean: "",
	dirty: "Unsaved",
	saving: "Saving…",
	saved: "Saved",
	conflict: "Conflict",
	error: "Save failed",
	offline: "Offline (Saved locally)",
};

/** Walk a Lexical editor-state JSON tree and collect its text runs. */
function textFromLexicalNode(node: unknown): string {
	if (!node || typeof node !== "object") {
		return "";
	}
	const value = node as {
		text?: unknown;
		type?: unknown;
		children?: unknown[];
	};
	let text = typeof value.text === "string" ? value.text : "";
	if (value.type === "linebreak") {
		text += " ";
	}
	if (Array.isArray(value.children)) {
		text += ` ${value.children.map(textFromLexicalNode).join(" ")}`;
	}
	return text;
}

/** Count words in the serialised Lexical state, independent of the saver. */
function countWords(lexical: string): number {
	if (!lexical.trim()) {
		return 0;
	}
	try {
		const parsed = JSON.parse(lexical) as unknown;
		const text = textFromLexicalNode(parsed).trim();
		return text ? (text.match(/\S+/g)?.length ?? 0) : 0;
	} catch {
		// A half-written state must never break the editor chrome.
		return 0;
	}
}

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

function ArrowLeftIcon() {
	return (
		<svg {...iconProps}>
			<path d="M10.75 3.5 5.25 8l5.5 4.5" />
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

function SidebarIcon() {
	return (
		<svg {...iconProps}>
			<rect x="2.25" y="2.75" width="11.5" height="10.5" rx="2" />
			<path d="M6.25 2.75v10.5" />
		</svg>
	);
}

function metaFromPost(p: PostDetail): PostMetadataState {
	return {
		slug: p.slug ?? "",
		customExcerpt: p.custom_excerpt ?? "",
		featureImage: p.feature_image ?? "",
		featureImageAlt: p.feature_image_alt ?? "",
		featureImageCaption: p.feature_image_caption ?? "",
		featured: Boolean(p.featured),
		visibility: p.visibility ?? "public",
		tiers: (p.tiers ?? []).filter(t => t.type === "paid"),
		tags: p.tags ?? [],
		authors: p.authors ?? [],
	};
}

const EMPTY_META: PostMetadataState = {
	slug: "",
	customExcerpt: "",
	featureImage: "",
	featureImageAlt: "",
	featureImageCaption: "",
	featured: false,
	visibility: "public",
	tiers: [],
	tags: [],
	authors: [],
};

export default function Editor({
	site,
	postId,
	scrapId,
	onBack,
	onReconnect,
	onOpenPost,
	onOpenScrap,
}: Props) {
	const isScrapMode = Boolean(scrapId);
	const [post, setPost] = useState<PostDetail | null>(null);
	const [scrap, setScrap] = useState<Scrap | null>(null);
	const [editorVersion, setEditorVersion] = useState(0);
	const [title, setTitle] = useState("");
	const [meta, setMeta] = useState<PostMetadataState>(EMPTY_META);
	const [siteTags, setSiteTags] = useState<TagSummary[]>([]);
	const [siteAuthors, setSiteAuthors] = useState<AuthorSummary[]>([]);
	const [siteTiers, setSiteTiers] = useState<TierSummary[]>([]);
	const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
	const [drawer, setDrawer] = useState<"none" | "settings" | "revisions">(
		"none",
	);
	const [publishModalOpen, setPublishModalOpen] = useState(false);
	const [previewMode, setPreviewMode] =
		useState<PreviewMemberStatus>("default");

	const [status, setStatus] = useState<SaveStatus>("clean");
	// Read by the long-lived close listener, which must not re-subscribe on
	// every save-status change.
	const statusRef = useRef<SaveStatus>("clean");
	statusRef.current = status;
	const [statusMessage, setStatusMessage] = useState<string | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [errorStatus, setErrorStatus] = useState<number | undefined>();
	const [conflict, setConflict] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [demoting, setDemoting] = useState(false);
	const [readOnlyOverride, setReadOnlyOverride] = useState(false);
	const [lexical, setLexical] = useState<string>("");

	const [editorError, setEditorError] = useState<string | null>(null);
	const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
	const [snippets, setSnippets] = useState<Snippet[]>([]);
	const [wordCount, setWordCount] = useState(0);

	const [offlineCachedAt, setOfflineCachedAt] = useState<string | null>(null);

	const saverRef = useRef<ReturnType<typeof createSaver> | null>(null);
	/** Latest known post, including patches the saver has not round-tripped. */
	const postRef = useRef<PostDetail | null>(null);
	const changeFilterRef = useRef(createChangeFilter());
	const editorErrorRef = useRef(false);
	const activePostIdRef = useRef<string | undefined>(postId);
	const excerptRef = useRef<HTMLTextAreaElement | null>(null);
	const scrapRef = useRef<Scrap | null>(null);
	const scrapSaveTimerRef = useRef<number | undefined>(undefined);
	/**
	 * True while a promote/demote/publish is in flight. Scrap autosave is
	 * suspended then so a late debounce cannot try to update a scrap that was
	 * just promoted (and therefore deleted) or navigated away from.
	 */
	const scrapSaveBlockedRef = useRef(false);
	const pendingScrapPatchRef = useRef<
		Partial<Pick<Scrap, "title" | "lexical" | "customExcerpt">>
	>({});

	useEffect(() => {
		activePostIdRef.current = postId;
	}, [postId]);

	// Keep the ref in sync with the rendered post so a stale copy cannot leak
	// into the saver's cache bookkeeping after publish/schedule/restore.
	useEffect(() => {
		postRef.current = post;
	}, [post]);

	// Any long-running publish/promote/demote action suspends scrap autosave;
	// the promote/demote handlers also set this synchronously before awaiting.
	useEffect(() => {
		scrapSaveBlockedRef.current = publishing || demoting;
	}, [publishing, demoting]);

	// Computed synchronously so the guard is correct on the very first render
	// (stable callbacks read it through the ref). Scraps are local-only, so the
	// Ghost version guard never blocks editing them.
	const isReadOnly =
		!isScrapMode &&
		shouldEnforceReadOnly(site.version) &&
		!readOnlyOverride;
	const isReadOnlyRef = useRef(isReadOnly);
	isReadOnlyRef.current = isReadOnly;

	const [isDark, setIsDark] = useState(
		() =>
			typeof document !== "undefined" &&
			document.documentElement.classList.contains("dark"),
	);

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

	// The floating word count is chrome, not document content: it updates on a
	// short debounce and never participates in saving.
	useEffect(() => {
		const timer = window.setTimeout(() => {
			setWordCount(countWords(lexical));
		}, 250);
		return () => window.clearTimeout(timer);
	}, [lexical]);

	// The excerpt is a borderless, auto-growing inline field.
	useEffect(() => {
		const el = excerptRef.current;
		if (!el) {
			return;
		}
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [meta.customExcerpt]);

	const bindPost = useCallback(
		(p: PostDetail) => {
			setPost(p);
			postRef.current = p;
			setScrap(null);
			scrapRef.current = null;
			setTitle(p.title ?? "");
			setLexical(p.lexical ?? "");
			setMeta(metaFromPost(p));
			setConflict(false);
			setStatus("clean");
			setStatusMessage(undefined);
			setOfflineCachedAt(null);
			setEditorError(null);
			editorErrorRef.current = false;
			changeFilterRef.current.reset();
			saverRef.current = createSaver(site, p.id, p.updated_at, {
				onStatus: (s, message) => {
					setStatus(s);
					setStatusMessage(message);
				},
				onConflict: () => setConflict(true),
				// Never lose work when the network drops: the dirty patch (and
				// any edits queued behind it) is written to the local cache.
				onOfflineSave: async patch => {
					const base = postRef.current ?? p;
					// A second offline edit must not drop the first one: merge
					// any already-cached pending patch under the new edits.
					let existingPatch: Partial<PostDetail> = {};
					try {
						const cached = await getCachedDraft(site.base, p.id);
						if (cached?.pendingPatch) {
							existingPatch = cached.pendingPatch;
						}
					} catch {
						/* Cache reads are best-effort. */
					}
					const mergedPatch = {
						...existingPatch,
						...patch,
					} as Partial<PostDetail>;
					const cachedPost = {
						...base,
						...mergedPatch,
						id: p.id,
					} as PostDetail;
					postRef.current = cachedPost;
					await cacheDraft(site.base, cachedPost, {
						dirty: true,
						pendingPatch: mergedPatch,
					});
				},
				// A successful PUT means the local copy matches the server.
				onSaveSuccess: (updatedAt, patch) => {
					const base = postRef.current ?? p;
					const freshPost = {
						...base,
						...patch,
						id: p.id,
						updated_at: updatedAt,
					} as PostDetail;
					postRef.current = freshPost;
					setOfflineCachedAt(null);
					void markDraftClean(site.base, p.id, freshPost).catch(
						() => {
							/* Cache bookkeeping is best-effort. */
						},
					);
				},
			});
		},
		[site],
	);

	const bindScrap = useCallback((s: Scrap) => {
		setScrap(s);
		scrapRef.current = s;
		setPost(null);
		postRef.current = null;
		setOfflineCachedAt(null);
		setTitle(s.title);
		setLexical(s.lexical);
		setMeta({...EMPTY_META, customExcerpt: s.customExcerpt ?? ""});
		setConflict(false);
		setStatus("clean");
		setStatusMessage(undefined);
		setEditorError(null);
		editorErrorRef.current = false;
		setDrawer("none");
		setPublishModalOpen(false);
		changeFilterRef.current.reset();
		pendingScrapPatchRef.current = {};
	}, []);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		setErrorStatus(undefined);

		if (scrapId) {
			getScrap(site.base, scrapId)
				.then(found => {
					if (cancelled) {
						return;
					}
					if (!found) {
						setError("Scrap not found.");
						return;
					}
					bindScrap(found);
				})
				.catch(err => {
					if (!cancelled) {
						setError(err instanceof Error ? err.message : String(err));
					}
				});

			return () => {
				cancelled = true;
			};
		}

		if (!postId) {
			return () => {
				cancelled = true;
			};
		}

		fetchPost(site, postId)
			.then(async p => {
				if (cancelled) {
					return;
				}
				bindPost(p);
				// Keep a local copy so the post can be reopened offline.
				try {
					const cached = await getCachedDraft(site.base, p.id);
					if (cancelled) {
						return;
					}
					if (cached?.dirty && cached.pendingPatch) {
						// Local edits are newer than the server copy: replay them
						// rather than overwriting the dirty cache with a clean one.
						saverRef.current?.queue(
							cached.pendingPatch as Record<string, unknown>,
						);
						await saverRef.current?.flush();
					} else {
						await cacheDraft(site.base, p);
					}
				} catch {
					/* Caching is best-effort; the editor still works without it. */
				}
			})
			.catch(async err => {
				if (cancelled) {
					return;
				}
				if (isNetworkError(err)) {
					const cached = await getCachedDraft(site.base, postId).catch(
						() => null,
					);
					if (cancelled) {
						return;
					}
					if (cached) {
						bindPost(cached.post);
						// Show when the copy was taken; set after bindPost,
						// which clears the banner for a fresh load.
						setOfflineCachedAt(cached.cachedAt);
						// Replay edits that never reached Ghost so the saver
						// still knows about them when the connection returns.
						if (
							cached.pendingPatch &&
							Object.keys(cached.pendingPatch).length > 0
						) {
							saverRef.current?.queue(
								cached.pendingPatch as Record<string, unknown>,
							);
						}
						return;
					}
				}
				if (err instanceof GhostError) {
					setError(err.message);
					setErrorStatus(err.status);
				} else {
					setError(String(err));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [site, postId, scrapId, bindPost, bindScrap]);

	// When the connection comes back, push any edits that were saved locally
	// while offline. 409 still wins: the saver halts rather than clobbering.
	useEffect(() => {
		if (!postId || scrapId) {
			return;
		}
		let cancelled = false;

		async function replayPendingPatches() {
			if (activePostIdRef.current !== postId) {
				return;
			}
			try {
				const pending = await listPendingPatches(site.base);
				if (cancelled || activePostIdRef.current !== postId) {
					return;
				}
				const target = pending.find(draft => draft.postId === postId);
				const patch = target?.pendingPatch;
				if (!patch || Object.keys(patch).length === 0) {
					return;
				}
				saverRef.current?.queue(patch as Record<string, unknown>);
				await saverRef.current?.flush();
			} catch {
				/* Still unreachable; the patch stays cached for next time. */
			}
		}

		window.addEventListener("online", replayPendingPatches);
		return () => {
			cancelled = true;
			window.removeEventListener("online", replayPendingPatches);
		};
	}, [site.base, postId, scrapId]);

	// Post-only metadata pickers. Local scraps never need the Ghost taxonomy.
	useEffect(() => {
		if (!postId || scrapId) {
			return;
		}
		let cancelled = false;
		listSiteTags(site).then(tags => {
			if (!cancelled) {
				setSiteTags(tags);
			}
		});
		listSiteAuthors(site).then(authors => {
			if (!cancelled) {
				setSiteAuthors(authors);
			}
		});
		listSiteTiers(site).then(tiers => {
			if (!cancelled) {
				setSiteTiers(tiers);
			}
		});
		listActiveNewsletters(site).then(list => {
			if (!cancelled) {
				setNewsletters(list);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [site, postId, scrapId]);

	const refreshSnippets = useCallback(() => {
		if (site.keyKind === "staff") {
			listSnippets(site).then(setSnippets);
		}
	}, [site]);

	// Background revision refreshes must never clobber the post's updated_at or
	// race with in-flight edits, so only merge the revision list and only for
	// the post that is still active.
	const refreshRevisions = useCallback(
		(targetId: string) => {
			fetchPost(site, targetId)
				.then(fresh => {
					if (activePostIdRef.current !== targetId) {
						return;
					}
					setPost(prev =>
						prev && prev.id === targetId
							? {...prev, post_revisions: fresh.post_revisions}
							: prev,
					);
				})
				.catch(() => {
					/* Revision refresh is best-effort; the save status already shows errors. */
				});
		},
		[site],
	);

	// Card-config data arrives after the editor mounts; cardConfig only lives
	// in Koenig's context, so updating it does not remount the editor. Scraps
	// stay completely local, so they skip these Ghost settings calls.
	useEffect(() => {
		if (isScrapMode) {
			setSettings(DEFAULT_SETTINGS);
			setSnippets([]);
			return;
		}
		let cancelled = false;
		setSettings(DEFAULT_SETTINGS);
		setSnippets([]);
		loadSiteSettings(site).then(s => {
			if (!cancelled) {
				setSettings(s);
			}
		});
		if (site.keyKind === "staff") {
			listSnippets(site).then(list => {
				if (!cancelled) {
					setSnippets(list);
				}
			});
		}
		return () => {
			cancelled = true;
		};
	}, [site, isScrapMode]);

	const fileUploader = useMemo(() => makeFileUploader(site), [site]);

	const cardConfig = useMemo(
		() => ({
			...buildCardConfig(site, {
				settings,
				snippets,
				postVisibility: meta.visibility,
				onSnippetsChanged: refreshSnippets,
			}),
			fetchEmbed: (url: string, {type}: {type: string}) =>
				fetchEmbed(site, url, type),
		}),
		[site, settings, snippets, refreshSnippets, meta.visibility],
	);

	const cancelPendingScrapSave = useCallback(() => {
		if (scrapSaveTimerRef.current !== undefined) {
			window.clearTimeout(scrapSaveTimerRef.current);
			scrapSaveTimerRef.current = undefined;
		}
	}, []);

	const flushScrapSave = useCallback(async () => {
		cancelPendingScrapSave();
		const target = scrapRef.current;
		const pending = pendingScrapPatchRef.current;
		if (!target || Object.keys(pending).length === 0) {
			return;
		}

		pendingScrapPatchRef.current = {};
		setStatus("saving");
		try {
			const updated = await updateScrap(site.base, target.id, pending);
			scrapRef.current = updated;
			setScrap(prev =>
				prev
					? {
							...prev,
							updatedAt: updated.updatedAt,
							wordCount: updated.wordCount,
						}
					: prev,
			);
			if (Object.keys(pendingScrapPatchRef.current).length === 0) {
				setStatus("saved");
				setStatusMessage(undefined);
			} else {
				setStatus("dirty");
			}
		} catch (err) {
			pendingScrapPatchRef.current = {
				...pending,
				...pendingScrapPatchRef.current,
			};
			setStatus("error");
			setStatusMessage(err instanceof Error ? err.message : String(err));
		}
	}, [site.base, cancelPendingScrapSave]);

	const queueScrapSave = useCallback(
		(
			patch: Partial<
				Pick<Scrap, "title" | "lexical" | "customExcerpt">
			>,
		) => {
			// A promote/demote/publish is running: the scrap this editor points
			// at may already be gone (or is about to be), so dropping the edit
			// beats surfacing a "Scrap not found" error mid-navigation.
			if (scrapSaveBlockedRef.current) {
				cancelPendingScrapSave();
				return;
			}
			pendingScrapPatchRef.current = {
				...pendingScrapPatchRef.current,
				...patch,
			};
			setStatus("dirty");
			if (scrapSaveTimerRef.current !== undefined) {
				window.clearTimeout(scrapSaveTimerRef.current);
			}
			scrapSaveTimerRef.current = window.setTimeout(() => {
				void flushScrapSave();
			}, 600);
		},
		[flushScrapSave, cancelPendingScrapSave],
	);

	// Leaving the editor (or switching scraps) must not drop a pending local
	// edit. This is local-only, so firing it during cleanup is safe.
	useEffect(() => {
		return () => {
			cancelPendingScrapSave();
			const target = scrapRef.current;
			const pending = pendingScrapPatchRef.current;
			if (target && Object.keys(pending).length > 0) {
				pendingScrapPatchRef.current = {};
				void updateScrap(site.base, target.id, pending).catch(() => {});
			}
		};
	}, [site.base, scrapId, cancelPendingScrapSave]);

	const handleBody = useCallback(
		(state: unknown) => {
			if (isReadOnlyRef.current) {
				return; // version guard is active; never queue edits
			}
			if (editorErrorRef.current) {
				return; // the editor is in a failed state; never save its body
			}
			const next = JSON.stringify(state);
			setLexical(next);
			// Koenig emits onChange on mount; only genuine edits should save.
			if (changeFilterRef.current.accept(next)) {
				if (isScrapMode) {
					queueScrapSave({lexical: next});
				} else {
					saverRef.current?.queueDebounced({lexical: next});
				}
			}
		},
		[isScrapMode, queueScrapSave],
	);

	const handleEditorError = useCallback((err: unknown) => {
		editorErrorRef.current = true;
		const message = err instanceof Error ? err.message : String(err);
		queueMicrotask(() => setEditorError(message));
		throw err; // keep Lexical's contract: onError must not swallow
	}, []);

	const handleTitle = useCallback(
		(value: string) => {
			if (isReadOnlyRef.current) {
				return;
			}
			setTitle(value);
			if (isScrapMode) {
				queueScrapSave({title: value});
			} else {
				saverRef.current?.queueDebounced({title: value});
			}
		},
		[isScrapMode, queueScrapSave],
	);

	const handleMetaChange = useCallback(
		(nextMeta: PostMetadataState, patch: Record<string, unknown>) => {
			if (isReadOnlyRef.current) {
				return;
			}
			setMeta(nextMeta);
			if (isScrapMode) {
				queueScrapSave({
					customExcerpt: nextMeta.customExcerpt || null,
				});
			} else {
				saverRef.current?.queueDebounced(patch, 900);
			}
		},
		[isScrapMode, queueScrapSave],
	);

	// Cmd+S saves now, as a revision (or flushes the local scrap save).
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				if (isReadOnlyRef.current) {
					return;
				}
				if (scrapId) {
					void flushScrapSave();
					return;
				}
				saverRef.current
					?.flush(true)
					.then(() => postId && refreshRevisions(postId));
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [postId, scrapId, flushScrapSave, refreshRevisions]);

	// The native menu's "Save Revision" item dispatches this event so it takes
	// exactly the same path as the Cmd+S shortcut above.
	useEffect(() => {
		function onSaveRevision() {
			if (isReadOnlyRef.current) {
				return;
			}
			if (scrapId) {
				void flushScrapSave();
				return;
			}
			saverRef.current
				?.flush(true)
				.then(
					() =>
						activePostIdRef.current &&
						refreshRevisions(activePostIdRef.current),
				);
		}
		window.addEventListener("geist:save-revision", onSaveRevision);
		return () =>
			window.removeEventListener("geist:save-revision", onSaveRevision);
	}, [scrapId, flushScrapSave, refreshRevisions]);

	// Warn before closing with unsaved work.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let cancelled = false;

		getCurrentWindow()
			.onCloseRequested(async event => {
				if (isScrapMode) {
					const hasPendingPatch =
						Object.keys(pendingScrapPatchRef.current).length > 0;
					const autosaveActive =
						scrapSaveTimerRef.current !== undefined;
					const saveStatus = statusRef.current;
					const unsaved =
						hasPendingPatch ||
						autosaveActive ||
						saveStatus === "dirty" ||
						(saveStatus as string) === "unsaved" ||
						saveStatus === "error";
					if (!unsaved) {
						return; // nothing to lose
					}
					event.preventDefault();
					const save = window.confirm(
						"You have unsaved edits in this scrap. Save them before closing?",
					);
					try {
						if (save) {
							await flushScrapSave();
							if (
								Object.keys(pendingScrapPatchRef.current)
									.length > 0
							) {
								// Still unsaved (e.g. disk error): leave the
								// window open rather than discard the work.
								return;
							}
						}
						await getCurrentWindow().destroy().catch(() => {});
					} catch {
						// Could not save: leave the window open rather than
						// throw the work away silently.
					}
					return;
				}

				const saver = saverRef.current;
				if (!saver?.hasPending || saver.conflict) {
					return; // nothing to lose
				}
				event.preventDefault();
				const save = window.confirm(
					"This post has unsaved changes.\n\nSave before closing?",
				);
				try {
					if (save) {
						await saver.flush();
					}
					await getCurrentWindow().destroy().catch(() => {});
				} catch {
					// Could not save: leave the window open rather than throw the
					// work away silently.
				}
			})
			.then(fn => {
				if (cancelled) {
					fn();
				} else {
					unlisten = fn;
				}
			})
			.catch(() => {
				/* window API unavailable; the status indicator still shows state */
			});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, [isScrapMode, flushScrapSave]);

	function markInteraction() {
		changeFilterRef.current.markInteraction();
	}

	async function handleBack() {
		if (isScrapMode) {
			await flushScrapSave();
			if (Object.keys(pendingScrapPatchRef.current).length > 0) {
				const leave = window.confirm(
					"Your latest scrap changes could not be saved locally.\n\nLeave anyway and discard them?",
				);
				if (!leave) {
					return;
				}
				pendingScrapPatchRef.current = {};
			}
			onBack();
			return;
		}
		const saver = saverRef.current;
		if (saver) {
			await saver.flush();
			if (saver.hasPending) {
				const leave = window.confirm(
					"Your latest changes could not be saved.\n\nLeave anyway and discard them?",
				);
				if (!leave) {
					return;
				}
				saver.halt();
			}
		}
		onBack();
	}

	function renderEditorFallback(message: string) {
		return (
			<div className="error-banner" role="alert" data-testid="editor-fallback">
				<span>
					{isScrapMode ? "This scrap" : "This post"} can&apos;t be shown in the
					editor (it may use content from a newer Ghost). Your{" "}
					{isScrapMode ? "scrap has" : "post has"} not been changed. Details:{" "}
					{message}
				</span>
				{post && (
					<div className="banner-actions">
						<button
							type="button"
							onClick={() => {
								void openPostInAdmin(post.id, site).catch(
									() => {},
								);
							}}
						>
							Open in Ghost Admin ↗
						</button>
					</div>
				)}
			</div>
		);
	}

	async function handleInAppPreview() {
		if (!post) {
			return;
		}
		setError(null);
		try {
			await saverRef.current?.flush();
			await openInAppPreview(site.siteUrl, post.uuid, title, previewMode);
		} catch (err) {
			// Fall back to system browser if the preview window fails for any reason.
			void openUrl(
				previewUrl(site.siteUrl, post.uuid, previewMode),
			).catch(() => {});
			if (err instanceof Error) {
				setError(err.message);
			}
		}
	}

	async function handleBrowserPreview() {
		if (!post) {
			return;
		}
		await saverRef.current?.flush();
		void openUrl(
			previewUrl(site.siteUrl, post.uuid, previewMode),
		).catch(() => {});
	}

	async function handleReloadServerVersion() {
		if (!post) {
			return;
		}
		setError(null);
		try {
			saverRef.current?.halt();
			const fresh = await fetchPost(site, post.id);
			bindPost(fresh);
			// The user chose the server copy: clear any dirty cache so those
			// discarded local edits are not replayed on the next load.
			void markDraftClean(site.base, fresh.id, fresh).catch(() => {
				/* Cache bookkeeping is best-effort. */
			});
			setEditorVersion(v => v + 1);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handleOverwriteConflict() {
		if (!post || !saverRef.current) {
			return;
		}
		setError(null);
		try {
			const fresh = await fetchPost(site, post.id);
			// The saver is halted while the 409 banner is shown, so edits typed
			// during the conflict never entered its pending patch. Queue the
			// full on-screen state before resuming so the overwrite keeps them.
			const currentPatch = {
				title,
				lexical,
				custom_excerpt: meta.customExcerpt,
			};
			saverRef.current?.queue(currentPatch);
			await saverRef.current?.resumeWithUpdatedAt(fresh.updated_at);
			setConflict(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function handlePublish(nextStatus: "draft") {
		if (!post || !confirmPublish(nextStatus)) {
			return;
		}
		setPublishing(true);
		setError(null);
		try {
			await saverRef.current?.flush();
			// Rule 4.2 lives inside setPostStatus: status only, never newsletter.
			const result = await setPostStatus(
				site,
				post.id,
				saverRef.current?.updatedAt ?? post.updated_at,
				nextStatus,
			);
			saverRef.current?.adoptUpdatedAt(result.updated_at);
			setPost(prev =>
				prev
					? {
							...prev,
							status: result.status,
							updated_at: result.updated_at,
						}
					: prev,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPublishing(false);
		}
	}

	async function handlePublishAction(action: PublishAction) {
		if (!post) {
			return;
		}
		setPublishing(true);
		setError(null);
		try {
			await saverRef.current?.flush();
			const currentUpdatedAt =
				saverRef.current?.updatedAt ?? post.updated_at;
			let result: {status: string; updated_at: string};

			if (action.kind === "publish-web") {
				result = await setPostStatus(
					site,
					post.id,
					currentUpdatedAt,
					"published",
				);
			} else if (action.kind === "publish-email") {
				result = await publishWithNewsletter(
					site,
					post.id,
					currentUpdatedAt,
					{
						newsletterSlug: action.newsletterSlug,
						emailSegment: action.emailSegment,
						emailOnly: action.emailOnly,
						confirmedRecipientCount:
							action.confirmedRecipientCount,
					},
				);
			} else {
				result = await schedulePost(site, post.id, currentUpdatedAt, {
					publishedAt: action.publishedAt,
					newsletterSlug: action.newsletterSlug,
					emailSegment: action.emailSegment,
					emailOnly: action.emailOnly,
				});
			}

			saverRef.current?.adoptUpdatedAt(result.updated_at);
			setPublishModalOpen(false);

			// Refresh while `publishing` is still true so the modal stays busy
			// and a late save can't race the refreshed updated_at.
			const fresh = await fetchPost(site, post.id).catch(() => null);
			if (fresh) {
				setPost(fresh);
				saverRef.current?.adoptUpdatedAt(fresh.updated_at);
			} else {
				// Fall back to the mutation result if the refresh failed.
				setPost(prev =>
					prev
						? {
								...prev,
								status: result.status,
								updated_at: result.updated_at,
							}
						: prev,
				);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPublishing(false);
		}
	}

	async function handleUnschedule() {
		if (!post) {
			return;
		}
		const ok = window.confirm(
			`Unschedule this post on "${site.title}" and return it to drafts?`,
		);
		if (!ok) {
			return;
		}
		setPublishing(true);
		setError(null);
		try {
			await saverRef.current?.flush();
			const result = await unschedulePost(
				site,
				post.id,
				saverRef.current?.updatedAt ?? post.updated_at,
			);
			saverRef.current?.adoptUpdatedAt(result.updated_at);
			setPost(prev =>
				prev
					? {
							...prev,
							status: result.status,
							updated_at: result.updated_at,
							published_at: null,
							email_only: false,
						}
					: prev,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPublishing(false);
		}
	}

	function handleRestoreRevision(revision: PostRevision) {
		if (isReadOnlyRef.current || !post) {
			return;
		}
		const patch = buildRestorePatch(revision);
		setTitle(patch.title);
		setLexical(patch.lexical);
		setPost(prev => (prev ? {...prev, lexical: patch.lexical} : prev));
		setMeta(prev => ({
			...prev,
			customExcerpt: patch.custom_excerpt ?? "",
			featureImage: patch.feature_image ?? "",
			featureImageAlt: patch.feature_image_alt ?? "",
			featureImageCaption: patch.feature_image_caption ?? "",
		}));
		setEditorVersion(v => v + 1);
		changeFilterRef.current.reset();
		const postIdValue = post.id;
		saverRef.current
			?.queue(patch, true)
			.then(() => refreshRevisions(postIdValue))
			.catch(() => {
				/* The saver reports failures through save status. */
			});
	}

	async function handlePromoteScrap() {
		const current = scrapRef.current;
		if (!current) {
			return;
		}
		const ok = window.confirm(
			`Promote "${title.trim() || "Untitled Scrap"}" to a Ghost draft on "${site.title}"?\n\n` +
				"The scrap will be removed from this Mac and uploaded to your blog as a draft.",
		);
		if (!ok) {
			return;
		}

		setPublishing(true);
		scrapSaveBlockedRef.current = true;
		cancelPendingScrapSave();
		setError(null);
		try {
			await flushScrapSave();
			if (Object.keys(pendingScrapPatchRef.current).length > 0) {
				throw new Error(
					"The latest scrap changes could not be saved locally. Promote cancelled.",
				);
			}
			const draft = await promoteScrapToDraft(site, current.id);
			onOpenPost?.(draft);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			scrapSaveBlockedRef.current = false;
			setPublishing(false);
		}
	}

	async function handleDemoteToScrap() {
		if (!post || post.status !== "draft" || isReadOnlyRef.current) {
			return;
		}
		const ok = window.confirm(
			"Move this draft to local Scraps? It will be deleted from your Ghost blog and stored privately on your Mac.",
		);
		if (!ok) {
			return;
		}

		const unverifiedMessage =
			"Cannot demote this post: could not verify current draft status on the server. Please check your connection or refresh the post.";

		setDemoting(true);
		scrapSaveBlockedRef.current = true;
		cancelPendingScrapSave();
		setError(null);
		try {
			await saverRef.current?.flush();

			// Demoting deletes the remote post, so it must run against a fresh
			// server snapshot. A stale local copy could say "draft" while the
			// post is actually published or scheduled, and there is no safe way
			// to fall back when the check itself fails.
			let fresh: PostDetail;
			try {
				fresh = await fetchPost(site, post.id);
			} catch {
				throw new Error(unverifiedMessage);
			}
			if (fresh.status !== "draft") {
				throw new Error(unverifiedMessage);
			}

			const localScrap = await demoteDraftToScrap(site, fresh);
			saverRef.current?.halt();
			onOpenScrap?.(localScrap);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			scrapSaveBlockedRef.current = false;
			setDemoting(false);
		}
	}

	async function handleDeletePost() {
		if (!post) {
			return;
		}
		const ok = window.confirm(
			`Permanently delete "${title || "Untitled"}" from "${site.title}"?\n\nThis cannot be undone.`,
		);
		if (!ok) {
			return;
		}
		try {
			saverRef.current?.halt();
			await deletePost(site, post.id);
			await removeCachedDraft(site.base, post.id).catch(() => {
				/* Cache bookkeeping is best-effort. */
			});
			onBack();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	function confirmPublish(nextStatus: "draft") {
		const action = nextStatus === "draft" ? "Unpublish" : "Publish";
		return window.confirm(
			`${action} this post on "${site.title}" (${site.base})?\n\n` +
				"No newsletter or email will be sent.",
		);
	}

	if (error && !post && !scrap) {
		const needsReconnect =
			errorStatus === 401 ||
			errorStatus === 403 ||
			(errorStatus !== undefined && errorStatus >= 300 && errorStatus < 400);
		return (
			<div className="editor">
				<div className="error-banner" role="alert">
					<span>{error}</span>
					<div className="banner-actions">
						<button onClick={onBack}>← Back to posts</button>
						{needsReconnect && onReconnect && (
							<button onClick={onReconnect}>Reconnect site</button>
						)}
					</div>
				</div>
			</div>
		);
	}

	if (!post && !scrap) {
		return (
			<div className="editor">
				<p className="muted">Loading…</p>
			</div>
		);
	}

	const canPublish = Boolean(post) && canPublishRole(site.role);
	const hasDrawer = !isScrapMode && drawer !== "none";
	const banner = isScrapMode ? null : versionBanner(site.version);
	const documentId = post?.id ?? scrap?.id ?? "";
	const initialLexical = scrap?.lexical ?? post?.lexical ?? "";
	const documentStatus = post?.status;

	return (
		<div className={hasDrawer ? "editor-shell with-sidebar" : "editor-shell"}>
			<div className="editor">
				<header className="editor-header">
					<div className="editor-topbar-left">
						<button
							type="button"
							className="editor-icon-button"
							onClick={handleBack}
							title={isScrapMode ? "Back to scraps" : "Back to posts"}
							aria-label={isScrapMode ? "Back to scraps" : "Back to posts"}
							data-testid="back-button"
						>
							<ArrowLeftIcon />
						</button>
						<span className="editor-breadcrumb" aria-live="polite">
							{isScrapMode ? (
								<span
									className="badge badge-scrap"
									data-testid="scrap-local-badge"
								>
									Scrap · Local
								</span>
							) : (
								<span className={`badge badge-${documentStatus}`}>
									{documentStatus}
								</span>
							)}
							<span className="editor-breadcrumb-sep" aria-hidden="true">
								-
							</span>
							<span
								className={`status status-${status}`}
								data-testid="save-status"
							>
								{status === "clean" ? "Saved" : STATUS_COPY[status]}
							</span>
						</span>
						{documentStatus === "scheduled" && post?.published_at && (
							<span
								className="editor-scheduled-hint"
								data-testid="scheduled-hint"
							>
								{new Date(post.published_at).toLocaleString()}
							</span>
						)}
					</div>

					<div className="editor-actions" role="toolbar" aria-label="Post actions">
						{post && (
							<div className="preview-group">
								<select
									value={previewMode}
									onChange={e =>
										setPreviewMode(
											e.target.value as PreviewMemberStatus,
										)
									}
									aria-label="Preview member status"
									title="Preview as member tier"
									data-testid="preview-mode-select"
								>
									<option value="default">Preview: Default</option>
									<option value="anonymous">As Visitor</option>
									<option value="free">As Free Member</option>
									<option value="paid">As Paid Member</option>
								</select>
								<button
									type="button"
									className="editor-action"
									onClick={handleInAppPreview}
									title="Open in-app preview window"
									data-testid="preview-window-button"
								>
									Preview
								</button>
								<button
									type="button"
									className="editor-icon-button"
									onClick={handleBrowserPreview}
									title="Open preview in default browser"
									aria-label="Open preview in default browser"
									data-testid="preview-browser-button"
								>
									↗
								</button>
							</div>
						)}

						{post &&
							canPublish &&
							(post.status === "published" || post.status === "sent" ? (
								<button
									type="button"
									className="editor-action"
									onClick={() => handlePublish("draft")}
									disabled={publishing || isReadOnly}
								>
									Unpublish
								</button>
							) : post.status === "scheduled" ? (
								<>
									<button
										type="button"
										className="editor-action"
										onClick={handleUnschedule}
										disabled={publishing || isReadOnly}
									>
										Unschedule
									</button>
									<button
										type="button"
										className="editor-action editor-action-publish"
										onClick={() => setPublishModalOpen(true)}
										disabled={publishing || isReadOnly}
									>
										Reschedule / Publish…
									</button>
								</>
							) : (
								<button
									type="button"
									className="editor-action editor-action-publish"
									onClick={() => setPublishModalOpen(true)}
									disabled={publishing || isReadOnly}
									data-testid="open-publish-modal-button"
								>
									Publish
								</button>
							))}

						{isScrapMode && (
							<button
								type="button"
								className="editor-action editor-action-publish editor-action-promote"
								onClick={() => void handlePromoteScrap()}
								disabled={publishing || isReadOnly}
								data-testid="promote-scrap-button"
							>
								{publishing ? "Promoting…" : "🚀 Promote to Draft"}
							</button>
						)}

						{post && (
							<>
								<button
									type="button"
									className={
										drawer === "revisions"
											? "editor-icon-button is-active"
											: "editor-icon-button"
									}
									onClick={() =>
										setDrawer(current =>
											current === "revisions"
												? "none"
												: "revisions",
										)
									}
									title="Toggle post history"
									aria-label="Toggle post history"
									aria-pressed={drawer === "revisions"}
									data-testid="toggle-revisions-button"
								>
									<HistoryIcon />
								</button>

								<button
									type="button"
									className={
										drawer === "settings"
											? "editor-icon-button is-active"
											: "editor-icon-button"
									}
									onClick={() =>
										setDrawer(current =>
											current === "settings"
												? "none"
												: "settings",
										)
									}
									title="Toggle post settings sidebar"
									aria-label="Toggle post settings sidebar"
									aria-pressed={drawer === "settings"}
									data-testid="toggle-sidebar-button"
								>
									<SidebarIcon />
								</button>
							</>
						)}
					</div>
				</header>

				<div className="editor-canvas">
					{banner && (
						<div className="warn-banner">
							<span>{banner}</span>
							{shouldEnforceReadOnly(site.version) && !readOnlyOverride && (
								<button
									type="button"
									onClick={() => setReadOnlyOverride(true)}
									data-testid="override-version-guard-button"
								>
									Enable editing anyway
								</button>
							)}
						</div>
					)}

					{offlineCachedAt && (
						<div
							className="warn-banner"
							data-testid="offline-cached-banner"
						>
							<span>
								Working offline — displaying cached copy from{" "}
								{new Date(offlineCachedAt).toLocaleString()}. Local
								edits will sync when reconnected.
							</span>
						</div>
					)}

					{conflict && (
						<div className="warn-banner" data-testid="conflict">
							<div>
								<strong>Conflict (409)</strong> — someone else saved a newer
								version of this post. Autosave is paused so nobody's work is
								clobbered.
							</div>
							<div className="banner-actions">
								<button
									type="button"
									onClick={handleReloadServerVersion}
									data-testid="conflict-reload-button"
								>
									Reload server version
								</button>
								<button
									type="button"
									onClick={handleOverwriteConflict}
									data-testid="conflict-overwrite-button"
								>
									Keep my edits & overwrite
								</button>
							</div>
						</div>
					)}

					{status === "error" && statusMessage && (
						<div className="error-banner" role="alert" data-testid="save-error-banner">
							<span>Save failed: {statusMessage}</span>
							<div className="banner-actions">
								<button
									type="button"
									onClick={() =>
										isScrapMode
											? void flushScrapSave()
											: saverRef.current?.flush()
									}
									data-testid="retry-save-button"
								>
									Retry save
								</button>
								{onReconnect && (
									<button type="button" onClick={onReconnect}>
										Reconnect
									</button>
								)}
							</div>
						</div>
					)}

					{error && (
						<div className="error-banner" role="alert">
							<span>{error}</span>
							<div className="banner-actions">
								<button type="button" onClick={() => setError(null)}>
									Dismiss
								</button>
							</div>
						</div>
					)}

					<input
						className="title-input"
						value={title}
						onChange={e => handleTitle(e.target.value)}
						readOnly={isReadOnly}
						placeholder={isScrapMode ? "Scrap title" : "Post title"}
						data-testid="title-input"
					/>

					<textarea
						ref={excerptRef}
						className="editor-excerpt"
						value={meta.customExcerpt}
						onChange={e =>
							handleMetaChange(
								{...meta, customExcerpt: e.target.value},
								{custom_excerpt: e.target.value || null},
							)
						}
						readOnly={isReadOnly}
						rows={1}
						maxLength={MAX_EXCERPT_LENGTH}
						placeholder="Add an excerpt"
						spellCheck
						data-testid="excerpt-input-inline"
					/>

					<div className="editor-divider" role="separator" />

					{/* key forces a clean editor when switching posts or reloading from server */}
					{editorError ? (
						renderEditorFallback(editorError)
					) : (
						<EditorErrorBoundary
							key={`${documentId}-${editorVersion}`}
							fallback={renderEditorFallback}
							onCatch={message => {
								editorErrorRef.current = true;
								setEditorError(message);
							}}
						>
							<div
								style={{display: "contents"}}
								onKeyDownCapture={markInteraction}
								onPointerDownCapture={markInteraction}
								onPasteCapture={markInteraction}
								onDropCapture={markInteraction}
								onBeforeInputCapture={markInteraction}
								onCompositionStartCapture={markInteraction}
							>
								<KoenigComposer
									initialEditorState={initialLexical}
									darkMode={isDark}
									fileUploader={fileUploader}
									cardConfig={cardConfig}
									onError={handleEditorError}
								>
									<KoenigEditor
										onChange={handleBody}
										placeholderText="Begin writing…"
										readOnly={isReadOnly}
									/>
								</KoenigComposer>
							</div>
						</EditorErrorBoundary>
					)}
				</div>

				<div
					className={
						hasDrawer
							? "editor-word-count with-sidebar"
							: "editor-word-count"
					}
					title={
						isScrapMode
							? "Saved automatically on this Mac"
							: "Cmd+S saves a revision"
					}
					data-testid="word-count"
				>
					{wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"}
				</div>
			</div>

			{post && drawer === "settings" && (
				<MetadataSidebar
					site={site}
					postId={post.id}
					meta={meta}
					siteTags={siteTags}
					siteAuthors={siteAuthors}
					siteTiers={siteTiers}
					revisionsCount={post.post_revisions?.length ?? 0}
					onOpenRevisions={() => setDrawer("revisions")}
					onChange={handleMetaChange}
					onDeletePost={handleDeletePost}
					onDemoteToScrap={handleDemoteToScrap}
					canDemoteToScrap={post.status === "draft"}
					demotingToScrap={demoting}
					onClose={() => setDrawer("none")}
					readOnly={isReadOnly}
				/>
			)}

			{post && drawer === "revisions" && (
				<RevisionsDrawer
					revisions={post.post_revisions ?? []}
					readOnly={isReadOnly}
					onRestore={handleRestoreRevision}
					onClose={() => setDrawer("none")}
				/>
			)}

			{post && publishModalOpen && (
				<PublishModal
					site={site}
					postTitle={title}
					postStatus={post.status}
					scheduledAt={post.published_at}
					newsletters={newsletters}
					membersEnabled={settings.membersEnabled}
					busy={publishing}
					onExecute={handlePublishAction}
					onClose={() => setPublishModalOpen(false)}
				/>
			)}
		</div>
	);
}

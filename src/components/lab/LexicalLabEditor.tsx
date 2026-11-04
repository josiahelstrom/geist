import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {EditorState} from "lexical";
import {
	$getSelection,
	$isNodeSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	SELECTION_CHANGE_COMMAND,
	createEditor,
} from "lexical";
import {LexicalComposer} from "@lexical/react/LexicalComposer";
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin";
import {ContentEditable} from "@lexical/react/LexicalContentEditable";
import {HistoryPlugin} from "@lexical/react/LexicalHistoryPlugin";
import {ListPlugin} from "@lexical/react/LexicalListPlugin";
import {LinkPlugin} from "@lexical/react/LexicalLinkPlugin";
import {MarkdownShortcutPlugin} from "@lexical/react/LexicalMarkdownShortcutPlugin";
import {OnChangePlugin} from "@lexical/react/LexicalOnChangePlugin";
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary";
import {
	createLabMarkdownTransformers,
} from "../../lib/lab/markdownTransformers";
import {unwrapGhostCards, wrapUnknownGhostCards, sanitizeGhostCardHtml} from "../../lib/lab/GhostCardNode";
import {
	registerHtmlCardShortcut,
} from "../../lib/lab/htmlCardShortcut";
import {
	findFootnoteReferenceLabels,
	formatFootnoteDefinitionText,
	hasFootnoteDefinitionFormatting,
} from "../../lib/lab/footnoteSerializer";
import type {
	AuthorSummary,
	NewsletterSummary,
	PostDetail,
	PostRevision,
	Site,
	TagSummary,
	TierSummary,
} from "../../lib/api";
import {
	fetchPost,
	listActiveNewsletters,
	listSiteAuthors,
	listSiteTags,
	listSiteTiers,
} from "../../lib/api";
import {
	createInitialScrapLexical,
	deleteScrap,
	demoteDraftToScrap,
	getScrap,
	promoteScrapToDraft,
	updateScrap,
	type Scrap,
} from "../../lib/scraps";
import {
	canPublishRole,
	deletePost,
	openInAppPreview,
	previewUrl,
	publishWithNewsletter,
	schedulePost,
	setPostStatus,
	unschedulePost,
	type PreviewMemberStatus,
} from "../../lib/posts";
import {openUrl} from "@tauri-apps/plugin-opener";
import {
	DEFAULT_SETTINGS,
	loadSiteSettings,
	type SiteSettings,
} from "../../lib/cardConfig";
import {buildRestorePatch, extractLexicalPlainText} from "../../lib/revisions";
import {createSaver} from "../../lib/saver";
import {shouldShowExcerpt, setUiPrefs, useUiPrefs} from "../../lib/uiPrefs";
import MetadataSidebar, {type PostMetadataState} from "../MetadataSidebar";
import PublishModal, {type PublishAction} from "../PublishModal";
import RevisionsDrawer from "../RevisionsDrawer";
import {SlashMenuPlugin} from "./SlashMenuPlugin";
import {SmartLinkPlugin} from "./SmartLinkPlugin";
import {MediaDropPastePlugin} from "./MediaDropPastePlugin";
import {LabSiteContext} from "../../lib/lab/labContext";
import "./LexicalLabEditor.css";

export type LexicalLabEditorProps = {
	site: Site;
	scrapId?: string;
	postId?: string;
	onBack?: () => void;
	onSave?: (serializedLexical: string) => void;
	onReconnect?: () => void;
	onOpenPost?: (post: PostDetail) => void;
	onOpenScrap?: (scrap: Scrap) => void;
	onTitleChange?: (title: string) => void;
};

import {LAB_NODES} from "../../lib/lab/labNodes";


function getInitialSerialized(
	initialEditorStateString: string,
	footnoteDefinitions?: Record<string, string>,
): string {
	try {
		const tempEditor = createEditor({nodes: LAB_NODES});
		const parsed = tempEditor.parseEditorState(initialEditorStateString);
		const json = parsed.toJSON();
		const unwrapped = unwrapGhostCards(json, footnoteDefinitions);
		return JSON.stringify(unwrapped);
	} catch {
		return initialEditorStateString;
	}
}

function convertInitialEditorState(
	lexicalContent?: string | null,
	options?: {
		onExtractFootnotes?: (defs: Record<string, string>) => void;
	},
): string {
	if (!lexicalContent) {
		return createInitialScrapLexical();
	}
	try {
		const parsed = JSON.parse(lexicalContent);
		const wrapped = wrapUnknownGhostCards(parsed, undefined, {
			onExtractFootnotes: options?.onExtractFootnotes,
		});
		return JSON.stringify(wrapped);
	} catch {
		return createInitialScrapLexical(lexicalContent);
	}
}

function computePlainTextCounts(plainText: string): {
	wordCount: number;
	tkCount: number;
} {
	const trimmed = plainText.trim();
	const wordCount = trimmed === "" ? 0 : trimmed.split(/\s+/).length;
	const tkMatches = plainText.match(/\bTK\b/g);
	return {
		wordCount,
		tkCount: tkMatches ? tkMatches.length : 0,
	};
}

export function countTkPlaceholders(textOrLexical: string): number {
	if (typeof textOrLexical !== "string" || textOrLexical.trim() === "") {
		return 0;
	}

	let text = textOrLexical;
	try {
		const parsed: unknown = JSON.parse(textOrLexical);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"root" in parsed &&
			typeof (parsed as {root?: unknown}).root === "object" &&
			(parsed as {root?: unknown}).root !== null
		) {
			text = extractLexicalPlainText(textOrLexical);
		}
	} catch {
		/* Treat non-JSON input as plain text. */
	}

	const matches = text.match(/\bTK\b/g);
	return matches ? matches.length : 0;
}

export function FocusDimmingPlugin() {
	const [editor] = useLexicalComposerContext();
	const activeBlockRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		const applyActiveBlock = (nextEl: HTMLElement | null) => {
			const prevEl = activeBlockRef.current;
			if (prevEl && prevEl !== nextEl) {
				prevEl.classList.remove("is-active-block");
			}
			if (nextEl) {
				nextEl.classList.add("is-active-block");
			}
			activeBlockRef.current = nextEl;
		};

		const syncFromLexicalSelection = () => {
			let nextEl: HTMLElement | null = null;
			const selection = $getSelection();
			if ($isRangeSelection(selection)) {
				const topBlock = selection.anchor.getNode().getTopLevelElement();
				if (topBlock) {
					nextEl = editor.getElementByKey(topBlock.getKey());
				}
			} else if ($isNodeSelection(selection)) {
				const first = selection.getNodes()[0];
				const topBlock = first?.getTopLevelElement();
				if (topBlock) {
					nextEl = editor.getElementByKey(topBlock.getKey());
				}
			}
			if (nextEl) {
				applyActiveBlock(nextEl);
			}
		};

		const onDomSelectionChange = () => {
			const rootEl = editor.getRootElement();
			const domSel = window.getSelection();
			if (!rootEl || !domSel || !domSel.anchorNode) {
				return;
			}
			if (!rootEl.contains(domSel.anchorNode)) {
				return;
			}
			let cur: Node | null = domSel.anchorNode;
			while (cur && cur.parentNode !== rootEl) {
				cur = cur.parentNode;
			}
			if (cur instanceof HTMLElement && cur.parentNode === rootEl) {
				applyActiveBlock(cur);
			}
		};

		const unregisterUpdate = editor.registerUpdateListener(({editorState}) => {
			editorState.read(() => {
				syncFromLexicalSelection();
			});
		});

		const unregisterSelection = editor.registerCommand(
			SELECTION_CHANGE_COMMAND,
			() => {
				syncFromLexicalSelection();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);

		document.addEventListener("selectionchange", onDomSelectionChange);

		return () => {
			if (activeBlockRef.current) {
				activeBlockRef.current.classList.remove("is-active-block");
				activeBlockRef.current = null;
			}
			unregisterUpdate();
			unregisterSelection();
			document.removeEventListener("selectionchange", onDomSelectionChange);
		};
	}, [editor]);

	return null;
}

/**
 * Converts a paragraph that only contains an HTML-card trigger into a
 * `GhostCardNode`:
 *
 * - typing `````html````` (or `/html`) and then space or Enter
 * - typing/pasting a complete fenced HTML block and pressing Enter
 *
 * The resulting card opens directly in source mode when it has no HTML so the
 * user can paste a snippet straight away.
 */
function HtmlCardShortcutPlugin() {
	const [editor] = useLexicalComposerContext();

	useEffect(() => registerHtmlCardShortcut(editor), [editor]);

	return null;
}

const LAB_THEME = {
	paragraph: "editor-paragraph",
	heading: {
		h1: "editor-heading-h1",
		h2: "editor-heading-h2",
		h3: "editor-heading-h3",
		h4: "editor-heading-h4",
		h5: "editor-heading-h5",
		h6: "editor-heading-h6",
	},
	quote: "editor-quote",
	list: {
		nested: {
			listitem: "editor-nested-listitem",
		},
		ol: "editor-list-ol",
		ul: "editor-list-ul",
		listitem: "editor-listitem",
	},
	link: "editor-link",
	text: {
		bold: "editor-text-bold",
		italic: "editor-text-italic",
		underline: "editor-text-underline",
		strikethrough: "editor-text-strikethrough",
		code: "editor-text-code",
		highlight: "editor-text-highlight",
	},
	code: "editor-code",
};

/**
 * Editable, auto-resizing footnote definition with a live rich preview.
 * Definitions may contain HTML (`<i>`, `<em>`, `<b>`, `<a>`) or Markdown
 * (`*italic*`, `**bold**`, `[label](url)`), either of which is rendered as
 * styled text in the preview below the textarea.
 */
function FootnoteDefinitionField({
	label,
	text,
	onChange,
}: {
	label: string;
	text: string;
	onChange: (text: string) => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const previewHtml = useMemo(() => {
		if (!text.trim() || !hasFootnoteDefinitionFormatting(text)) {
			return "";
		}
		return sanitizeGhostCardHtml(formatFootnoteDefinitionText(text));
	}, [text]);

	useEffect(() => {
		const el = textareaRef.current;
		if (!el) {
			return;
		}
		el.style.height = "auto";
		if (el.scrollHeight > 0) {
			el.style.height = `${el.scrollHeight}px`;
		}
	}, [text]);

	return (
		<div className="lexical-lab-footnote-definition">
			<textarea
				ref={textareaRef}
				className="lexical-lab-footnote-input"
				data-footnote-editor={label}
				rows={1}
				placeholder={`Footnote [^${label}] definition...`}
				value={text}
				onChange={e => onChange(e.target.value)}
			/>
			{previewHtml && (
				<div className="lexical-lab-footnote-preview">
					<span className="lexical-lab-footnote-preview-label">Preview</span>
					<div
						className="lexical-lab-footnote-preview-content"
						data-testid={`footnote-preview-${label}`}
						dangerouslySetInnerHTML={{__html: previewHtml}}
					/>
				</div>
			)}
		</div>
	);
}

function HistoryIcon() {
	return (
		<svg
			width={16}
			height={16}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="8" cy="8" r="5.75" />
			<path d="M8 4.75V8l2.25 1.5" />
		</svg>
	);
}

function SidebarIcon() {
	return (
		<svg
			width={16}
			height={16}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
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

export default function LexicalLabEditor({
	site,
	scrapId,
	postId,
	onBack,
	onSave,
	onReconnect,
	onOpenPost,
	onOpenScrap,
	onTitleChange,
}: LexicalLabEditorProps) {
	const uiPrefs = useUiPrefs();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [scrap, setScrap] = useState<Scrap | null>(null);
	const [post, setPost] = useState<PostDetail | null>(null);
	const [title, setTitle] = useState("");
	const [editorVersion, setEditorVersion] = useState(0);
	const [drawer, setDrawer] = useState<"none" | "settings" | "revisions">("none");
	const [meta, setMeta] = useState<PostMetadataState>(EMPTY_META);
	const [siteTags, setSiteTags] = useState<TagSummary[]>([]);
	const [siteAuthors, setSiteAuthors] = useState<AuthorSummary[]>([]);
	const [siteTiers, setSiteTiers] = useState<TierSummary[]>([]);
	const [newsletters, setNewsletters] = useState<NewsletterSummary[]>([]);
	const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
	const [previewMode, setPreviewMode] = useState<PreviewMemberStatus>("default");
	const [publishing, setPublishing] = useState(false);
	const publishingRef = useRef(false);
	const [publishModalOpen, setPublishModalOpen] = useState(false);
	const [wordCount, setWordCount] = useState(0);
	const [tkCount, setTkCount] = useState(0);
	const [demoting, setDemoting] = useState(false);
	const [featureImageBroken, setFeatureImageBroken] = useState(false);
	const [saveStatus, setSaveStatus] = useState<string>("clean");
	const [footnotes, setFootnotes] = useState<Record<string, string>>({});
	const [footnotesExpanded, setFootnotesExpanded] = useState(true);

	const mountedRef = useRef(true);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingPatchRef = useRef<Partial<Pick<Scrap, "title" | "lexical">>>({});
	const lastSavedContentRef = useRef<string | null>(null);
	const titleTextareaRef = useRef<HTMLTextAreaElement>(null);
	const excerptTextareaRef = useRef<HTMLTextAreaElement>(null);
	const footnotesRef = useRef<Record<string, string>>({});
	footnotesRef.current = footnotes;
	const latestJsonRef = useRef<unknown>(null);
	const saverRef = useRef<ReturnType<typeof createSaver> | null>(null);
	const onTitleChangeRef = useRef(onTitleChange);
	const mouseSelectingRef = useRef(false);
	const isComposingRef = useRef(false);

	useEffect(() => {
		onTitleChangeRef.current = onTitleChange;
	}, [onTitleChange]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		setFeatureImageBroken(false);
	}, [meta.featureImage]);

	useEffect(() => {
		if (!postId || scrapId) {
			return;
		}
		let cancelled = false;
		listSiteTags(site)
			.then(tags => {
				if (!cancelled) {
					setSiteTags(tags);
				}
			})
			.catch(() => {});
		listSiteAuthors(site)
			.then(authors => {
				if (!cancelled) {
					setSiteAuthors(authors);
				}
			})
			.catch(() => {});
		listSiteTiers(site)
			.then(tiers => {
				if (!cancelled) {
					setSiteTiers(tiers);
				}
			})
			.catch(() => {});
		listActiveNewsletters(site)
			.then(list => {
				if (!cancelled) {
					setNewsletters(list);
				}
			})
			.catch(() => {});
		loadSiteSettings(site)
			.then(s => {
				if (!cancelled) {
					setSettings(s);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [site, postId, scrapId]);

	// Flush autosave helper (for scrap)
	const flushSave = useCallback(async () => {
		if (!scrapId) return;
		if (saveTimerRef.current) {
			clearTimeout(saveTimerRef.current);
			saveTimerRef.current = null;
		}

		const patch = pendingPatchRef.current;
		if (Object.keys(patch).length === 0) {
			return;
		}

		pendingPatchRef.current = {};
		if (mountedRef.current) {
			setSaveStatus("saving");
		}

		try {
			await updateScrap(site.base, scrapId, patch);
			if (patch.lexical !== undefined) {
				lastSavedContentRef.current = patch.lexical;
			}
			if (mountedRef.current) {
				setSaveStatus("clean");
			}
		} catch (err) {
			console.error("LexicalLab autosave failed:", err);
			if (mountedRef.current) {
				setSaveStatus("error");
			}
		}
	}, [site.base, scrapId]);

	const scheduleSave = useCallback(
		(patch: Partial<Pick<Scrap, "title" | "lexical">>) => {
			if (!scrapId) return;
			pendingPatchRef.current = {...pendingPatchRef.current, ...patch};
			if (mountedRef.current) {
				setSaveStatus("saving");
			}

			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}

			saveTimerRef.current = setTimeout(() => {
				void flushSave();
			}, 600);
		},
		[flushSave, scrapId],
	);

	// Load scrap or post on mount / id change
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setActionError(null);

		if (scrapId) {
			getScrap(site.base, scrapId)
				.then(found => {
					if (cancelled) return;
					if (!found) {
						setError("Scrap not found.");
						setLoading(false);
						return;
					}
					setScrap(found);
					setTitle(found.title);
					let extractedDefs: Record<string, string> = {};
					const initialEditorState = convertInitialEditorState(found.lexical, {
						onExtractFootnotes: defs => {
							extractedDefs = {...extractedDefs, ...defs};
						},
					});
					try {
						latestJsonRef.current = JSON.parse(initialEditorState);
					} catch {
						latestJsonRef.current = null;
					}
					setFootnotes(extractedDefs);
					footnotesRef.current = extractedDefs;
					const initialSerialized = getInitialSerialized(
						initialEditorState,
						extractedDefs,
					);
					lastSavedContentRef.current = initialSerialized;
					const initialCounts = computePlainTextCounts(
						extractLexicalPlainText(initialSerialized),
					);
					setWordCount(initialCounts.wordCount);
					setTkCount(initialCounts.tkCount);
					setLoading(false);
				})
				.catch(err => {
					if (cancelled) return;
					setError(err instanceof Error ? err.message : String(err));
					setLoading(false);
				});
		} else if (postId) {
			fetchPost(site, postId)
				.then(p => {
					if (cancelled) return;
					setPost(p);
					setTitle(p.title ?? "");
					onTitleChangeRef.current?.(p.title ?? "");
					setMeta(metaFromPost(p));
					let extractedDefs: Record<string, string> = {};
					const initialEditorState = convertInitialEditorState(p.lexical, {
						onExtractFootnotes: defs => {
							extractedDefs = {...extractedDefs, ...defs};
						},
					});
					try {
						latestJsonRef.current = JSON.parse(initialEditorState);
					} catch {
						latestJsonRef.current = null;
					}
					setFootnotes(extractedDefs);
					footnotesRef.current = extractedDefs;
					const initialSerialized = getInitialSerialized(
						initialEditorState,
						extractedDefs,
					);
					lastSavedContentRef.current = initialSerialized;
					const initialCounts = computePlainTextCounts(
						extractLexicalPlainText(initialSerialized),
					);
					setWordCount(initialCounts.wordCount);
					setTkCount(initialCounts.tkCount);

					saverRef.current = createSaver(site, p.id, p.updated_at, {
						onStatus: s => {
							if (mountedRef.current) {
								setSaveStatus(s);
							}
						},
						onConflict: () => {
							if (mountedRef.current) {
								setSaveStatus("conflict");
							}
						},
					});
					setLoading(false);
				})
				.catch(err => {
					if (cancelled) return;
					setError(err instanceof Error ? err.message : String(err));
					setLoading(false);
				});
		} else {
			setError("No scrap or post specified.");
			setLoading(false);
		}

		return () => {
			cancelled = true;
			if (scrapId) {
				void flushSave();
			} else {
				const saver = saverRef.current;
				if (saver?.hasPending) {
					void saver.flush().catch(() => {});
				}
			}
		};
	}, [site, scrapId, postId, flushSave]);

	// Auto-resize title input
	useEffect(() => {
		if (titleTextareaRef.current) {
			titleTextareaRef.current.style.height = "auto";
			titleTextareaRef.current.style.height = `${titleTextareaRef.current.scrollHeight}px`;
		}
	}, [title, drawer]);

	const showExcerpt =
		!scrapId && shouldShowExcerpt(meta.customExcerpt, uiPrefs.alwaysShowExcerpt);

	const handleMetaChange = useCallback(
		(nextMeta: PostMetadataState, patch: Record<string, unknown>) => {
			setMeta(nextMeta);
			saverRef.current?.queueDebounced(patch, 900);
		},
		[],
	);

	useEffect(() => {
		const el = excerptTextareaRef.current;
		if (!el) return;
		const resize = () => {
			if (!el) return;
			el.style.height = "auto";
			el.style.height = `${el.scrollHeight}px`;
		};
		resize();

		const parent = el.parentElement;
		let observer: ResizeObserver | null = null;
		if (parent && typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(() => resize());
			observer.observe(parent);
		}
		return () => {
			observer?.disconnect();
		};
	}, [meta.customExcerpt, showExcerpt, drawer]);

	const handleTitleChange = (newTitle: string) => {
		setTitle(newTitle);
		onTitleChange?.(newTitle);
		if (scrapId) {
			scheduleSave({title: newTitle});
		} else if (saverRef.current) {
			saverRef.current.queueDebounced({title: newTitle});
		}
	};

	const handleContentChange = useCallback(
		(serializedJson: string) => {
			if (lastSavedContentRef.current === null) {
				lastSavedContentRef.current = serializedJson;
				const counts = computePlainTextCounts(
					extractLexicalPlainText(serializedJson),
				);
				setWordCount(counts.wordCount);
				setTkCount(counts.tkCount);
				return;
			}
			if (serializedJson === lastSavedContentRef.current) {
				return;
			}
			const counts = computePlainTextCounts(
				extractLexicalPlainText(serializedJson),
			);
			setWordCount(counts.wordCount);
			setTkCount(counts.tkCount);
			onSave?.(serializedJson);
			if (scrapId) {
				scheduleSave({lexical: serializedJson});
			} else if (saverRef.current) {
				saverRef.current.queueDebounced({lexical: serializedJson});
			}
		},
		[onSave, scrapId, scheduleSave],
	);

	const handleDeleteScrap = async () => {
		if (!scrapId) return;
		await deleteScrap(site.base, scrapId);
		onBack?.();
	};

	const handlePromoteScrap = async () => {
		if (!scrapId) return;
		await flushSave();
		const draft = await promoteScrapToDraft(site, scrapId);
		if (onOpenPost) {
			onOpenPost(draft);
		} else if (onBack) {
			onBack();
		}
	};

	const handleDemotePost = async () => {
		if (!post) return;
		const saver = saverRef.current;
		setDemoting(true);
		try {
			// Persist any pending edits before the remote draft is removed.
			await saver?.flush();
			// Re-read the post after the flush so the demoted scrap carries the
			// latest saved title/lexical rather than the snapshot loaded when the
			// editor first opened.
			const fresh = await fetchPost(site, postId ?? post.id);
			const scrap = await demoteDraftToScrap(site, fresh);
			saver?.halt();
			if (onOpenScrap) {
				onOpenScrap(scrap);
			} else if (onBack) {
				onBack();
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		} finally {
			setDemoting(false);
		}
	};

	const handleDeletePost = async () => {
		if (!post) return;
		const saver = saverRef.current;
		try {
			// Flush pending edits first so the delete cannot race an autosave.
			await saver?.flush();
			saver?.halt();
			await deletePost(site, post.id);
			onBack?.();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : String(err));
		}
	};

	const refreshRevisions = useCallback(
		(targetId: string) => {
			fetchPost(site, targetId)
				.then(fresh => {
					if (mountedRef.current) {
						setPost(prev =>
							prev && prev.id === targetId
								? {...prev, post_revisions: fresh.post_revisions}
								: prev,
						);
					}
				})
				.catch(() => {});
		},
		[site],
	);

	const handleRestoreRevision = useCallback(
		(revision: PostRevision) => {
			if (!post) {
				return;
			}
			setActionError(null);
			const patch = buildRestorePatch(revision);
			setTitle(patch.title);
			if (patch.title !== undefined) {
				onTitleChangeRef.current?.(patch.title);
			}
			setMeta(prev => ({
				...prev,
				customExcerpt: patch.custom_excerpt ?? "",
				featureImage: patch.feature_image ?? "",
				featureImageAlt: patch.feature_image_alt ?? "",
				featureImageCaption: patch.feature_image_caption ?? "",
			}));

			let extractedDefs: Record<string, string> = {};
			const convertedLexical = convertInitialEditorState(patch.lexical, {
				onExtractFootnotes: defs => {
					extractedDefs = {...extractedDefs, ...defs};
				},
			});
			try {
				latestJsonRef.current = JSON.parse(convertedLexical);
			} catch {
				latestJsonRef.current = null;
			}
			setFootnotes(extractedDefs);
			footnotesRef.current = extractedDefs;
			const unwrappedSerialized = getInitialSerialized(
				convertedLexical,
				extractedDefs,
			);
			const restoredCounts = computePlainTextCounts(
				extractLexicalPlainText(unwrappedSerialized),
			);
			setWordCount(restoredCounts.wordCount);
			setTkCount(restoredCounts.tkCount);

			setPost(prev =>
				prev ? {...prev, ...patch, lexical: unwrappedSerialized} : prev,
			);
			setEditorVersion(v => v + 1);

			const postIdValue = post.id;
			const saver = saverRef.current;
			saver
				?.queue(patch, true)
				.then(() => {
					if (
						saver.hasPending ||
						saver.conflict ||
						Boolean(saver.lastError)
					) {
						const err = saver.lastError;
						setActionError(
							err instanceof Error
								? err.message
								: "Could not save restored revision.",
						);
						return;
					}
					lastSavedContentRef.current = unwrappedSerialized;
					refreshRevisions(postIdValue);
				})
				.catch(err => {
					setActionError(err instanceof Error ? err.message : String(err));
				});
		},
		[post, refreshRevisions],
	);

	const flushExplicitRevision = useCallback(() => {
		if (scrapId) {
			void flushSave();
			return;
		}
		saverRef.current
			?.flush(true)
			.then(() => {
				if (postId) {
					refreshRevisions(postId);
				}
			})
			.catch(() => {});
	}, [scrapId, postId, flushSave, refreshRevisions]);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				if (e.repeat) return;
				flushExplicitRevision();
			}
		}
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("geist:save-revision", flushExplicitRevision);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("geist:save-revision", flushExplicitRevision);
		};
	}, [flushExplicitRevision]);

	const handleInAppPreview = useCallback(async () => {
		if (!post) {
			return;
		}
		setActionError(null);
		try {
			await saverRef.current?.flush();
			await openInAppPreview(site.siteUrl, post.uuid, title, previewMode);
		} catch (err) {
			void openUrl(
				previewUrl(site.siteUrl, post.uuid, previewMode),
			).catch(() => {});
			if (err instanceof Error) {
				setActionError(err.message);
			}
		}
	}, [post, site.siteUrl, title, previewMode]);

	const handleBrowserPreview = useCallback(async () => {
		if (!post) {
			return;
		}
		await saverRef.current?.flush();
		void openUrl(
			previewUrl(site.siteUrl, post.uuid, previewMode),
		).catch(() => {});
	}, [post, site.siteUrl, previewMode]);

	const canPublish = Boolean(post) && canPublishRole(site.role);

	const confirmPublish = useCallback(
		(nextStatus: "draft") => {
			const action = nextStatus === "draft" ? "Unpublish" : "Publish";
			return window.confirm(
				`${action} this post on "${site.title}" (${site.base})?\n\n` +
					"No newsletter or email will be sent.",
			);
		},
		[site.title, site.base],
	);

	const handlePublish = useCallback(
		async (nextStatus: "draft") => {
			if (!post || !confirmPublish(nextStatus) || publishingRef.current) {
				return;
			}
			publishingRef.current = true;
			setPublishing(true);
			setActionError(null);
			try {
				await saverRef.current?.flush();
				const saver = saverRef.current;
				if (
					saver &&
					(saver.hasPending || saver.conflict || Boolean(saver.lastError))
				) {
					setActionError(
						"Could not save your latest edits, so publishing was cancelled. Your changes are still here.",
					);
					return;
				}
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
				setActionError(err instanceof Error ? err.message : String(err));
			} finally {
				publishingRef.current = false;
				setPublishing(false);
			}
		},
		[confirmPublish, post, site],
	);

	const handlePublishAction = useCallback(
		async (action: PublishAction) => {
			if (!post || publishingRef.current) {
				return;
			}
			publishingRef.current = true;
			setPublishing(true);
			setActionError(null);
			try {
				await saverRef.current?.flush();
				const saver = saverRef.current;
				if (
					saver &&
					(saver.hasPending || saver.conflict || Boolean(saver.lastError))
				) {
					setActionError(
						"Could not save your latest edits, so publishing was cancelled. Your changes are still here.",
					);
					setPublishModalOpen(false);
					return;
				}
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

				const fresh = await fetchPost(site, post.id).catch(() => null);
				if (fresh) {
					setPost(fresh);
					saverRef.current?.adoptUpdatedAt(fresh.updated_at);
				} else {
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
				setActionError(err instanceof Error ? err.message : String(err));
			} finally {
				publishingRef.current = false;
				setPublishing(false);
			}
		},
		[post, site],
	);

	const handleUnschedule = useCallback(async () => {
		if (!post || publishingRef.current) {
			return;
		}
		const ok = window.confirm(
			`Unschedule this post on "${site.title}" and return it to drafts?`,
		);
		if (!ok) {
			return;
		}
		publishingRef.current = true;
		setPublishing(true);
		setActionError(null);
		try {
			await saverRef.current?.flush();
			const saver = saverRef.current;
			if (
				saver &&
				(saver.hasPending || saver.conflict || Boolean(saver.lastError))
			) {
				setActionError(
					"Could not save your latest edits, so publishing was cancelled. Your changes are still here.",
				);
				return;
			}
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
			setActionError(err instanceof Error ? err.message : String(err));
		} finally {
			publishingRef.current = false;
			setPublishing(false);
		}
	}, [post, site]);

	// Footnote handlers
	const handleUpdateFootnote = useCallback(
		(label: string, text: string) => {
			const next = {...footnotesRef.current, [label]: text};
			footnotesRef.current = next;
			setFootnotes(next);

			if (latestJsonRef.current) {
				const unwrapped = unwrapGhostCards(latestJsonRef.current, next);
				const serialized = JSON.stringify(unwrapped);
				handleContentChange(serialized);
			}
		},
		[handleContentChange],
	);

	const handleDeleteFootnote = useCallback(
		(label: string) => {
			const next = {...footnotesRef.current};
			delete next[label];
			footnotesRef.current = next;
			setFootnotes(next);

			if (latestJsonRef.current) {
				const unwrapped = unwrapGhostCards(latestJsonRef.current, next);
				const serialized = JSON.stringify(unwrapped);
				handleContentChange(serialized);
			}
		},
		[handleContentChange],
	);

	const handleAddFootnote = useCallback(() => {
		const keys = Object.keys(footnotesRef.current);
		let nextIndex = 1;
		while (keys.includes(String(nextIndex))) {
			nextIndex++;
		}
		const newLabel = String(nextIndex);
		const next = {...footnotesRef.current, [newLabel]: ""};
		footnotesRef.current = next;
		setFootnotes(next);

		if (latestJsonRef.current) {
			const unwrapped = unwrapGhostCards(latestJsonRef.current, next);
			const serialized = JSON.stringify(unwrapped);
			handleContentChange(serialized);
		}

		setFootnotesExpanded(true);
	}, [handleContentChange]);

	const handleJumpToReference = useCallback((label: string) => {
		const el =
			document.getElementById(`fnref${label}`) ||
			document.querySelector(`[data-label="${label}"]`);
		if (el) {
			el.scrollIntoView({behavior: "smooth", block: "center"});
			el.classList.add("lexical-lab-fn-highlight");
			setTimeout(() => {
				el.classList.remove("lexical-lab-fn-highlight");
			}, 1500);
		}
	}, []);

	// Listen for clicks on inline footnote badges to jump to definition
	useEffect(() => {
		const handler = (e: Event) => {
			const customEvent = e as CustomEvent<{label: string}>;
			const label = customEvent.detail?.label;
			if (label) {
				setFootnotesExpanded(true);
				setTimeout(() => {
					const item = document.getElementById(`fn-${label}`);
					if (item) {
						item.scrollIntoView({behavior: "smooth", block: "center"});
						const editor = item.querySelector<HTMLElement>(
							"textarea, [data-footnote-editor]",
						);
						editor?.focus();
						item.classList.add("lexical-lab-fn-highlight");
						setTimeout(() => {
							item.classList.remove("lexical-lab-fn-highlight");
						}, 1500);
					}
				}, 50);
			}
		};
		window.addEventListener("lexical-lab:jump-footnote", handler);
		return () => {
			window.removeEventListener("lexical-lab:jump-footnote", handler);
		};
	}, []);

	// Typewriter mode: keeps the active line vertically centered in the viewport.
	useEffect(() => {
		if (!uiPrefs.typewriterMode) {
			return;
		}

		let rafId: number | null = null;
		let mouseUpTimeoutId: ReturnType<typeof setTimeout> | null = null;

		function centerCaret() {
			if (isComposingRef.current) {
				return;
			}
			const activeEl = document.activeElement;
			if (
				!activeEl ||
				!activeEl.closest(".lexical-lab-canvas [contenteditable='true']")
			) {
				return;
			}
			if (mouseSelectingRef.current) {
				return;
			}
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
				return;
			}

			const range = selection.getRangeAt(0);
			const canvas = document.querySelector(".lexical-lab-canvas");
			if (
				!canvas ||
				(selection.anchorNode && !canvas.contains(selection.anchorNode)) ||
				!canvas.contains(range.commonAncestorContainer)
			) {
				return;
			}

			const container =
				document.querySelector<HTMLElement>(".app-shell-body") ??
				document.querySelector<HTMLElement>(".lexical-lab-main-area");
			if (!container) {
				return;
			}

			let caretRect = range.getBoundingClientRect();
			if (
				caretRect.height === 0 ||
				(caretRect.top === 0 && caretRect.bottom === 0)
			) {
				const rects = range.getClientRects();
				if (rects.length > 0) {
					caretRect = rects[0];
				} else {
					const el =
						range.startContainer instanceof Element
							? range.startContainer
							: range.startContainer.parentElement;
					if (el) {
						caretRect = el.getBoundingClientRect();
					}
				}
			}

			if (!caretRect || caretRect.height === 0) {
				return;
			}

			const containerRect = container.getBoundingClientRect();
			const caretCenterY = caretRect.top + caretRect.height / 2;
			const caretRelativeY = caretCenterY - containerRect.top;
			const targetY = container.clientHeight * 0.48;
			const deltaY = caretRelativeY - targetY;

			if (Math.abs(deltaY) >= 2) {
				container.scrollTop += deltaY;
			}
		}

		function scheduleCenter() {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
			}
			rafId = requestAnimationFrame(centerCaret);
		}

		function onMouseDown() {
			if (mouseUpTimeoutId !== null) {
				clearTimeout(mouseUpTimeoutId);
				mouseUpTimeoutId = null;
			}
			mouseSelectingRef.current = true;
		}

		function onMouseUp() {
			if (mouseUpTimeoutId !== null) {
				clearTimeout(mouseUpTimeoutId);
			}
			mouseUpTimeoutId = setTimeout(() => {
				mouseSelectingRef.current = false;
				mouseUpTimeoutId = null;
			}, 150);
		}

		function onInput() {
			mouseSelectingRef.current = false;
			scheduleCenter();
		}

		function onSelectionChange() {
			if (mouseSelectingRef.current) {
				return;
			}
			scheduleCenter();
		}

		function onCompositionStart() {
			isComposingRef.current = true;
		}

		function onCompositionEnd() {
			isComposingRef.current = false;
			scheduleCenter();
		}

		document.addEventListener("selectionchange", onSelectionChange);
		document.addEventListener("input", onInput);
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("mouseup", onMouseUp);
		document.addEventListener("compositionstart", onCompositionStart);
		document.addEventListener("compositionend", onCompositionEnd);

		return () => {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
			}
			if (mouseUpTimeoutId !== null) {
				clearTimeout(mouseUpTimeoutId);
			}
			mouseSelectingRef.current = false;
			isComposingRef.current = false;
			document.removeEventListener("selectionchange", onSelectionChange);
			document.removeEventListener("input", onInput);
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("mouseup", onMouseUp);
			document.removeEventListener("compositionstart", onCompositionStart);
			document.removeEventListener("compositionend", onCompositionEnd);
		};
	}, [uiPrefs.typewriterMode]);

	const transformers = useMemo(() => {
		return createLabMarkdownTransformers(handleUpdateFootnote);
	}, [handleUpdateFootnote]);

	const documentContent = scrap?.lexical ?? post?.lexical;

	// Parse initial editor state and wrap unknown cards
	const initialEditorStateString = useMemo(() => {
		return convertInitialEditorState(documentContent);
	}, [documentContent]);

	const initialConfig = useMemo(
		() => ({
			namespace: "GeistLexicalLab",
			nodes: LAB_NODES,
			theme: LAB_THEME,
			onError: (err: Error) => {
				console.error("LexicalLab error:", err);
			},
			editorState: initialEditorStateString,
		}),
		[initialEditorStateString],
	);

	const handleToggleEngine = useCallback(() => {
		const doToggle = () => {
			setUiPrefs({
				editorEngine:
					uiPrefs.editorEngine === "lexical-lab" ? "koenig" : "lexical-lab",
			});
		};
		if (scrapId) {
			void flushSave().then(doToggle);
		} else {
			const saver = saverRef.current;
			if (saver) {
				void saver.flush().then(doToggle);
			} else {
				doToggle();
			}
		}
	}, [flushSave, scrapId, uiPrefs.editorEngine]);

	const handleToggleEngineSimple = useCallback(() => {
		setUiPrefs({
			editorEngine:
				uiPrefs.editorEngine === "lexical-lab" ? "koenig" : "lexical-lab",
		});
	}, [uiPrefs.editorEngine]);

	const displaySaveStatus = useMemo(() => {
		if (scrapId) {
			return saveStatus === "saving"
				? "Saving..."
				: saveStatus === "error"
					? "Save failed"
					: "Saved";
		}
		if (saveStatus === "clean" || saveStatus === "saved") return "Saved";
		if (saveStatus === "saving") return "Saving...";
		if (saveStatus === "dirty") return "Unsaved";
		if (saveStatus === "conflict") return "Conflict";
		if (saveStatus === "error") return "Save failed";
		if (saveStatus === "offline") return "Offline (Saved locally)";
		return "Saved";
	}, [scrapId, saveStatus]);

	const readingTime = Math.max(1, Math.round(wordCount / 238));

	if (loading) {
		return (
			<div className="lexical-lab-shell">
				<div className="lexical-lab-main-area">
					<header className="lexical-lab-header">
						<div className="lexical-lab-topbar-left">
							{onBack && (
								<button
									type="button"
									className="lexical-lab-back-button"
									onClick={onBack}
								>
									← Back
								</button>
							)}
							<button
								type="button"
								className="lexical-lab-badge"
								title="⌥⌘E to switch to Koenig"
								onClick={handleToggleEngineSimple}
							>
								Lexical Lab
							</button>
						</div>
					</header>
					<main className="lexical-lab-canvas">
						<div style={{color: "var(--fg-muted, #9ca3af)", padding: "2rem 0"}}>
							Loading document...
						</div>
					</main>
				</div>
			</div>
		);
	}

	if (error || (!scrap && !post)) {
		return (
			<div className="lexical-lab-shell">
				<div className="lexical-lab-main-area">
					<header className="lexical-lab-header">
						<div className="lexical-lab-topbar-left">
							{onBack && (
								<button
									type="button"
									className="lexical-lab-back-button"
									onClick={onBack}
								>
									← Back
								</button>
							)}
							{onReconnect && (
								<button
									type="button"
									className="lexical-lab-back-button"
									onClick={onReconnect}
								>
									Reconnect site
								</button>
							)}
							<button
								type="button"
								className="lexical-lab-badge"
								title="⌥⌘E to switch to Koenig"
								onClick={handleToggleEngineSimple}
							>
								Lexical Lab
							</button>
						</div>
					</header>
					<main className="lexical-lab-canvas">
						<div style={{color: "var(--color-error, #ef4444)", padding: "2rem 0"}}>
							{error ?? (scrapId ? "Failed to load scrap." : "Failed to load post.")}
						</div>
					</main>
				</div>
			</div>
		);
	}

	return (
		<div
			className={
				post && drawer !== "none"
					? "lexical-lab-shell with-sidebar"
					: "lexical-lab-shell"
			}
		>
			<div className="lexical-lab-main-area">
				<header className="lexical-lab-header">
					<div className="lexical-lab-topbar-left">
						{onBack && (
							<button
								type="button"
								className="lexical-lab-back-button"
								onClick={() => {
									if (scrapId) {
										void flushSave().then(() => onBack());
									} else {
										const saver = saverRef.current;
										if (saver) {
											void saver.flush().then(() => onBack());
										} else {
											onBack();
										}
									}
								}}
							>
								← Back
							</button>
						)}
						<button
							type="button"
							className="lexical-lab-badge"
							title="⌥⌘E to switch to Koenig"
							onClick={handleToggleEngine}
						>
							Lexical Lab
						</button>
						{post && (
							<span
								className={`badge badge-${post.status}`}
								data-testid="post-status-badge"
							>
								{post.status}
							</span>
						)}
						{scrapId && (
							<span
								className="badge badge-scrap"
								data-testid="scrap-local-badge"
							>
								Scrap · Local
							</span>
						)}
						<span className="lexical-lab-status" data-testid="save-status">
							{displaySaveStatus}
						</span>
						{tkCount > 0 && (
							<span
								className="lexical-lab-tk-badge"
								data-testid="tk-badge"
								title="Editorial 'To Come' placeholders remaining in document"
							>
								TK · {tkCount}
							</span>
						)}
						{post?.status === "scheduled" && post.published_at && (
							<span
								className="editor-scheduled-hint"
								data-testid="scheduled-hint"
							>
								{new Date(post.published_at).toLocaleString()}
							</span>
						)}
					</div>

					<div className="lexical-lab-topbar-right">
						{scrapId && (
							<div style={{display: "flex", gap: "8px"}}>
								<button
									type="button"
									className="lexical-lab-action lexical-lab-action-delete"
									onClick={() => void handleDeleteScrap()}
									data-testid="delete-scrap-button"
								>
									Delete Scrap
								</button>
								<button
									type="button"
									className="lexical-lab-action lexical-lab-action-promote"
									onClick={() => void handlePromoteScrap()}
									data-testid="promote-scrap-button"
								>
									🚀 Promote to Draft
								</button>
							</div>
						)}
						{postId && post && (
							<>
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
										className="lexical-lab-action editor-action"
										onClick={handleInAppPreview}
										title="Open in-app preview window"
										data-testid="preview-window-button"
									>
										Preview
									</button>
									<button
										type="button"
										className="lexical-lab-icon-button editor-icon-button"
										onClick={handleBrowserPreview}
										title="Open preview in default browser"
										aria-label="Open preview in default browser"
										data-testid="preview-browser-button"
									>
										↗
									</button>
								</div>

								{canPublish &&
									(post.status === "published" || post.status === "sent" ? (
										<button
											type="button"
											className="lexical-lab-action editor-action"
											onClick={() => handlePublish("draft")}
											disabled={publishing}
											data-testid="unpublish-button"
										>
											Unpublish
										</button>
									) : post.status === "scheduled" ? (
										<>
											<button
												type="button"
												className="lexical-lab-action editor-action"
												onClick={handleUnschedule}
												disabled={publishing}
												data-testid="unschedule-button"
											>
												Unschedule
											</button>
											<button
												type="button"
												className="lexical-lab-action lexical-lab-action-publish editor-action editor-action-publish"
												onClick={() => setPublishModalOpen(true)}
												disabled={publishing}
												data-testid="reschedule-button"
											>
												Reschedule / Publish…
											</button>
										</>
									) : (
										<button
											type="button"
											className="lexical-lab-action lexical-lab-action-publish editor-action editor-action-publish"
											onClick={() => setPublishModalOpen(true)}
											disabled={publishing}
											data-testid="open-publish-modal-button"
										>
											Publish
										</button>
									))}

								<button
									type="button"
									className={
										drawer === "revisions"
											? "lexical-lab-icon-button is-active"
											: "lexical-lab-icon-button"
									}
									onClick={() =>
										setDrawer(current =>
											current === "revisions" ? "none" : "revisions",
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
											? "lexical-lab-icon-button is-active"
											: "lexical-lab-icon-button"
									}
									onClick={() =>
										setDrawer(current =>
											current === "settings" ? "none" : "settings",
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

				<main
					className="lexical-lab-canvas"
					data-editor-font={uiPrefs.editorFont}
					data-typewriter={uiPrefs.typewriterMode ? "on" : undefined}
				>
					{actionError && (
						<div
							className="error-banner"
							role="alert"
							data-testid="action-error-banner"
						>
							<span>{actionError}</span>
							<div className="banner-actions">
								<button
									type="button"
									onClick={() => setActionError(null)}
									data-testid="dismiss-action-error-button"
								>
									Dismiss
								</button>
							</div>
						</div>
					)}

					{!scrapId &&
						uiPrefs.showFeatureImage &&
						meta.featureImage &&
						!featureImageBroken && (
							<figure
								className="editor-feature-image"
								data-testid="editor-feature-image"
							>
								<img
									src={meta.featureImage}
									alt={meta.featureImageAlt ?? ""}
									onError={() => setFeatureImageBroken(true)}
								/>
								{meta.featureImageCaption && (
									<figcaption>{meta.featureImageCaption}</figcaption>
								)}
							</figure>
						)}

					<textarea
						ref={titleTextareaRef}
						className="lexical-lab-title-input"
						placeholder="Untitled Document"
						rows={1}
						value={title}
						onChange={e => handleTitleChange(e.target.value)}
						onKeyDown={e => {
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								if (showExcerpt && excerptTextareaRef.current) {
									excerptTextareaRef.current.focus();
								} else {
									document
										.querySelector<HTMLElement>(".lexical-lab-contenteditable")
										?.focus();
								}
							}
						}}
					/>

					{showExcerpt && (
						<textarea
							ref={excerptTextareaRef}
							className="editor-excerpt lexical-lab-excerpt-input"
							value={meta.customExcerpt}
							onChange={e =>
								handleMetaChange(
									{...meta, customExcerpt: e.target.value},
									{custom_excerpt: e.target.value || null},
								)
							}
							rows={1}
							maxLength={300}
							aria-label="Post excerpt"
							placeholder="Add an excerpt..."
							spellCheck
							data-testid="excerpt-input-inline"
						/>
					)}

				<LabSiteContext.Provider value={{site}}>
					<LexicalComposer key={`${post?.id ?? scrap?.id ?? "editor"}-${editorVersion}`} initialConfig={initialConfig}>
						<div className="lexical-lab-editor-root">
							<RichTextPlugin
								contentEditable={
									<ContentEditable className="lexical-lab-contenteditable" />
								}
								placeholder={
									<div className="lexical-lab-placeholder">
										Write your content or use Markdown shortcuts (#, *, -, &gt;)...
									</div>
								}
								ErrorBoundary={LexicalErrorBoundary}
							/>
							<HistoryPlugin />
							<ListPlugin />
							<LinkPlugin />
							<MarkdownShortcutPlugin transformers={transformers} />
							<HtmlCardShortcutPlugin />
							<SlashMenuPlugin site={site} />
							<SmartLinkPlugin site={site} />
							<MediaDropPastePlugin site={site} />
							<FocusDimmingPlugin />
							<OnChangePlugin
								ignoreSelectionChange={true}
								onChange={(editorState: EditorState) => {
									editorState.read(() => {
										const json = editorState.toJSON();
										latestJsonRef.current = json;

										const labels = findFootnoteReferenceLabels(json);
										let updated = false;
										const currentDefs = {...footnotesRef.current};
										for (const label of labels) {
											if (!(label in currentDefs)) {
												currentDefs[label] = "";
												updated = true;
											}
										}
										if (updated) {
											setFootnotes(currentDefs);
											footnotesRef.current = currentDefs;
										}

										const unwrapped = unwrapGhostCards(json, currentDefs);
										const serialized = JSON.stringify(unwrapped);
										handleContentChange(serialized);
									});
								}}
							/>
						</div>
					</LexicalComposer>
				</LabSiteContext.Provider>

				<div
					className="lexical-lab-footnotes-section"
					data-testid="footnotes-section"
				>
					<div
						className="lexical-lab-footnotes-header"
						onClick={() => setFootnotesExpanded(prev => !prev)}
					>
						<div className="lexical-lab-footnotes-title">
							<span className="lexical-lab-footnotes-chevron">
								{footnotesExpanded ? "▼" : "▶"}
							</span>
							<span>Footnotes</span>
							<span className="lexical-lab-footnotes-count">
								{Object.keys(footnotes).length}
							</span>
						</div>
						<button
							type="button"
							className="lexical-lab-footnotes-add-btn"
							onClick={e => {
								e.stopPropagation();
								handleAddFootnote();
							}}
						>
							+ Add Footnote
						</button>
					</div>
					{footnotesExpanded && (
						<div className="lexical-lab-footnotes-body">
							{Object.keys(footnotes).length === 0 ? (
								<div className="lexical-lab-footnotes-empty">
									No footnotes yet. Type <code>[^1]</code> in the editor or click
									"+ Add Footnote".
								</div>
							) : (
								<ol className="lexical-lab-footnotes-list">
									{Object.entries(footnotes).map(([label, text]) => (
										<li
											key={label}
											id={`fn-${label}`}
											className="lexical-lab-footnote-item"
										>
											<span className="lexical-lab-footnote-label">
												[{label}]
											</span>
											<FootnoteDefinitionField
												label={label}
												text={text}
												onChange={newText =>
													handleUpdateFootnote(label, newText)
												}
											/>
											<button
												type="button"
												className="lexical-lab-footnote-jump-btn"
												title="Jump to reference in editor"
												onClick={() => handleJumpToReference(label)}
											>
												↩
											</button>
											<button
												type="button"
												className="lexical-lab-footnote-delete-btn"
												title="Delete footnote"
												onClick={() => handleDeleteFootnote(label)}
											>
												×
											</button>
										</li>
									))}
								</ol>
							)}
						</div>
					)}
				</div>
			</main>

			<div
				className={
					drawer !== "none"
						? "lexical-lab-word-count with-sidebar"
						: "lexical-lab-word-count"
				}
				data-testid="word-count"
			>
				{wordCount} words · {readingTime} min read
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
				onDemoteToScrap={handleDemotePost}
				canDemoteToScrap={post.status === "draft"}
				demotingToScrap={demoting}
				onClose={() => setDrawer("none")}
			/>
		)}

		{post && drawer === "revisions" && (
			<RevisionsDrawer
				revisions={post.post_revisions ?? []}
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
				tkCount={tkCount}
				onExecute={handlePublishAction}
				onClose={() => setPublishModalOpen(false)}
			/>
		)}
	</div>
);
}

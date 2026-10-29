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
import {createSaver, type SaveStatus} from "../lib/saver";
import {createChangeFilter} from "../lib/changeFilter";
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
import {versionBanner, shouldEnforceReadOnly} from "../lib/version";
import EditorErrorBoundary from "./EditorErrorBoundary";
import MetadataSidebar, {type PostMetadataState} from "./MetadataSidebar";
import PublishModal, {type PublishAction} from "./PublishModal";
import RevisionsDrawer from "./RevisionsDrawer";
import ThemeToggle from "./ThemeToggle";

type Props = {
	site: Site;
	postId: string;
	onBack: () => void;
	onReconnect?: () => void;
};

const STATUS_COPY: Record<SaveStatus, string> = {
	clean: "",
	dirty: "Unsaved",
	saving: "Saving…",
	saved: "Saved",
	conflict: "Conflict",
	error: "Save failed",
};

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

export default function Editor({site, postId, onBack, onReconnect}: Props) {
	const [post, setPost] = useState<PostDetail | null>(null);
	const [editorVersion, setEditorVersion] = useState(0);
	const [title, setTitle] = useState("");
	const [meta, setMeta] = useState<PostMetadataState>({
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
	});
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
	const [statusMessage, setStatusMessage] = useState<string | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [errorStatus, setErrorStatus] = useState<number | undefined>();
	const [conflict, setConflict] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [readOnlyOverride, setReadOnlyOverride] = useState(false);
	const [lexical, setLexical] = useState<string>("");

	const [editorError, setEditorError] = useState<string | null>(null);
	const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
	const [snippets, setSnippets] = useState<Snippet[]>([]);

	const saverRef = useRef<ReturnType<typeof createSaver> | null>(null);
	const changeFilterRef = useRef(createChangeFilter());
	const editorErrorRef = useRef(false);
	const activePostIdRef = useRef(postId);

	useEffect(() => {
		activePostIdRef.current = postId;
	}, [postId]);

	// Computed synchronously so the guard is correct on the very first render
	// (stable callbacks read it through the ref).
	const isReadOnly = shouldEnforceReadOnly(site.version) && !readOnlyOverride;
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

	const bindPost = useCallback(
		(p: PostDetail) => {
			setPost(p);
			setTitle(p.title ?? "");
			setLexical(p.lexical ?? "");
			setMeta(metaFromPost(p));
			setConflict(false);
			setStatus("clean");
			setStatusMessage(undefined);
			setEditorError(null);
			editorErrorRef.current = false;
			changeFilterRef.current.reset();
			saverRef.current = createSaver(site, p.id, p.updated_at, {
				onStatus: (s, message) => {
					setStatus(s);
					setStatusMessage(message);
				},
				onConflict: () => setConflict(true),
			});
		},
		[site],
	);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		setErrorStatus(undefined);

		fetchPost(site, postId)
			.then(p => {
				if (cancelled) {
					return;
				}
				bindPost(p);
			})
			.catch(err => {
				if (cancelled) {
					return;
				}
				if (err instanceof GhostError) {
					setError(err.message);
					setErrorStatus(err.status);
				} else {
					setError(String(err));
				}
			});

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
	}, [site, postId, bindPost]);

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
	// in Koenig's context, so updating it does not remount the editor.
	useEffect(() => {
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
	}, [site]);

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

	const handleBody = useCallback((state: unknown) => {
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
			saverRef.current?.queueDebounced({lexical: next});
		}
	}, []);

	const handleEditorError = useCallback((err: unknown) => {
		editorErrorRef.current = true;
		const message = err instanceof Error ? err.message : String(err);
		queueMicrotask(() => setEditorError(message));
		throw err; // keep Lexical's contract: onError must not swallow
	}, []);

	const handleTitle = useCallback((value: string) => {
		if (isReadOnlyRef.current) {
			return;
		}
		setTitle(value);
		saverRef.current?.queueDebounced({title: value});
	}, []);

	const handleMetaChange = useCallback(
		(nextMeta: PostMetadataState, patch: Record<string, unknown>) => {
			if (isReadOnlyRef.current) {
				return;
			}
			setMeta(nextMeta);
			saverRef.current?.queueDebounced(patch, 900);
		},
		[],
	);

	// Cmd+S saves now, as a revision.
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				if (isReadOnlyRef.current) {
					return;
				}
				saverRef.current
					?.flush(true)
					.then(() => refreshRevisions(postId));
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [postId, refreshRevisions]);

	// Warn before closing with unsaved work.
	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let cancelled = false;

		getCurrentWindow()
			.onCloseRequested(async event => {
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
	}, []);

	function markInteraction() {
		changeFilterRef.current.markInteraction();
	}

	async function handleBack() {
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
					This post can't be shown in the editor (it may use content from a
					newer Ghost). Your post has not been changed. Details: {message}
				</span>
				<div className="banner-actions">
					<button
						type="button"
						onClick={() => post && openPostInAdmin(post.id, site)}
					>
						Open in Ghost Admin ↗
					</button>
				</div>
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
			openUrl(previewUrl(site.siteUrl, post.uuid, previewMode)).catch(e =>
				setError(String(e)),
			);
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
		openUrl(previewUrl(site.siteUrl, post.uuid, previewMode)).catch(err =>
			setError(String(err)),
		);
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
			await saverRef.current.resumeWithUpdatedAt(fresh.updated_at);
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

	if (error && !post) {
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

	if (!post) {
		return (
			<div className="editor">
				<p className="muted">Loading…</p>
			</div>
		);
	}

	const canPublish = canPublishRole(site.role);
	const hasDrawer = drawer !== "none";
	const banner = versionBanner(site.version);

	return (
		<div className={hasDrawer ? "editor-shell with-sidebar" : "editor-shell"}>
			<div className="editor">
				<header className="editor-header">
					<button onClick={handleBack} data-testid="back-button">
						← Posts
					</button>
					<span className="muted">
						{site.title} · <span className={`badge badge-${post.status}`}>{post.status}</span>
					</span>
					{post.status === "scheduled" && post.published_at && (
						<span className="muted small" data-testid="scheduled-hint">
							Scheduled for{" "}
							{new Date(post.published_at).toLocaleString()}
						</span>
					)}
					<div className="spacer" />
					<span className={`status status-${status}`} data-testid="save-status">
						{STATUS_COPY[status]}
					</span>

					<ThemeToggle />

					<div className="preview-group">
						<select
							value={previewMode}
							onChange={e =>
								setPreviewMode(e.target.value as PreviewMemberStatus)
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
							onClick={handleInAppPreview}
							title="Open in-app preview window"
							data-testid="preview-window-button"
						>
							Preview
						</button>
						<button
							onClick={handleBrowserPreview}
							title="Open preview in default browser"
							data-testid="preview-browser-button"
						>
							↗
						</button>
					</div>

					{canPublish &&
						(post.status === "published" || post.status === "sent" ? (
							<button
								onClick={() => handlePublish("draft")}
								disabled={publishing || isReadOnly}
							>
								Unpublish
							</button>
						) : post.status === "scheduled" ? (
							<>
								<button
									type="button"
									onClick={handleUnschedule}
									disabled={publishing || isReadOnly}
								>
									Unschedule
								</button>
								<button
									type="button"
									onClick={() => setPublishModalOpen(true)}
									disabled={publishing || isReadOnly}
								>
									Reschedule / Publish…
								</button>
							</>
						) : (
							<button
								className="primary-button"
								onClick={() => setPublishModalOpen(true)}
								disabled={publishing || isReadOnly}
								data-testid="open-publish-modal-button"
							>
								Publish…
							</button>
						))}

					<button
						type="button"
						className={drawer === "settings" ? "active-button" : ""}
						onClick={() =>
							setDrawer(current =>
								current === "settings" ? "none" : "settings",
							)
						}
						title="Toggle post settings sidebar"
						data-testid="toggle-sidebar-button"
					>
						Settings
					</button>

					<button
						type="button"
						className={drawer === "revisions" ? "active-button" : ""}
						onClick={() =>
							setDrawer(current =>
								current === "revisions" ? "none" : "revisions",
							)
						}
						title="Toggle post history"
						data-testid="toggle-revisions-button"
					>
						History
					</button>
				</header>

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
								onClick={() => saverRef.current?.flush()}
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
					placeholder="Post title"
					data-testid="title-input"
				/>

				{/* key forces a clean editor when switching posts or reloading from server */}
				{editorError ? (
					renderEditorFallback(editorError)
				) : (
					<EditorErrorBoundary
						key={`${post.id}-${editorVersion}`}
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
								initialEditorState={post.lexical}
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

				<p className="muted small">
					{lexical.length.toLocaleString()} characters · Cmd+S saves a revision
				</p>
			</div>

			{drawer === "settings" && (
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
					onClose={() => setDrawer("none")}
					readOnly={isReadOnly}
				/>
			)}

			{drawer === "revisions" && (
				<RevisionsDrawer
					revisions={post.post_revisions ?? []}
					readOnly={isReadOnly}
					onRestore={handleRestoreRevision}
					onClose={() => setDrawer("none")}
				/>
			)}

			{publishModalOpen && (
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

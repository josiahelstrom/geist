import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {openUrl} from "@tauri-apps/plugin-opener";
import {KoenigComposer, KoenigEditor} from "@tryghost/koenig-lexical";
import "@tryghost/koenig-lexical/style.css";
import {
	GhostError,
	fetchPost,
	listSiteAuthors,
	listSiteTags,
	type AuthorSummary,
	type PostDetail,
	type Site,
	type TagSummary,
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
	setPostStatus,
	type PreviewMemberStatus,
} from "../lib/posts";
import {versionBanner, shouldEnforceReadOnly} from "../lib/version";
import EditorErrorBoundary from "./EditorErrorBoundary";
import MetadataSidebar, {type PostMetadataState} from "./MetadataSidebar";

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
		tags: [],
		authors: [],
	});
	const [siteTags, setSiteTags] = useState<TagSummary[]>([]);
	const [siteAuthors, setSiteAuthors] = useState<AuthorSummary[]>([]);
	const [sidebarOpen, setSidebarOpen] = useState(false);
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

		return () => {
			cancelled = true;
		};
	}, [site, postId, bindPost]);

	const refreshSnippets = useCallback(() => {
		if (site.keyKind === "staff") {
			listSnippets(site).then(setSnippets);
		}
	}, [site]);

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
				onSnippetsChanged: refreshSnippets,
			}),
			fetchEmbed: (url: string, {type}: {type: string}) =>
				fetchEmbed(site, url, type),
		}),
		[site, settings, snippets, refreshSnippets],
	);

	const handleBody = useCallback((state: unknown) => {
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
		setTitle(value);
		saverRef.current?.queueDebounced({title: value});
	}, []);

	const handleMetaChange = useCallback(
		(nextMeta: PostMetadataState, patch: Record<string, unknown>) => {
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
				saverRef.current?.flush(true);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

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

	async function handlePublish(nextStatus: "published" | "draft") {
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
			setPost({...post, status: result.status, updated_at: result.updated_at});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPublishing(false);
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
			onBack();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	function confirmPublish(nextStatus: "published" | "draft") {
		const action = nextStatus === "published" ? "Publish" : "Unpublish";
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
	const banner = versionBanner(site.version);
	const isReadOnly = shouldEnforceReadOnly(site.version) && !readOnlyOverride;

	return (
		<div className={sidebarOpen ? "editor-shell with-sidebar" : "editor-shell"}>
			<div className="editor">
				<header className="editor-header">
					<button onClick={handleBack} data-testid="back-button">
						← Posts
					</button>
					<span className="muted">
						{site.title} · <span className={`badge badge-${post.status}`}>{post.status}</span>
					</span>
					<div className="spacer" />
					<span className={`status status-${status}`} data-testid="save-status">
						{STATUS_COPY[status]}
					</span>

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
						(post.status === "published" ? (
							<button
								onClick={() => handlePublish("draft")}
								disabled={publishing}
							>
								Unpublish
							</button>
						) : (
							<button
								className="primary-button"
								onClick={() => handlePublish("published")}
								disabled={publishing}
							>
								Publish
							</button>
						))}

					<button
						type="button"
						className={sidebarOpen ? "active-button" : ""}
						onClick={() => setSidebarOpen(open => !open)}
						title="Toggle post settings sidebar"
						data-testid="toggle-sidebar-button"
					>
						Settings
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
								darkMode={document.documentElement.classList.contains("dark")}
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

			{sidebarOpen && (
				<MetadataSidebar
					site={site}
					postId={post.id}
					meta={meta}
					siteTags={siteTags}
					siteAuthors={siteAuthors}
					onChange={handleMetaChange}
					onDeletePost={handleDeletePost}
					onClose={() => setSidebarOpen(false)}
				/>
			)}
		</div>
	);
}

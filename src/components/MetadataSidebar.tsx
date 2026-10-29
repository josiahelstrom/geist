import {useEffect, useRef, useState, type ReactNode} from "react";
import {createPortal} from "react-dom";
import {
	api,
	rotateStaffToken,
	type AuthorSummary,
	type PostVisibility,
	type Site,
	type TagSummary,
	type TierSummary,
} from "../lib/api";
import {
	MAX_EXCERPT_LENGTH,
	MAX_FEATURE_IMAGE_ALT_LENGTH,
	canEditAuthorsRole,
	canEditVisibilityRole,
	openPostInAdmin,
	serializeTagsForSave,
	serializeTiersForSave,
} from "../lib/posts";
import {urlFromUploadResponse} from "../lib/uploader";

export type PostMetadataState = {
	slug: string;
	customExcerpt: string;
	featureImage: string;
	featureImageAlt: string;
	featureImageCaption: string;
	featured: boolean;
	visibility: PostVisibility;
	tiers: TierSummary[];
	tags: TagSummary[];
	authors: AuthorSummary[];
};

type Props = {
	site: Site;
	postId: string;
	meta: PostMetadataState;
	siteTags: TagSummary[];
	siteAuthors: AuthorSummary[];
	siteTiers: TierSummary[];
	revisionsCount?: number;
	onOpenRevisions?: () => void;
	onChange: (
		next: PostMetadataState,
		patch: Record<string, unknown>,
	) => void;
	onDeletePost: () => Promise<void>;
	/** Back up this draft locally and remove it from Ghost. */
	onDemoteToScrap?: () => Promise<void>;
	canDemoteToScrap?: boolean;
	demotingToScrap?: boolean;
	onClose: () => void;
	/** Version guard is active: render values but block every mutation. */
	readOnly?: boolean;
};

type DisclosureProps = {
	title: string;
	count?: number;
	defaultOpen?: boolean;
	children: ReactNode;
};

/** A macOS-style disclosure section with a rotating chevron indicator. */
function Disclosure({
	title,
	count,
	defaultOpen = true,
	children,
}: DisclosureProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<section className={open ? "inspector-section is-open" : "inspector-section"}>
			<button
				type="button"
				className="inspector-disclosure"
				aria-expanded={open}
				onClick={() => setOpen(value => !value)}
			>
				<svg
					className="disclosure-chevron"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					aria-hidden="true"
				>
					<path
						d="M3.5 1.5 6.5 5 3.5 8.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span className="disclosure-title">{title}</span>
				{typeof count === "number" && count > 0 ? (
					<span className="disclosure-count">{count}</span>
				) : null}
			</button>
			<div className="inspector-section-body" hidden={!open}>
				{children}
			</div>
		</section>
	);
}

export default function MetadataSidebar({
	site,
	postId,
	meta,
	siteTags,
	siteAuthors,
	siteTiers,
	revisionsCount,
	onOpenRevisions,
	onChange,
	onDeletePost,
	onDemoteToScrap,
	canDemoteToScrap = false,
	demotingToScrap = false,
	onClose,
	readOnly = false,
}: Props) {
	const [tagInput, setTagInput] = useState("");
	const [authorSelect, setAuthorSelect] = useState("");
	const [uploadingImage, setUploadingImage] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [confirmingRotate, setConfirmingRotate] = useState(false);
	const [rotating, setRotating] = useState(false);
	const [rotateError, setRotateError] = useState<string | null>(null);
	const [rotateNote, setRotateNote] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// Keep a rotation confirmation from lingering forever.
	useEffect(() => {
		if (!rotateNote) {
			return;
		}
		const timer = window.setTimeout(() => setRotateNote(null), 4000);
		return () => window.clearTimeout(timer);
	}, [rotateNote]);

	// Escape closes the confirmation sheet.
	useEffect(() => {
		if (!confirmingRotate) {
			return;
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape" && !rotating) {
				setConfirmingRotate(false);
				setRotateError(null);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [confirmingRotate, rotating]);

	const canEditAuthors = canEditAuthorsRole(site.role);
	const canEditVisibility = canEditVisibilityRole(site.role);

	function updateField<K extends keyof PostMetadataState>(
		key: K,
		value: PostMetadataState[K],
		apiPatch: Record<string, unknown>,
	) {
		if (readOnly) {
			return;
		}
		onChange({...meta, [key]: value}, apiPatch);
	}

	async function handleFeatureImageSelect(
		e: React.ChangeEvent<HTMLInputElement>,
	) {
		if (readOnly) {
			return;
		}
		const file = e.target.files?.[0];
		if (!file) {
			return;
		}
		setUploadingImage(true);
		setUploadError(null);
		try {
			const form = new FormData();
			form.append("file", file, file.name);
			const res = await api<{images?: {url: string}[]}>(
				site,
				"/images/upload/",
				{
					method: "POST",
					body: form,
				},
			);
			const url = urlFromUploadResponse(res);
			if (!url) {
				throw new Error("Server did not return an image URL.");
			}
			updateField("featureImage", url, {feature_image: url});
		} catch (err) {
			setUploadError(err instanceof Error ? err.message : String(err));
		} finally {
			setUploadingImage(false);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	}

	function handleRemoveFeatureImage() {
		if (readOnly) {
			return;
		}
		onChange(
			{
				...meta,
				featureImage: "",
				featureImageAlt: "",
				featureImageCaption: "",
			},
			{
				feature_image: null,
				feature_image_alt: null,
				feature_image_caption: null,
			},
		);
	}

	function handleAddTag(rawName: string) {
		if (readOnly) {
			return;
		}
		const trimmed = rawName.trim().replace(/,+$/, "").trim();
		if (!trimmed) {
			return;
		}
		const already = meta.tags.some(
			t => t.name.toLowerCase() === trimmed.toLowerCase(),
		);
		if (already) {
			setTagInput("");
			return;
		}
		const existing = siteTags.find(
			t => t.name.toLowerCase() === trimmed.toLowerCase(),
		);
		const nextTag: TagSummary = existing
			? {id: existing.id, name: existing.name, slug: existing.slug}
			: {name: trimmed};
		const nextTags = [...meta.tags, nextTag];
		setTagInput("");
		updateField("tags", nextTags, {
			tags: serializeTagsForSave(nextTags),
		});
	}

	function handleRemoveTag(index: number) {
		if (readOnly) {
			return;
		}
		const nextTags = meta.tags.filter((_, i) => i !== index);
		updateField("tags", nextTags, {
			tags: serializeTagsForSave(nextTags),
		});
	}

	function handleAddAuthor(authorId: string) {
		if (readOnly || !authorId) {
			return;
		}
		const candidate = siteAuthors.find(a => a.id === authorId);
		if (!candidate || meta.authors.some(a => a.id === candidate.id)) {
			setAuthorSelect("");
			return;
		}
		const nextAuthors = [...meta.authors, candidate];
		setAuthorSelect("");
		updateField("authors", nextAuthors, {
			authors: nextAuthors.map(a => ({id: a.id})),
		});
	}

	function handleRemoveAuthor(authorId: string) {
		if (readOnly) {
			return;
		}
		if (meta.authors.length <= 1) {
			return; // Ghost requires at least one author on every post
		}
		const nextAuthors = meta.authors.filter(a => a.id !== authorId);
		updateField("authors", nextAuthors, {
			authors: nextAuthors.map(a => ({id: a.id})),
		});
	}

	function handleVisibilityChange(value: string) {
		if (readOnly || !canEditVisibility) {
			return;
		}
		const next = value as PostVisibility;
		if (next === "tiers") {
			updateField("visibility", next, {
				visibility: next,
				tiers: serializeTiersForSave(meta.tiers),
			});
			return;
		}
		updateField("visibility", next, {visibility: next});
	}

	function handleAddTier(tierId: string) {
		if (readOnly || !canEditVisibility || !tierId) {
			return;
		}
		const tier = siteTiers.find(t => t.id === tierId);
		if (!tier || meta.tiers.some(existing => existing.id === tier.id)) {
			return;
		}
		const nextTiers = [...meta.tiers, tier];
		updateField("tiers", nextTiers, {
			visibility: "tiers",
			tiers: serializeTiersForSave(nextTiers),
		});
	}

	function handleRemoveTier(tierId: string) {
		if (readOnly || !canEditVisibility) {
			return;
		}
		const nextTiers = meta.tiers.filter(tier => tier.id !== tierId);
		updateField("tiers", nextTiers, {
			visibility: "tiers",
			tiers: serializeTiersForSave(nextTiers),
		});
	}

	async function handleDelete() {
		if (readOnly) {
			return;
		}
		setDeleting(true);
		try {
			await onDeletePost();
		} finally {
			setDeleting(false);
		}
	}

	async function handleRotateStaffToken() {
		setRotating(true);
		setRotateError(null);
		setRotateNote(null);
		try {
			await rotateStaffToken(site.base, site.clockOffset);
			setConfirmingRotate(false);
			setRotateNote("Staff Access Token rotated.");
		} catch (err) {
			setRotateError(err instanceof Error ? err.message : String(err));
		} finally {
			setRotating(false);
		}
	}

	const availableAuthors = siteAuthors.filter(
		a => !meta.authors.some(existing => existing.id === a.id),
	);
	const availableTiers = siteTiers.filter(
		tier =>
			tier.type === "paid" &&
			!meta.tiers.some(existing => existing.id === tier.id),
	);

	return (
		<aside
			className="inspector meta-sidebar"
			data-testid="meta-sidebar"
			aria-label="Post settings"
		>
			<header className="inspector-header">
				<h2 className="inspector-title">Post settings</h2>
				<button
					type="button"
					className="inspector-close"
					onClick={onClose}
					title="Close settings"
					aria-label="Close settings"
				>
					✕
				</button>
			</header>

			<div className="inspector-scroll" data-testid="metadata-sidebar">
				<Disclosure
					title="Post access"
					count={meta.visibility === "tiers" ? meta.tiers.length : undefined}
				>
					<label className="inspector-label" htmlFor="post-visibility-select">
						Who can read this post
					</label>
					<select
						id="post-visibility-select"
						className="inspector-select"
						value={meta.visibility}
						disabled={!canEditVisibility || readOnly}
						onChange={e => handleVisibilityChange(e.target.value)}
						data-testid="visibility-select"
					>
						<option value="public">Public</option>
						<option value="members">Members only</option>
						<option value="paid">Paid-members only</option>
						<option value="tiers">Specific tiers</option>
					</select>
					{meta.visibility === "tiers" && (
						<>
							{meta.tiers.length > 0 && (
								<div className="inspector-chips" data-testid="post-tiers">
									{meta.tiers.map(tier => (
										<span key={tier.id} className="inspector-chip">
											{tier.name}
											<button
												type="button"
												className="inspector-chip-remove"
												onClick={() => handleRemoveTier(tier.id)}
												disabled={!canEditVisibility || readOnly}
												aria-label={`Remove tier ${tier.name}`}
											>
												×
											</button>
										</span>
									))}
								</div>
							)}
							<select
								className="inspector-select"
								value=""
								onChange={e => handleAddTier(e.target.value)}
								disabled={
									!canEditVisibility ||
									readOnly ||
									availableTiers.length === 0
								}
								aria-label="Add a tier"
								data-testid="tier-select"
							>
								<option value="">Add a tier…</option>
								{availableTiers.map(tier => (
									<option key={tier.id} value={tier.id}>
										{tier.name}
									</option>
								))}
							</select>
						</>
					)}
					{!canEditVisibility && (
						<p className="inspector-hint">
							Your role ({site.role}) cannot change post access.
						</p>
					)}

					<label className="inspector-checkbox">
						<input
							type="checkbox"
							checked={meta.featured}
							onChange={e =>
								updateField("featured", e.target.checked, {
									featured: e.target.checked,
								})
							}
							disabled={readOnly}
							data-testid="featured-checkbox"
						/>
						<span>Feature this post</span>
					</label>
				</Disclosure>

				<Disclosure title="Tags" count={meta.tags.length}>
					{meta.tags.length > 0 && (
						<div className="inspector-chips" data-testid="post-tags">
							{meta.tags.map((tag, idx) => (
								<span
									key={`${tag.slug ?? tag.name}-${idx}`}
									className={
										idx === 0
											? "inspector-chip is-primary"
											: "inspector-chip"
									}
									title={idx === 0 ? "Primary tag" : undefined}
								>
									{tag.name}
									<button
										type="button"
										className="inspector-chip-remove"
										onClick={() => handleRemoveTag(idx)}
										disabled={readOnly}
										aria-label={`Remove tag ${tag.name}`}
									>
										×
									</button>
								</span>
							))}
						</div>
					)}
					<div className="inspector-inline-row">
						<input
							id="post-tag-input"
							className="inspector-input"
							list="geist-site-tags"
							value={tagInput}
							onChange={e => setTagInput(e.target.value)}
							onKeyDown={e => {
								if (e.key === "Enter" || e.key === ",") {
									e.preventDefault();
									handleAddTag(tagInput);
								}
							}}
							placeholder="Add a tag and press Enter…"
							disabled={readOnly}
							data-testid="tag-input"
						/>
						<button
							type="button"
							className="inspector-secondary-button"
							onClick={() => handleAddTag(tagInput)}
							disabled={readOnly || !tagInput.trim()}
						>
							Add
						</button>
					</div>
					<datalist id="geist-site-tags">
						{siteTags.map(t => (
							<option key={t.id ?? t.name} value={t.name} />
						))}
					</datalist>
				</Disclosure>

				<Disclosure title="Authors" count={meta.authors.length}>
					<div className="inspector-chips" data-testid="post-authors">
						{meta.authors.map(author => (
							<span key={author.id} className="inspector-chip">
								{author.name}
								{canEditAuthors && meta.authors.length > 1 && (
									<button
										type="button"
										className="inspector-chip-remove"
										onClick={() => handleRemoveAuthor(author.id)}
										disabled={readOnly}
										aria-label={`Remove author ${author.name}`}
									>
										×
									</button>
								)}
							</span>
						))}
					</div>
					{canEditAuthors && availableAuthors.length > 0 && (
						<div className="inspector-inline-row">
							<select
								className="inspector-select"
								value={authorSelect}
								onChange={e => {
									setAuthorSelect(e.target.value);
									handleAddAuthor(e.target.value);
								}}
								aria-label="Add author"
								disabled={readOnly}
								data-testid="author-select"
							>
								<option value="">Add co-author…</option>
								{availableAuthors.map(a => (
									<option key={a.id} value={a.id}>
										{a.name}
									</option>
								))}
							</select>
						</div>
					)}
					{!canEditAuthors && (
						<p className="inspector-hint">
							Your role ({site.role}) cannot reassign authors.
						</p>
					)}
				</Disclosure>

				<Disclosure title="Feature image">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						onChange={handleFeatureImageSelect}
						disabled={readOnly}
						style={{display: "none"}}
						data-testid="feature-image-file-input"
					/>
					{meta.featureImage ? (
						<div className="inspector-feature">
							<img
								src={meta.featureImage}
								alt={meta.featureImageAlt || "Feature image"}
								className="inspector-feature-preview"
							/>
							<div className="inspector-feature-actions">
								<button
									type="button"
									className="inspector-secondary-button"
									onClick={() => fileInputRef.current?.click()}
									disabled={uploadingImage || readOnly}
								>
									{uploadingImage ? "Uploading…" : "Replace"}
								</button>
								<button
									type="button"
									className="inspector-secondary-button"
									onClick={handleRemoveFeatureImage}
									disabled={uploadingImage || readOnly}
								>
									Remove
								</button>
							</div>
							<input
								className="inspector-input"
								value={meta.featureImageAlt}
								maxLength={MAX_FEATURE_IMAGE_ALT_LENGTH}
								onChange={e =>
									updateField("featureImageAlt", e.target.value, {
										feature_image_alt: e.target.value || null,
									})
								}
								placeholder="Alt text (describes image)"
								disabled={readOnly}
								data-testid="feature-image-alt"
							/>
							<input
								className="inspector-input"
								value={meta.featureImageCaption}
								onChange={e =>
									updateField(
										"featureImageCaption",
										e.target.value,
										{
											feature_image_caption:
												e.target.value || null,
										},
									)
								}
								placeholder="Caption (optional)"
								disabled={readOnly}
								data-testid="feature-image-caption"
							/>
						</div>
					) : (
						<button
							type="button"
							className="inspector-upload"
							onClick={() => fileInputRef.current?.click()}
							disabled={uploadingImage || readOnly}
						>
							{uploadingImage ? "Uploading…" : "Upload feature image"}
						</button>
					)}
					{uploadError && (
						<p className="inspector-error" role="alert">
							{uploadError}
						</p>
					)}
				</Disclosure>

				<Disclosure title="Post URL">
					<label className="inspector-label" htmlFor="post-slug-input">
						URL slug
					</label>
					<input
						id="post-slug-input"
						className="inspector-input"
						value={meta.slug}
						onChange={e =>
							updateField("slug", e.target.value, {slug: e.target.value})
						}
						placeholder="post-slug"
						spellCheck={false}
						disabled={readOnly}
						data-testid="slug-input"
					/>
					<p
						className="inspector-hint truncate"
						title={`${site.siteUrl}${meta.slug || ""}/`}
					>
						{site.siteUrl}
						{meta.slug || "…"}/
					</p>
				</Disclosure>

				<Disclosure title="Post excerpt">
					<div className="inspector-label-row">
						<label className="inspector-label" htmlFor="post-excerpt-input">
							Excerpt
						</label>
						<span
							className={
								meta.customExcerpt.length > MAX_EXCERPT_LENGTH
									? "inspector-char-count is-over"
									: "inspector-char-count"
							}
						>
							{meta.customExcerpt.length}/{MAX_EXCERPT_LENGTH}
						</span>
					</div>
					<textarea
						id="post-excerpt-input"
						className="inspector-textarea"
						rows={3}
						maxLength={MAX_EXCERPT_LENGTH}
						value={meta.customExcerpt}
						onChange={e => {
							const next = e.target.value.slice(0, MAX_EXCERPT_LENGTH);
							updateField("customExcerpt", next, {
								custom_excerpt: next || null,
							});
						}}
						placeholder="Short summary for cards, emails and social previews…"
						disabled={readOnly}
						data-testid="excerpt-input"
					/>
				</Disclosure>

				<Disclosure title="Account & security" defaultOpen={false}>
					<div className="inspector-account">
						<span className="inspector-account-site" title={site.siteUrl}>
							{site.title || site.siteUrl}
						</span>
						<span className="inspector-account-meta">
							{site.keyKind === "staff"
								? "Staff account"
								: "Integration token"}
							{site.role ? ` · ${site.role}` : ""}
						</span>
					</div>

					{site.keyKind === "staff" ? (
						<>
							<button
								type="button"
								className="inspector-secondary-button inspector-account-button"
								onClick={() => {
									setRotateError(null);
									setRotateNote(null);
									setConfirmingRotate(true);
								}}
								data-testid="rotate-staff-token-button"
							>
								Rotate Staff Token
							</button>
							<p className="inspector-hint">
								Generates a new secret and updates Geist&apos;s Keychain
								entry.
							</p>
						</>
					) : (
						<p className="inspector-hint">
							Integration tokens are managed in Ghost Admin.
						</p>
					)}

					{rotateNote && (
						<p className="inspector-toast" role="status">
							{rotateNote}
						</p>
					)}
					{rotateError && !confirmingRotate && (
						<p className="inspector-error" role="alert">
							{rotateError}
						</p>
					)}
				</Disclosure>

				<div className="inspector-footer">
					{onOpenRevisions && (
						<button
							type="button"
							className="inspector-secondary-button inspector-footer-button"
							onClick={onOpenRevisions}
							data-testid="open-revisions-button"
						>
							Post history ({revisionsCount ?? 0})
						</button>
					)}
					<button
						type="button"
						className="inspector-secondary-button inspector-footer-button"
						onClick={() => {
							void openPostInAdmin(postId, site).catch(() => {
								/* The opener plugin is unavailable outside Tauri. */
							});
						}}
					>
						Open in Ghost Admin ↗
					</button>
					{onDemoteToScrap && (
						<button
							type="button"
							className="inspector-secondary-button inspector-footer-button"
							onClick={() => void onDemoteToScrap()}
							disabled={
								!canDemoteToScrap ||
								readOnly ||
								demotingToScrap
							}
							title={
								canDemoteToScrap
									? "Move this draft to local Scraps"
									: "Only draft posts can be moved to Scraps"
							}
							data-testid="demote-to-scrap-button"
						>
							{demotingToScrap ? "Moving…" : "Demote to Scrap"}
						</button>
					)}
					<button
						type="button"
						className="inspector-danger-button inspector-footer-button"
						onClick={handleDelete}
						disabled={deleting || readOnly}
						data-testid="delete-post-button"
					>
						{deleting ? "Deleting…" : "Delete post"}
					</button>
				</div>
			</div>
			{confirmingRotate &&
				createPortal(
					<div
						className="rotate-dialog-backdrop"
						onMouseDown={event => {
							if (event.target === event.currentTarget && !rotating) {
								setConfirmingRotate(false);
								setRotateError(null);
							}
						}}
					>
						<div
							className="rotate-dialog"
							role="dialog"
							aria-modal="true"
							aria-labelledby="rotate-dialog-title"
							aria-describedby="rotate-dialog-copy"
							data-testid="rotate-staff-token-dialog"
						>
							<h2
								id="rotate-dialog-title"
								className="rotate-dialog-title"
							>
								Rotate Staff Access Token?
							</h2>
							<p id="rotate-dialog-copy" className="rotate-dialog-copy">
								Rotating your Staff Access Token will generate a new
								secret and update Geist&apos;s Keychain entry. Any other
								client using this staff token will need to be reconnected.
								Continue?
							</p>

							{rotateError && (
								<div className="rotate-dialog-error" role="alert">
									{rotateError}
								</div>
							)}

							<div className="rotate-dialog-actions">
								<button
									type="button"
									className="rotate-dialog-cancel"
									onClick={() => {
										setConfirmingRotate(false);
										setRotateError(null);
									}}
									disabled={rotating}
								>
									Cancel
								</button>
								<button
									type="button"
									className="rotate-dialog-confirm"
									onClick={handleRotateStaffToken}
									disabled={rotating}
									data-testid="confirm-rotate-staff-token"
								>
									{rotating ? (
										<>
											<span
												className="connect-spinner"
												aria-hidden="true"
											/>
											Rotating…
										</>
									) : (
										"Rotate Token"
									)}
								</button>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</aside>
	);
}

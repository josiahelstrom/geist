import {useRef, useState} from "react";
import {
	api,
	type AuthorSummary,
	type Site,
	type TagSummary,
} from "../lib/api";
import {
	MAX_EXCERPT_LENGTH,
	MAX_FEATURE_IMAGE_ALT_LENGTH,
	canEditAuthorsRole,
	openPostInAdmin,
	serializeTagsForSave,
} from "../lib/posts";
import {urlFromUploadResponse} from "../lib/uploader";

export type PostMetadataState = {
	slug: string;
	customExcerpt: string;
	featureImage: string;
	featureImageAlt: string;
	featureImageCaption: string;
	featured: boolean;
	tags: TagSummary[];
	authors: AuthorSummary[];
};

type Props = {
	site: Site;
	postId: string;
	meta: PostMetadataState;
	siteTags: TagSummary[];
	siteAuthors: AuthorSummary[];
	onChange: (
		next: PostMetadataState,
		patch: Record<string, unknown>,
	) => void;
	onDeletePost: () => Promise<void>;
	onClose: () => void;
};

export default function MetadataSidebar({
	site,
	postId,
	meta,
	siteTags,
	siteAuthors,
	onChange,
	onDeletePost,
	onClose,
}: Props) {
	const [tagInput, setTagInput] = useState("");
	const [authorSelect, setAuthorSelect] = useState("");
	const [uploadingImage, setUploadingImage] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const canEditAuthors = canEditAuthorsRole(site.role);

	function updateField<K extends keyof PostMetadataState>(
		key: K,
		value: PostMetadataState[K],
		apiPatch: Record<string, unknown>,
	) {
		onChange({...meta, [key]: value}, apiPatch);
	}

	async function handleFeatureImageSelect(
		e: React.ChangeEvent<HTMLInputElement>,
	) {
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
		const nextTags = meta.tags.filter((_, i) => i !== index);
		updateField("tags", nextTags, {
			tags: serializeTagsForSave(nextTags),
		});
	}

	function handleAddAuthor(authorId: string) {
		if (!authorId) {
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
		if (meta.authors.length <= 1) {
			return; // Ghost requires at least one author on every post
		}
		const nextAuthors = meta.authors.filter(a => a.id !== authorId);
		updateField("authors", nextAuthors, {
			authors: nextAuthors.map(a => ({id: a.id})),
		});
	}

	async function handleDelete() {
		setDeleting(true);
		try {
			await onDeletePost();
		} finally {
			setDeleting(false);
		}
	}

	const availableAuthors = siteAuthors.filter(
		a => !meta.authors.some(existing => existing.id === a.id),
	);

	return (
		<aside className="meta-sidebar" data-testid="meta-sidebar">
			<div className="meta-sidebar-header">
				<h2>Post settings</h2>
				<button
					type="button"
					className="icon-button"
					onClick={onClose}
					title="Close settings"
				>
					✕
				</button>
			</div>

			<section className="meta-section">
				<label className="meta-label">Feature image</label>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					onChange={handleFeatureImageSelect}
					style={{display: "none"}}
					data-testid="feature-image-file-input"
				/>
				{meta.featureImage ? (
					<div className="feature-image-card">
						<img
							src={meta.featureImage}
							alt={meta.featureImageAlt || "Feature image"}
							className="feature-image-preview"
						/>
						<div className="feature-image-actions">
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								disabled={uploadingImage}
							>
								{uploadingImage ? "Uploading…" : "Replace"}
							</button>
							<button
								type="button"
								onClick={handleRemoveFeatureImage}
								disabled={uploadingImage}
							>
								Remove
							</button>
						</div>
						<input
							value={meta.featureImageAlt}
							maxLength={MAX_FEATURE_IMAGE_ALT_LENGTH}
							onChange={e =>
								updateField("featureImageAlt", e.target.value, {
									feature_image_alt: e.target.value || null,
								})
							}
							placeholder="Alt text (describes image)"
							data-testid="feature-image-alt"
						/>
						<input
							value={meta.featureImageCaption}
							onChange={e =>
								updateField("featureImageCaption", e.target.value, {
									feature_image_caption: e.target.value || null,
								})
							}
							placeholder="Caption (optional)"
							data-testid="feature-image-caption"
						/>
					</div>
				) : (
					<div className="feature-image-empty">
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							disabled={uploadingImage}
						>
							{uploadingImage ? "Uploading…" : "Upload feature image"}
						</button>
					</div>
				)}
				{uploadError && <p className="error small">{uploadError}</p>}
			</section>

			<section className="meta-section">
				<label className="meta-label" htmlFor="post-slug-input">
					Post URL slug
				</label>
				<input
					id="post-slug-input"
					value={meta.slug}
					onChange={e =>
						updateField("slug", e.target.value, {slug: e.target.value})
					}
					placeholder="post-slug"
					spellCheck={false}
					data-testid="slug-input"
				/>
				<p className="hint truncate" title={`${site.siteUrl}${meta.slug || ""}/`}>
					{site.siteUrl}
					{meta.slug || "…"}
					/
				</p>
			</section>

			<section className="meta-section">
				<div className="meta-label-row">
					<label className="meta-label" htmlFor="post-excerpt-input">
						Excerpt
					</label>
					<span
						className={
							meta.customExcerpt.length > MAX_EXCERPT_LENGTH
								? "char-counter over"
								: "char-counter"
						}
					>
						{meta.customExcerpt.length}/{MAX_EXCERPT_LENGTH}
					</span>
				</div>
				<textarea
					id="post-excerpt-input"
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
					data-testid="excerpt-input"
				/>
			</section>

			<section className="meta-section">
				<label className="meta-label" htmlFor="post-tag-input">
					Tags
				</label>
				{meta.tags.length > 0 && (
					<div className="chip-list" data-testid="post-tags">
						{meta.tags.map((tag, idx) => (
							<span
								key={`${tag.slug ?? tag.name}-${idx}`}
								className={idx === 0 ? "chip primary" : "chip"}
								title={idx === 0 ? "Primary tag" : undefined}
							>
								{tag.name}
								<button
									type="button"
									className="chip-remove"
									onClick={() => handleRemoveTag(idx)}
									aria-label={`Remove tag ${tag.name}`}
								>
									×
								</button>
							</span>
						))}
					</div>
				)}
				<div className="inline-input-row">
					<input
						id="post-tag-input"
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
						data-testid="tag-input"
					/>
					<button
						type="button"
						onClick={() => handleAddTag(tagInput)}
						disabled={!tagInput.trim()}
					>
						Add
					</button>
				</div>
				<datalist id="geist-site-tags">
					{siteTags.map(t => (
						<option key={t.id ?? t.name} value={t.name} />
					))}
				</datalist>
			</section>

			<section className="meta-section">
				<label className="meta-label">Authors</label>
				<div className="chip-list" data-testid="post-authors">
					{meta.authors.map(author => (
						<span key={author.id} className="chip">
							{author.name}
							{canEditAuthors && meta.authors.length > 1 && (
								<button
									type="button"
									className="chip-remove"
									onClick={() => handleRemoveAuthor(author.id)}
									aria-label={`Remove author ${author.name}`}
								>
									×
								</button>
							)}
						</span>
					))}
				</div>
				{canEditAuthors && availableAuthors.length > 0 && (
					<div className="inline-input-row">
						<select
							value={authorSelect}
							onChange={e => {
								setAuthorSelect(e.target.value);
								handleAddAuthor(e.target.value);
							}}
							aria-label="Add author"
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
					<p className="hint">
						Your role ({site.role}) cannot reassign authors.
					</p>
				)}
			</section>

			<section className="meta-section">
				<label className="checkbox-row">
					<input
						type="checkbox"
						checked={meta.featured}
						onChange={e =>
							updateField("featured", e.target.checked, {
								featured: e.target.checked,
							})
						}
						data-testid="featured-checkbox"
					/>
					<span>Feature this post</span>
				</label>
			</section>

			<section className="meta-section meta-footer-actions">
				<button
					type="button"
					onClick={() => openPostInAdmin(postId, site)}
				>
					Open in Ghost Admin ↗
				</button>
				<button
					type="button"
					className="danger-button"
					onClick={handleDelete}
					disabled={deleting}
					data-testid="delete-post-button"
				>
					{deleting ? "Deleting…" : "Delete post"}
				</button>
			</section>
		</aside>
	);
}

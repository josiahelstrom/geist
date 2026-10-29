import {invoke} from "@tauri-apps/api/core";
import {GhostError, api} from "./api";
import type {EmailSegment, Post, Site, TagSummary} from "./api";

/** Ghost 6.68 schema validation limits (`core/server/data/schema/schema.js`). */
export const MAX_EXCERPT_LENGTH = 300;
export const MAX_FEATURE_IMAGE_ALT_LENGTH = 191;

export type PreviewMemberStatus = "default" | "anonymous" | "free" | "paid";

/**
 * Publish / unpublish.
 *
 * Safety rule 4.2: publishing must change `status` and nothing else. Sending
 * `newsletter` or `email_segment` would email every subscriber, which cannot be
 * undone. Real newsletter sending is not implemented in v0.1/v0.2 by design.
 *
 * The body is constructed field by field here rather than by spreading an
 * options object, so it is impossible for a caller to smuggle in a newsletter
 * parameter by accident.
 */
export async function setPostStatus(
	site: Site,
	postId: string,
	updatedAt: string,
	status: "published" | "draft",
) {
	const res = await api<{posts: {status: string; updated_at: string}[]}>(
		site,
		`/posts/${postId}/`,
		{
			method: "PUT",
			body: JSON.stringify({
				posts: [{status, updated_at: updatedAt}],
			}),
		},
	);
	return res.posts[0];
}

/**
 * `newsletter` and `email_segment` are query parameters on publish in Ghost.
 * Returns "" when no newsletter is selected so callers can interpolate safely.
 */
export function buildNewsletterQuery(
	newsletterSlug?: string,
	emailSegment?: EmailSegment,
): string {
	const slug = newsletterSlug?.trim();
	if (!slug) {
		return "";
	}
	let query = `?newsletter=${encodeURIComponent(slug)}`;
	if (emailSegment && emailSegment !== "all") {
		query += `&email_segment=${encodeURIComponent(emailSegment)}`;
	}
	return query;
}

/**
 * Publishes a post and sends it as a newsletter. The caller must have already
 * confirmed the recipient count with the user (`confirmedRecipientCount`); this
 * is the explicit opt-in to the irreversible send that rule 4.2 protects.
 */
export async function publishWithNewsletter(
	site: Site,
	postId: string,
	updatedAt: string,
	options: {
		newsletterSlug: string;
		emailSegment?: EmailSegment;
		emailOnly?: boolean;
		confirmedRecipientCount: number;
	},
) {
	const slug = options.newsletterSlug?.trim();
	if (!slug) {
		throw new Error("Choose a newsletter before publishing.");
	}
	if (
		!Number.isInteger(options.confirmedRecipientCount) ||
		options.confirmedRecipientCount < 0
	) {
		throw new Error("Confirm the recipient count before publishing.");
	}
	const res = await api<{posts: {status: string; updated_at: string}[]}>(
		site,
		`/posts/${postId}/${buildNewsletterQuery(slug, options.emailSegment)}`,
		{
			method: "PUT",
			body: JSON.stringify({
				posts: [
					{
						status: "published",
						...(options.emailOnly ? {email_only: true} : {}),
						updated_at: updatedAt,
					},
				],
			}),
		},
	);
	return res.posts[0];
}

/**
 * Schedules a post. A future `published_at` is required; an email-only
 * scheduled post must also target a newsletter, matching Ghost's server rule.
 */
export async function schedulePost(
	site: Site,
	postId: string,
	updatedAt: string,
	options: {
		publishedAt: string;
		newsletterSlug?: string;
		emailSegment?: EmailSegment;
		emailOnly?: boolean;
	},
) {
	const ms = Date.parse(options.publishedAt);
	if (!Number.isFinite(ms)) {
		throw new Error("Enter a valid publish date and time.");
	}
	if (ms <= Date.now()) {
		throw new Error("Schedule a time in the future.");
	}
	if (options.emailOnly && !options.newsletterSlug?.trim()) {
		throw new Error(
			"Choose a newsletter before scheduling an email-only post.",
		);
	}
	const res = await api<{posts: {status: string; updated_at: string}[]}>(
		site,
		`/posts/${postId}/${buildNewsletterQuery(
			options.newsletterSlug,
			options.emailSegment,
		)}`,
		{
			method: "PUT",
			body: JSON.stringify({
				posts: [
					{
						status: "scheduled",
						published_at: new Date(ms).toISOString(),
						...(options.emailOnly ? {email_only: true} : {}),
						updated_at: updatedAt,
					},
				],
			}),
		},
	);
	return res.posts[0];
}

/** Cancels a scheduled post and returns it to draft. */
export async function unschedulePost(
	site: Site,
	postId: string,
	updatedAt: string,
) {
	const res = await api<{posts: {status: string; updated_at: string}[]}>(
		site,
		`/posts/${postId}/`,
		{
			method: "PUT",
			body: JSON.stringify({
				posts: [
					{
						status: "draft",
						published_at: null,
						email_only: false,
						updated_at: updatedAt,
					},
				],
			}),
		},
	);
	return res.posts[0];
}

export async function createDraft(site: Site, title = "") {
	const res = await api<{
		posts: {
			id: string;
			uuid: string;
			title: string | null;
			slug?: string;
			status: string;
			updated_at: string;
		}[];
	}>(site, "/posts/", {
		method: "POST",
		body: JSON.stringify({posts: [{title, status: "draft"}]}),
	});
	const post = res.posts[0];
	return {
		id: post.id,
		uuid: post.uuid,
		title: post.title,
		slug: post.slug,
		status: post.status,
		updated_at: post.updated_at,
	};
}

export async function deletePost(site: Site, postId: string): Promise<void> {
	await api(site, `/posts/${postId}/`, {
		method: "DELETE",
	});
}

/**
 * Draft preview is public, so no auth is needed. Published posts redirect to
 * their permalink. Rule 4.6: this is only ever opened in the system browser or
 * an isolated external-origin WebviewWindow with zero IPC capabilities.
 */
export function previewUrl(
	siteUrl: string,
	uuid: string,
	memberStatus: PreviewMemberStatus = "default",
): string {
	const base = `${siteUrl}p/${uuid}/`;
	if (memberStatus === "default") {
		return base;
	}
	return `${base}?member_status=${encodeURIComponent(memberStatus)}`;
}

/**
 * Opens the preview inside an isolated Tauri WebviewWindow (`"preview"` label,
 * which has zero IPC capabilities in `capabilities/default.json`).
 */
export async function openInAppPreview(
	siteUrl: string,
	uuid: string,
	title: string | null | undefined,
	memberStatus: PreviewMemberStatus = "default",
): Promise<void> {
	const url = previewUrl(siteUrl, uuid, memberStatus);
	await invoke("open_preview_window", {
		url,
		title: title?.trim() || "Untitled",
	});
}

/** Embed metadata for the bookmark / embed cards. */
export async function fetchEmbed(site: Site, url: string, type: string) {
	return api(site, `/oembed/?url=${encodeURIComponent(url)}&type=${type}`);
}

export async function openPostInAdmin(
	postId: string,
	site: Site,
): Promise<void> {
	const {openUrl} = await import("@tauri-apps/plugin-opener");
	await openUrl(`${site.base}/ghost/#/editor/post/${postId}`);
}

/** Contributors cannot publish; Ghost rejects status changes from them. */
export function canPublishRole(role?: string): boolean {
	return role !== "Contributor";
}

/**
 * Ghost marks `authors` in `unsafeAttrs` alongside `status` and `visibility`
 * (`core/server/api/endpoints/posts.js:24`), so Contributors and Authors cannot
 * reassign post authors.
 */
export function canEditAuthorsRole(role?: string): boolean {
	return role !== "Contributor" && role !== "Author";
}

/**
 * Ghost's `unsafeAttrs` in `core/server/api/endpoints/posts.js` also lists
 * `visibility`, so Contributors and Authors cannot change a post's visibility.
 */
export function canEditVisibilityRole(role?: string): boolean {
	return role !== "Contributor" && role !== "Author";
}

/**
 * Normalizes a tag list for `PUT /posts/{id}/`: Ghost's `clean.postsTag` keeps
 * `{id, name, slug}` or `{name}` for newly created tags.
 */
export function serializeTagsForSave(
	tags: TagSummary[],
): Array<{id?: string; name: string; slug?: string}> {
	const seen = new Set<string>();
	const out: Array<{id?: string; name: string; slug?: string}> = [];
	for (const tag of tags) {
		const trimmed = tag.name.trim();
		if (!trimmed) {
			continue;
		}
		const key = (tag.slug ?? trimmed).toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		out.push(
			tag.id
				? {id: tag.id, name: trimmed, slug: tag.slug}
				: {name: trimmed},
		);
	}
	return out;
}

/**
 * Normalizes a tier list for `PUT /posts/{id}/`: Ghost only needs tier ids,
 * and duplicates (or blank ids) are dropped.
 */
export function serializeTiersForSave(
	tiers: Array<{id?: string}>,
): Array<{id: string}> {
	const seen = new Set<string>();
	const out: Array<{id: string}> = [];
	for (const tier of tiers) {
		const id = tier.id?.trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		out.push({id});
	}
	return out;
}

export type PostFilterCriteria = {
	query?: string;
	tagSlug?: string;
	featuredOnly?: boolean;
};

/**
 * Client-side search & filter over the loaded post list.
 */
export function filterPosts(
	posts: Post[],
	{query = "", tagSlug = "", featuredOnly = false}: PostFilterCriteria,
): Post[] {
	const normalizedQuery = query.trim().toLowerCase();
	const normalizedTag = tagSlug.trim().toLowerCase();

	return posts.filter(post => {
		if (featuredOnly && !post.featured) {
			return false;
		}
		if (normalizedTag) {
			const hasTag = post.tags?.some(
				t =>
					(t.slug ?? "").toLowerCase() === normalizedTag ||
					t.name.toLowerCase() === normalizedTag,
			);
			if (!hasTag) {
				return false;
			}
		}
		if (!normalizedQuery) {
			return true;
		}
		const titleMatch = (post.title ?? "untitled")
			.toLowerCase()
			.includes(normalizedQuery);
		const slugMatch = (post.slug ?? "").toLowerCase().includes(normalizedQuery);
		const excerptMatch = (post.custom_excerpt ?? "")
			.toLowerCase()
			.includes(normalizedQuery);
		const tagMatch = post.tags?.some(t =>
			t.name.toLowerCase().includes(normalizedQuery),
		);
		const authorMatch = post.authors?.some(a =>
			a.name.toLowerCase().includes(normalizedQuery),
		);
		return Boolean(
			titleMatch || slugMatch || excerptMatch || tagMatch || authorMatch,
		);
	});
}

export {GhostError};

import {fetch} from "@tauri-apps/plugin-http";
import {invoke} from "@tauri-apps/api/core";

export type KeyKind = "staff" | "integration";

/**
 * Result of a password sign-in. Ghost either returns a stored Staff Access
 * Token straight away (`Success`) or emails a verification code and asks for
 * it (`Needs2FA`). Passwords are never part of this value.
 */
export type LoginResult =
	| {status: "Success"; key_kind: string; staff_id: string}
	| {
			status: "Needs2FA";
			pending_id: string;
			email: string;
			message: string;
	  };

export type Site = {
	/** Admin base: scheme + host + optional subdirectory, no trailing slash. */
	base: string;
	/** Public site URL from /site/, ends with '/'. */
	siteUrl: string;
	title: string;
	/** Ghost content version, e.g. "6.68". */
	version: string;
	keyKind: KeyKind;
	/** Role name when the key belongs to a user. */
	role?: string;
	/** Server clock minus local clock, in seconds. */
	clockOffset: number;
};

export type TagSummary = {
	id?: string;
	name: string;
	slug?: string;
};

export type AuthorSummary = {
	id: string;
	name: string;
	slug: string;
	email?: string;
};

export type PostStatusFilter = "draft" | "published" | "scheduled" | "all";

export type PostVisibility = "public" | "members" | "paid" | "tiers";

export type Post = {
	id: string;
	uuid: string;
	title: string | null;
	slug?: string;
	status: string;
	visibility?: PostVisibility;
	featured?: boolean;
	custom_excerpt?: string | null;
	feature_image?: string | null;
	updated_at: string;
	published_at?: string | null;
	tags?: TagSummary[];
	authors?: AuthorSummary[];
};

export type TierSummary = {
	id: string;
	name: string;
	slug: string;
	type: "free" | "paid";
	active: boolean;
};

export type NewsletterSummary = {
	id: string;
	name: string;
	slug: string;
	status: "active" | "archived";
	visibility?: string;
	count?: {active_members?: number};
};

export type PostRevision = {
	id: string;
	lexical: string;
	title: string;
	custom_excerpt?: string | null;
	feature_image?: string | null;
	feature_image_alt?: string | null;
	feature_image_caption?: string | null;
	created_at: string;
	created_at_ts?: number;
	post_status?: string;
	reason?: string;
	author?: {id: string; name: string; slug?: string} | null;
};

export type EmailSegment = "all" | "status:free" | "status:-free";

export type PostDetail = Post & {
	lexical: string;
	feature_image_alt?: string | null;
	feature_image_caption?: string | null;
	tiers?: TierSummary[];
	email_only?: boolean;
	email_segment?: string;
	newsletter?: {id: string; name: string; slug: string} | null;
	post_revisions?: PostRevision[];
};

export class GhostError extends Error {
	constructor(
		public status: number,
		public code: string | undefined,
		message: string,
	) {
		super(message);
		this.name = "GhostError";
	}

	static async from(res: Response) {
		let code: string | undefined;
		let msg = `HTTP ${res.status}`;
		try {
			const j = await res.json();
			code = j.errors?.[0]?.code;
			const context = j.errors?.[0]?.context;
			const baseMsg = j.errors?.[0]?.message ?? msg;
			msg = context ? `${baseMsg} (${context})` : baseMsg;
		} catch {
			/* not JSON; keep the default message */
		}
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location");
			msg = location
				? `Site redirected to ${location}. Reconnect using that address.`
				: "Site redirected. Reconnect using the address it redirected to.";
		}
		return new GhostError(res.status, code, msg);
	}
}

const ADMIN_HEADERS = {
	"Accept-Version": "v6.0",
} as const;

/**
 * Authenticated Admin API call.
 *
 * Safety rules (plan §4): never send `html` or `?source=html` (rule 4.3), never
 * send `newsletter` (rule 4.2), and never follow redirects (rule 4.5).
 */
export async function api<T = any>(
	site: Site,
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const jwt = await invoke<string>("get_jwt", {
		base: site.base,
		clockOffsetSecs: site.clockOffset,
	});

	const headers = new Headers(init.headers);
	headers.set("Authorization", `Ghost ${jwt}`);
	headers.set("Accept-Version", ADMIN_HEADERS["Accept-Version"]);
	if (init.body && !(init.body instanceof FormData)) {
		headers.set("Content-Type", "application/json");
	}

	const res = await fetch(`${site.base}/ghost/api/admin${path}`, {
		...init,
		headers,
		maxRedirections: 0,
	});

	if (!res.ok) {
		throw await GhostError.from(res);
	}
	return (res.status === 204 ? null : await res.json()) as T;
}

export function normalizeBase(input: string): string {
	let s = input.trim();
	if (!/^https?:\/\//i.test(s)) {
		s = `https://${s}`;
	}
	// Accept "https://site.com/ghost" or ".../ghost/#/editor" and store the admin base.
	return s
		.replace(/\/ghost(\/.*)?$/i, "")
		.replace(/\/+$/, "");
}

type SiteProbe = {
	base: string;
	siteUrl: string;
	title: string;
	version: string;
	clockOffset: number;
};

/**
 * Reads a site's public Admin API metadata. Redirects are followed here on
 * purpose: this probe discovers the real admin address so later calls can use
 * `maxRedirections: 0`.
 */
async function probeSite(input: string): Promise<SiteProbe> {
	const probe = await fetch(
		`${normalizeBase(input)}/ghost/api/admin/site/`,
		{
			headers: {"Accept-Version": ADMIN_HEADERS["Accept-Version"]},
		},
	);
	if (!probe.ok) {
		throw new Error(`Couldn't find a Ghost site there (HTTP ${probe.status})`);
	}

	const {site} = await probe.json();

	// Rule (plan §13): measure clock skew from the server's Date header so a
	// token minted locally is not rejected by a server on a different clock.
	const dateHeader = probe.headers.get("date");
	const serverNow = dateHeader ? Date.parse(dateHeader) / 1000 : NaN;
	const clockOffset = Number.isFinite(serverNow)
		? Math.round(serverNow - Date.now() / 1000)
		: 0;

	return {
		base: probe.url.replace(/\/ghost\/api\/admin\/site\/?$/, ""),
		siteUrl: site.url,
		title: site.title,
		version: site.version,
		clockOffset,
	};
}

export async function connect(input: string, key: string): Promise<Site> {
	const probe = await probeSite(input);

	await invoke("save_key", {base: probe.base, key});

	const result: Site = {
		base: probe.base,
		siteUrl: probe.siteUrl,
		title: probe.title,
		version: probe.version,
		keyKind: "staff",
		clockOffset: probe.clockOffset,
	};

	try {
		const me = await api<{users: {name: string; roles?: {name: string}[]}[]}>(
			result,
			"/users/me/?include=roles",
		);
		result.role = me.users?.[0]?.roles?.[0]?.name;
	} catch (e) {
		// 404 means the key is valid but not tied to a user, i.e. an integration
		// key. Anything else is a bad key: clean up and surface it.
		if (e instanceof GhostError && e.status === 404) {
			result.keyKind = "integration";
		} else {
			await invoke("delete_key", {base: probe.base});
			throw e;
		}
	}

	return result;
}

export type FetchSiteInput = {
	/** Optional title override; otherwise the site's own title is used. */
	title?: string;
	/** Public site address (or admin address); normalized before probing. */
	url: string;
	/** Optional role override; otherwise resolved from /users/me/. */
	role?: string;
	keyKind?: KeyKind;
};

/**
 * Resolves a connected site after a password sign-in. Unlike {@link connect},
 * this never writes a key: the Rust login command has already stored the Staff
 * Access Token in the Keychain.
 */
export async function fetchSite(input: FetchSiteInput): Promise<Site> {
	const probe = await probeSite(input.url);
	const result: Site = {
		base: probe.base,
		siteUrl: probe.siteUrl,
		title: input.title?.trim() || probe.title,
		version: probe.version,
		keyKind: input.keyKind ?? "staff",
		clockOffset: probe.clockOffset,
	};

	const role = input.role?.trim();
	if (role) {
		result.role = role;
		return result;
	}

	try {
		const me = await api<{users: {name: string; roles?: {name: string}[]}[]}>(
			result,
			"/users/me/?include=roles",
		);
		result.role = me.users?.[0]?.roles?.[0]?.name;
	} catch {
		// Role is optional metadata; a site can still be used without it.
	}

	return result;
}

/**
 * Signs in with a Ghost account password. The password is passed straight to
 * the Rust command and is never stored or logged in the webview.
 */
export async function loginWithPassword(
	url: string,
	email: string,
	password: string,
): Promise<LoginResult> {
	return invoke<LoginResult>("login_with_password", {url, email, password});
}

/** Completes a pending 2FA challenge with the code Ghost emailed. */
export async function verify2faCode(
	pendingId: string,
	code: string,
): Promise<LoginResult> {
	return invoke<LoginResult>("verify_2fa_code", {pendingId, code});
}

/** Asks Ghost to email a fresh 2FA code for a pending sign-in. */
export async function resend2faCode(pendingId: string): Promise<void> {
	await invoke("resend_2fa_code", {pendingId});
}

/** Rotates the stored Staff Access Token and returns its new id. */
export async function rotateStaffToken(
	base: string,
	clockOffset?: number,
): Promise<string> {
	return invoke<string>("rotate_staff_token", {base, clockOffset});
}

export async function listPosts(
	site: Site,
	status: PostStatusFilter,
): Promise<Post[]> {
	const statusFilter =
		status === "all"
			? "status:[draft,published,scheduled,sent]"
			: `status:${status}`;
	const fields =
		"id,uuid,title,slug,status,featured,custom_excerpt,feature_image,updated_at,published_at";
	const res = await api<{posts: Post[]}>(
		site,
		`/posts/?filter=${statusFilter}&order=updated_at%20desc&limit=100&include=tags,authors&fields=${fields}`,
	);
	return res.posts ?? [];
}

export async function fetchPost(site: Site, id: string): Promise<PostDetail> {
	const res = await api<{posts: PostDetail[]}>(
		site,
		`/posts/${id}/?formats=lexical&include=tags,authors,tiers,newsletter,post_revisions,post_revisions.author`,
	);
	return res.posts[0];
}

export type CreatePostInput = {
	title: string;
	lexical: string;
	custom_excerpt?: string | null;
};

/**
 * Creates a Ghost draft from local content.
 *
 * Safety rules 4.2 and 4.3: only `title`, `lexical`, and `custom_excerpt` are
 * sent. No `newsletter`, `email_segment`, `html`, or `?source=html` is ever
 * included, so creating a draft can never email subscribers.
 */
export async function createPost(
	site: Site,
	input: CreatePostInput,
): Promise<PostDetail> {
	const res = await api<{posts: PostDetail[]}>(
		site,
		"/posts/?formats=lexical",
		{
			method: "POST",
			body: JSON.stringify({
				posts: [
					{
						title: input.title,
						lexical: input.lexical,
						custom_excerpt: input.custom_excerpt ?? null,
						status: "draft",
					},
				],
			}),
		},
	);
	return res.posts[0];
}

export async function listSiteTags(site: Site): Promise<TagSummary[]> {
	try {
		const res = await api<{tags: TagSummary[]}>(
			site,
			"/tags/?limit=all&fields=id,name,slug",
		);
		return res.tags ?? [];
	} catch {
		return [];
	}
}

export async function listSiteAuthors(site: Site): Promise<AuthorSummary[]> {
	try {
		const res = await api<{users: AuthorSummary[]}>(
			site,
			"/users/?limit=all&fields=id,name,slug,email",
		);
		return res.users ?? [];
	} catch {
		return [];
	}
}

export async function listSiteTiers(site: Site): Promise<TierSummary[]> {
	try {
		const res = await api<{tiers: TierSummary[]}>(site, "/tiers/?limit=all");
		return (res.tiers ?? []).filter(
			t => t.type === "paid" && t.active !== false,
		);
	} catch {
		return [];
	}
}

export async function listActiveNewsletters(
	site: Site,
): Promise<NewsletterSummary[]> {
	try {
		const res = await api<{newsletters: NewsletterSummary[]}>(
			site,
			"/newsletters/?filter=status:active&include=count.active_members&limit=all",
		);
		return res.newsletters ?? [];
	} catch {
		return [];
	}
}

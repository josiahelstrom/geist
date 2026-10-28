import {fetch} from "@tauri-apps/plugin-http";
import {invoke} from "@tauri-apps/api/core";

export type KeyKind = "staff" | "integration";

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

export type PostDetail = Post & {
	lexical: string;
	feature_image_alt?: string | null;
	feature_image_caption?: string | null;
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

export async function connect(input: string, key: string): Promise<Site> {
	// Redirects are followed here on purpose: this probe discovers the real
	// admin address so later calls can use maxRedirections: 0.
	const probe = await fetch(
		`${normalizeBase(input)}/ghost/api/admin/site/`,
		{
			headers: {"Accept-Version": ADMIN_HEADERS["Accept-Version"]},
		},
	);
	if (!probe.ok) {
		throw new Error(`Couldn't find a Ghost site there (HTTP ${probe.status})`);
	}

	const base = probe.url.replace(/\/ghost\/api\/admin\/site\/?$/, "");
	const {site} = await probe.json();

	// Rule (plan §13): measure clock skew from the server's Date header so a
	// token minted locally is not rejected by a server on a different clock.
	const dateHeader = probe.headers.get("date");
	const serverNow = dateHeader ? Date.parse(dateHeader) / 1000 : NaN;
	const clockOffset = Number.isFinite(serverNow)
		? Math.round(serverNow - Date.now() / 1000)
		: 0;

	await invoke("save_key", {base, key});

	const result: Site = {
		base,
		siteUrl: site.url,
		title: site.title,
		version: site.version,
		keyKind: "staff",
		clockOffset,
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
			await invoke("delete_key", {base});
			throw e;
		}
	}

	return result;
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
		`/posts/${id}/?formats=lexical&include=tags,authors`,
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

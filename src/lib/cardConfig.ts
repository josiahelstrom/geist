import {api, type Site} from "./api";

/**
 * Everything Koenig's `cardConfig` needs from the Ghost Admin API.
 *
 * Shapes were read out of the 1.11.1 bundle, not guessed:
 * - `searchLinks(term?)`  -> `{label, items: {title, url, metaText?}[]}[]`
 * - `fetchAutocompleteLinks()` -> `{label, value}[]`
 * - `snippets`            -> `{id, name, value}[]`, `value` is a JSON *string*
 * - `createSnippet({name, value})`, `deleteSnippet(snippet)`
 * - `fetchLabels()`       -> `string[]` (label names)
 *
 * Every loader degrades to an empty/disabled result rather than throwing: a
 * key that cannot read settings or snippets must still be able to edit.
 */

export type SiteSettings = {
	/** False when /settings/ could not be read (e.g. a restricted key). */
	loaded: boolean;
	membersEnabled: boolean;
	stripeEnabled: boolean;
	siteDescription: string;
};

export const DEFAULT_SETTINGS: SiteSettings = {
	loaded: false,
	membersEnabled: false,
	stripeEnabled: false,
	siteDescription: "",
};

type RawSetting = {key: string; value: unknown};

export function parseSettings(list: RawSetting[]): SiteSettings {
	const get = (key: string) => list.find(s => s.key === key)?.value;
	const access = get("members_signup_access");
	const membersEnabled =
		typeof access === "string"
			? access !== "none"
			: get("members_enabled") === true;
	// `paid_members_enabled` is a computed setting (Ghost's
	// settings-service) and is authoritative; the connect account id is only a
	// fallback for a server that does not expose it.
	const paid = get("paid_members_enabled");
	const stripeEnabled =
		typeof paid === "boolean"
			? paid
			: Boolean(get("stripe_connect_account_id"));
	const description = get("description");
	return {
		loaded: true,
		membersEnabled,
		stripeEnabled: membersEnabled && stripeEnabled,
		siteDescription: typeof description === "string" ? description : "",
	};
}

export async function loadSiteSettings(site: Site): Promise<SiteSettings> {
	try {
		const res = await api<{settings: RawSetting[]}>(site, "/settings/");
		return parseSettings(res.settings ?? []);
	} catch {
		return DEFAULT_SETTINGS;
	}
}

// ---------------------------------------------------------------- snippets

export type Snippet = {
	id: string;
	name: string;
	/** Serialised Lexical nodes, as a string. This is what Koenig inserts. */
	value: string;
	updatedAt?: string;
};

type RawSnippet = {
	id: string;
	name: string;
	lexical?: unknown;
	updated_at?: string;
};

function snippetValue(lexical: unknown): string | null {
	if (typeof lexical === "string") {
		return lexical.trim() ? lexical : null;
	}
	if (lexical && typeof lexical === "object") {
		return JSON.stringify(lexical);
	}
	return null;
}

export async function listSnippets(site: Site): Promise<Snippet[]> {
	try {
		// Ghost returns only `mobiledoc` unless `formats` asks for lexical.
		const res = await api<{snippets: RawSnippet[]}>(
			site,
			"/snippets/?limit=all&formats=lexical",
		);
		const out: Snippet[] = [];
		for (const s of res.snippets ?? []) {
			// Snippets saved by the old mobiledoc editor have no lexical body
			// and cannot be inserted into a Lexical document.
			const value = snippetValue(s.lexical);
			if (value) {
				out.push({
					id: s.id,
					name: s.name,
					value,
					updatedAt: s.updated_at,
				});
			}
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Ghost's snippets.add / snippets.edit schemas require `mobiledoc` (a JSON
 * string) next to `name`, forbid any other field (so no `updated_at`), and
 * treat `lexical` as optional. Lexical-only snippets therefore carry an empty
 * mobiledoc document.
 */
export const EMPTY_MOBILEDOC = JSON.stringify({
	version: "0.3.1",
	atoms: [],
	cards: [],
	markups: [],
	sections: [[1, "p", [[0, [], 0, ""]]]],
});

/** Creates a snippet, or updates the one with the same name (Koenig's "update"). */
export async function saveSnippet(
	site: Site,
	existing: Snippet[],
	input: {name: string; value: string},
): Promise<void> {
	const match = existing.find(s => s.name === input.name);
	if (match) {
		await api(site, `/snippets/${match.id}/`, {
			method: "PUT",
			body: JSON.stringify({
				snippets: [
					{
						name: input.name,
						mobiledoc: EMPTY_MOBILEDOC,
						lexical: input.value,
					},
				],
			}),
		});
		return;
	}
	await api(site, "/snippets/", {
		method: "POST",
		body: JSON.stringify({
			snippets: [
				{name: input.name, mobiledoc: EMPTY_MOBILEDOC, lexical: input.value},
			],
		}),
	});
}

export async function removeSnippet(site: Site, snippet: Snippet): Promise<void> {
	await api(site, `/snippets/${snippet.id}/`, {method: "DELETE"});
}

// ------------------------------------------------------------------ labels

export async function fetchLabels(site: Site): Promise<string[]> {
	try {
		const res = await api<{labels: {name: string}[]}>(
			site,
			"/labels/?limit=all&fields=name",
		);
		return (res.labels ?? []).map(l => l.name);
	} catch {
		return [];
	}
}

// ------------------------------------------------------------------- links

export type LinkItem = {title: string; url: string; metaText?: string};
export type LinkGroup = {label: string; items: LinkItem[]};

/** NQL string literal: single-quoted, with `\` and `'` escaped. */
export function nqlString(term: string): string {
	return `'${term.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

type LinkRecord = {
	title?: string;
	name?: string;
	url?: string;
	published_at?: string | null;
};

async function queryLinks(
	site: Site,
	resource: "posts" | "pages" | "tags",
	term: string,
	limit: number,
): Promise<LinkRecord[]> {
	const isTag = resource === "tags";
	const parts: string[] = [];
	if (!isTag) {
		parts.push("status:published");
	}
	if (term) {
		parts.push(`${isTag ? "name" : "title"}:~${nqlString(term)}`);
	}
	const filter = parts.length
		? `&filter=${encodeURIComponent(parts.join("+"))}`
		: "";
	const fields = isTag ? "name,url" : "title,url,published_at";
	const order = isTag ? "" : "&order=published_at%20desc";
	try {
		const res = await api<Record<string, LinkRecord[]>>(
			site,
			`/${resource}/?limit=${limit}&fields=${fields}${order}${filter}`,
		);
		return res[resource] ?? [];
	} catch {
		return [];
	}
}

function toItems(records: LinkRecord[], withDate: boolean): LinkItem[] {
	const items: LinkItem[] = [];
	for (const r of records) {
		const title = r.title ?? r.name;
		if (!title || !r.url) {
			continue;
		}
		const item: LinkItem = {title, url: r.url};
		if (withDate && r.published_at) {
			item.metaText = `Published ${new Date(r.published_at).toLocaleDateString()}`;
		}
		items.push(item);
	}
	return items;
}

/**
 * Backs the link dropdown in the bookmark card and the link toolbar. Called
 * with no term for the default suggestions.
 */
export async function searchLinks(
	site: Site,
	term?: string,
): Promise<LinkGroup[]> {
	const q = term?.trim() ?? "";
	const groups: LinkGroup[] = [];

	if (!q) {
		groups.push({
			label: "Site",
			items: [{title: "Homepage", url: site.siteUrl}],
		});
		const latest = toItems(await queryLinks(site, "posts", "", 5), true);
		if (latest.length) {
			groups.push({label: "Latest posts", items: latest});
		}
		return groups;
	}

	const [posts, pages, tags] = await Promise.all([
		queryLinks(site, "posts", q, 10),
		queryLinks(site, "pages", q, 5),
		queryLinks(site, "tags", q, 5),
	]);
	for (const [label, records, withDate] of [
		["Posts", posts, true],
		["Pages", pages, true],
		["Tags", tags, false],
	] as const) {
		const items = toItems(records, withDate);
		if (items.length) {
			groups.push({label, items});
		}
	}
	return groups;
}

/** Backs the URL picker in the button and call-to-action cards. */
export async function fetchAutocompleteLinks(
	site: Site,
): Promise<{label: string; value: string}[]> {
	const [posts, pages, tags] = await Promise.all([
		queryLinks(site, "posts", "", 50),
		queryLinks(site, "pages", "", 50),
		queryLinks(site, "tags", "", 50),
	]);
	const out = [{label: "Homepage", value: site.siteUrl}];
	for (const [prefix, records] of [
		["Post", posts],
		["Page", pages],
		["Tag", tags],
	] as const) {
		for (const item of toItems(records, false)) {
			out.push({label: `${prefix}: ${item.title}`, value: item.url});
		}
	}
	return out;
}

// -------------------------------------------------------------- assembling

export type CardConfigState = {
	settings: SiteSettings;
	snippets: Snippet[];
	/** Called after a snippet is created, updated or deleted. */
	onSnippetsChanged: () => void;
};

/**
 * Koenig `cardConfig` minus `fetchEmbed` (the caller owns that).
 *
 * Snippets and labels are staff-only, so integration keys never get the
 * controls that would fail. Visibility is left at Koenig's default when
 * settings could not be read, rather than guessing "none".
 */
export function buildCardConfig(site: Site, state: CardConfigState) {
	const {settings, snippets, onSnippetsChanged} = state;
	const staff = site.keyKind === "staff";

	return {
		siteUrl: site.siteUrl,
		siteTitle: site.title,
		siteDescription: settings.siteDescription,
		membersEnabled: settings.membersEnabled,
		stripeEnabled: settings.stripeEnabled,
		...(settings.loaded
			? {
					visibilitySettings: settings.membersEnabled
						? "web and email"
						: "none",
				}
			: {}),
		searchLinks: (term?: string) => searchLinks(site, term),
		fetchAutocompleteLinks: () => fetchAutocompleteLinks(site),
		...(staff
			? {
					snippets,
					createSnippet: async (input: {name: string; value: string}) => {
						await saveSnippet(site, snippets, input);
						onSnippetsChanged();
					},
					deleteSnippet: async (snippet: Snippet) => {
						await removeSnippet(site, snippet);
						onSnippetsChanged();
					},
				}
			: {}),
		...(staff && settings.membersEnabled
			? {renderLabels: true, fetchLabels: () => fetchLabels(site)}
			: {}),
	};
}

import type {Site} from "../api";

const VIS_FULL = "VIS_FULL" as const;
const VIS_MEMBERS_ONLY = "VIS_MEMBERS_ONLY" as const;
type CardVisibility = typeof VIS_FULL | typeof VIS_MEMBERS_ONLY;

export type LabCardMenuContext = {
	siteUrl?: string;
	siteTitle?: string;
	siteDescription?: string;
	membersEnabled?: boolean;
	stripeEnabled?: boolean;
	unsplashEnabled?: boolean;
	klipyEnabled?: boolean;
	transistorEnabled?: boolean;
	emailCtaEnabled?: boolean;
	headerV1Enabled?: boolean;
	postType?: "post" | "page";
};

export type LabCardMenuEntry = {
	id: string;
	cardType: string;
	label: string;
	desc: string;
	shortcut: string;
	matches: string[];
	section: "Primary" | "Embeds";
	priority: number;
	visibility: CardVisibility;
	insertParams?: (ctx: LabCardMenuContext) => Record<string, unknown>;
	isHidden?: (ctx: LabCardMenuContext) => boolean;
	queryParams?: string[];
	triggerFileDialog?: boolean;
};

export type CardMenuGroup = {
	section: string;
	items: LabCardMenuEntry[];
};

export const DEFAULT_CARD_PAYLOADS: Record<string, Record<string, unknown>> = {
	image: {
		type: "image",
		version: 1,
		src: "",
		width: null,
		height: null,
		title: "",
		alt: "",
		caption: "",
		cardWidth: "regular",
		href: "",
	},
	codeblock: {
		type: "codeblock",
		version: 1,
		code: "",
		language: "",
		caption: "",
	},
	markdown: {
		type: "markdown",
		version: 1,
		markdown: "",
	},
	video: {
		type: "video",
		version: 1,
		src: "",
		caption: "",
		fileName: "",
		mimeType: "",
		width: null,
		height: null,
		duration: 0,
		thumbnailSrc: "",
		customThumbnailSrc: "",
		thumbnailWidth: null,
		thumbnailHeight: null,
		cardWidth: "regular",
		loop: false,
	},
	audio: {
		type: "audio",
		version: 1,
		duration: 0,
		mimeType: "",
		src: "",
		title: "",
		thumbnailSrc: "",
	},
	callout: {
		type: "callout",
		version: 1,
		calloutText: "",
		calloutEmoji: "💡",
		backgroundColor: "blue",
	},
	"call-to-action": {
		type: "call-to-action",
		version: 1,
		layout: "minimal",
		alignment: "left",
		textValue: "",
		showButton: true,
		showDividers: true,
		buttonText: "Learn more",
		buttonUrl: "",
		buttonColor: "#000000",
		buttonTextColor: "#ffffff",
		hasSponsorLabel: true,
		sponsorLabel:
			'<p><span style="white-space: pre-wrap;">SPONSORED</span></p>',
		backgroundColor: "grey",
		linkColor: "text",
		imageUrl: "",
		imageWidth: null,
		imageHeight: null,
		visibility: {
			web: {nonMember: true, memberSegment: "status:free,status:-free"},
			email: {memberSegment: "status:free,status:-free"},
		},
	},
	horizontalrule: {
		type: "horizontalrule",
		version: 1,
	},
	html: {
		type: "html",
		version: 1,
		html: "",
		visibility: {
			web: {nonMember: true, memberSegment: "status:free,status:-free"},
			email: {memberSegment: "status:free,status:-free"},
		},
	},
	toggle: {
		type: "toggle",
		version: 1,
		heading: "",
		content: "",
	},
	button: {
		type: "button",
		version: 1,
		buttonText: "",
		alignment: "center",
		buttonUrl: "",
	},
	bookmark: {
		type: "bookmark",
		version: 1,
		url: "",
		metadata: {
			icon: "",
			title: "",
			description: "",
			author: "",
			publisher: "",
			thumbnail: "",
		},
		caption: "",
	},
	file: {
		type: "file",
		version: 1,
		src: "",
		fileTitle: "",
		fileCaption: "",
		fileName: "",
		fileSize: 0,
	},
	header: {
		type: "header",
		version: 2,
		size: "small",
		style: "dark",
		buttonEnabled: false,
		buttonUrl: "",
		buttonText: "",
		header: "",
		subheader: "",
		backgroundImageSrc: "",
		accentColor: "#FF1A75",
		alignment: "center",
		backgroundColor: "#000000",
		backgroundImageWidth: null,
		backgroundImageHeight: null,
		backgroundSize: "cover",
		textColor: "#FFFFFF",
		buttonColor: "#ffffff",
		buttonTextColor: "#000000",
		layout: "full",
		swapped: false,
	},
	paywall: {
		type: "paywall",
		version: 1,
	},
	product: {
		type: "product",
		version: 1,
		productImageSrc: "",
		productImageWidth: null,
		productImageHeight: null,
		productTitle: "",
		productDescription: "",
		productRatingEnabled: false,
		productStarRating: 5,
		productButtonEnabled: false,
		productButton: "",
		productUrl: "",
	},
	embed: {
		type: "embed",
		version: 1,
		url: "",
		embedType: "",
		html: "",
		metadata: {},
		caption: "",
	},
	email: {
		type: "email",
		version: 1,
		html: "",
	},
	gallery: {
		type: "gallery",
		version: 1,
		images: [],
		caption: "",
	},
	"email-cta": {
		type: "email-cta",
		version: 1,
		alignment: "left",
		buttonText: "",
		buttonUrl: "",
		html: "",
		segment: "status:free",
		showButton: false,
		showDividers: true,
	},
	signup: {
		type: "signup",
		version: 1,
		alignment: "left",
		backgroundColor: "#F0F0F0",
		backgroundImageSrc: "",
		backgroundSize: "cover",
		textColor: "#000000",
		buttonColor: "accent",
		buttonTextColor: "#FFFFFF",
		buttonText: "Subscribe",
		disclaimer: "No spam. Unsubscribe anytime.",
		header: "",
		layout: "wide",
		subheader: "",
		successMessage:
			"Email sent! Check your inbox to complete your signup.",
		swapped: false,
		labels: [],
	},
	transistor: {
		type: "transistor",
		version: 1,
		accentColor: "",
		backgroundColor: "",
		visibility: {
			web: {nonMember: false, memberSegment: "status:free,status:-free"},
			email: {memberSegment: "status:free,status:-free"},
		},
	},
};

export const LAB_CARD_CATALOG: LabCardMenuEntry[] = [
	// Primary cards
	{
		id: "image",
		cardType: "image",
		label: "Image",
		desc: "Upload, or embed with /image [url]",
		shortcut: "/image",
		matches: ["image", "img", "photo", "picture"],
		section: "Primary",
		priority: 1,
		visibility: VIS_FULL,
		queryParams: ["src"],
		triggerFileDialog: true,
	},
	{
		id: "horizontalrule",
		cardType: "horizontalrule",
		label: "Divider",
		desc: "Insert a dividing line",
		shortcut: "/hr",
		matches: ["divider", "horizontal-rule", "hr", "line", "separator"],
		section: "Primary",
		priority: 2,
		visibility: VIS_FULL,
	},
	{
		id: "button",
		cardType: "button",
		label: "Button",
		desc: "Add a button to your post",
		shortcut: "/button",
		matches: ["button", "btn", "link-button"],
		section: "Primary",
		priority: 3,
		visibility: VIS_FULL,
		queryParams: ["buttonUrl"],
	},
	{
		id: "bookmark",
		cardType: "bookmark",
		label: "Bookmark",
		desc: "Embed a link as a visual bookmark",
		shortcut: "/bookmark [url]",
		matches: ["bookmark", "bm", "link"],
		section: "Primary",
		priority: 4,
		visibility: VIS_FULL,
		queryParams: ["url"],
	},
	{
		id: "gallery",
		cardType: "gallery",
		label: "Gallery",
		desc: "Create an image gallery",
		shortcut: "/gallery",
		matches: ["gallery", "photos", "grid"],
		section: "Primary",
		priority: 5,
		visibility: VIS_FULL,
		triggerFileDialog: true,
	},
	{
		id: "paywall",
		cardType: "paywall",
		label: "Public preview",
		desc: "Attract signups with a public intro",
		shortcut: "/paywall",
		matches: [
			"public preview",
			"preview",
			"public intro",
			"members only",
			"paywall",
			"pay",
		],
		section: "Primary",
		priority: 6,
		visibility: VIS_MEMBERS_ONLY,
	},
	{
		id: "call-to-action",
		cardType: "call-to-action",
		label: "Call to action",
		desc: "Add a call to action to your post",
		shortcut: "/cta",
		matches: ["cta", "call-to-action", "ad", "sponsored"],
		section: "Primary",
		priority: 7,
		visibility: VIS_FULL,
	},
	{
		id: "email",
		cardType: "email",
		label: "Email content",
		desc: "Only visible when delivered by email",
		shortcut: "/email",
		matches: ["email content", "only email", "email"],
		section: "Primary",
		priority: 8,
		visibility: VIS_MEMBERS_ONLY,
		isHidden: ctx => ctx.postType === "page",
	},
	{
		id: "email-cta",
		cardType: "email-cta",
		label: "Email call to action",
		desc: "Target free or paid members with a CTA",
		shortcut: "/email-cta",
		matches: ["email-cta", "email cta"],
		section: "Primary",
		priority: 8.5,
		visibility: VIS_MEMBERS_ONLY,
		isHidden: ctx => ctx.emailCtaEnabled === false || ctx.postType === "page",
	},
	{
		id: "callout",
		cardType: "callout",
		label: "Callout",
		desc: "Info boxes that stand out",
		shortcut: "/callout",
		matches: ["callout", "cal", "box", "alert", "info", "notice"],
		section: "Primary",
		priority: 9,
		visibility: VIS_FULL,
		queryParams: ["calloutText"],
	},
	{
		id: "signup",
		cardType: "signup",
		label: "Signup",
		desc: "Convert visitors into members",
		shortcut: "/signup",
		matches: ["signup", "subscribe", "sig", "newsletter"],
		section: "Primary",
		priority: 10,
		visibility: VIS_FULL,
		isHidden: ctx => ctx.membersEnabled === false,
		insertParams: ctx => ({
			header: ctx.siteTitle ? `Sign up for ${ctx.siteTitle}` : "",
			subheader: ctx.siteDescription || "",
			disclaimer: "No spam. Unsubscribe anytime.",
		}),
	},
	{
		id: "header",
		cardType: "header",
		label: "Header",
		desc: "Add a header",
		shortcut: "/header",
		matches: ["header", "heading", "hdr", "hero"],
		section: "Primary",
		priority: 11,
		visibility: VIS_FULL,
		insertParams: () => ({version: 2}),
	},
	{
		id: "header-v1",
		cardType: "header",
		label: "Header1",
		desc: "Add a legacy header",
		shortcut: "/header",
		matches: ["v1_header", "v1_heading"],
		section: "Primary",
		priority: 11.5,
		visibility: VIS_FULL,
		isHidden: ctx => !ctx.headerV1Enabled,
		insertParams: () => ({version: 1}),
	},
	{
		id: "toggle",
		cardType: "toggle",
		label: "Toggle",
		desc: "Add collapsible content",
		shortcut: "/toggle",
		matches: ["toggle", "collapse", "accordion", "tog", "spoiler"],
		section: "Primary",
		priority: 12,
		visibility: VIS_FULL,
	},
	{
		id: "video",
		cardType: "video",
		label: "Video",
		desc: "Upload and play a video file",
		shortcut: "/video",
		matches: ["video", "vid", "mp4", "movie"],
		section: "Primary",
		priority: 13,
		visibility: VIS_FULL,
		queryParams: ["src"],
		triggerFileDialog: true,
	},
	{
		id: "audio",
		cardType: "audio",
		label: "Audio",
		desc: "Upload and play an audio file",
		shortcut: "/audio",
		matches: ["audio", "sound", "mp3", "podcast"],
		section: "Primary",
		priority: 14,
		visibility: VIS_FULL,
		queryParams: ["src"],
		triggerFileDialog: true,
	},
	{
		id: "file",
		cardType: "file",
		label: "File",
		desc: "Upload a downloadable file",
		shortcut: "/file",
		matches: ["file", "download", "pdf", "attachment"],
		section: "Primary",
		priority: 15,
		visibility: VIS_FULL,
		triggerFileDialog: true,
	},
	{
		id: "product",
		cardType: "product",
		label: "Product",
		desc: "Add a product recommendation",
		shortcut: "/product",
		matches: ["product", "prod", "recommendation", "review", "shop"],
		section: "Primary",
		priority: 16,
		visibility: VIS_FULL,
	},
	{
		id: "html",
		cardType: "html",
		label: "HTML",
		desc: "Insert an HTML editor card",
		shortcut: "/html",
		matches: ["html", "raw", "embed-html"],
		section: "Primary",
		priority: 18,
		visibility: VIS_FULL,
		queryParams: ["html"],
	},
	{
		id: "markdown",
		cardType: "markdown",
		label: "Markdown",
		desc: "Insert a Markdown editor card",
		shortcut: "/md",
		matches: ["markdown", "md"],
		section: "Primary",
		priority: 19,
		visibility: VIS_FULL,
		queryParams: ["markdown"],
	},
	{
		id: "codeblock",
		cardType: "codeblock",
		label: "Code block",
		desc: "Insert a code block with syntax highlighting",
		shortcut: "/code",
		matches: ["code", "codeblock", "syntax", "snippet"],
		section: "Primary",
		priority: 20,
		visibility: VIS_FULL,
		queryParams: ["code"],
	},

	// Embeds
	{
		id: "youtube",
		cardType: "embed",
		label: "YouTube",
		desc: "/youtube [video url]",
		shortcut: "/youtube [url]",
		matches: ["youtube", "yt"],
		section: "Embeds",
		priority: 1,
		visibility: VIS_FULL,
		queryParams: ["url"],
		insertParams: () => ({embedType: "video"}),
	},
	{
		id: "transistor",
		cardType: "transistor",
		label: "Transistor",
		desc: "Embed a Transistor podcast player",
		shortcut: "/transistor",
		matches: ["transistor", "podcast"],
		section: "Embeds",
		priority: 2,
		visibility: VIS_MEMBERS_ONLY,
		isHidden: ctx => ctx.transistorEnabled === false,
	},
	{
		id: "twitter",
		cardType: "embed",
		label: "X (formerly Twitter)",
		desc: "/twitter [tweet url]",
		shortcut: "/twitter [url]",
		matches: ["twitter", "x", "tweet"],
		section: "Embeds",
		priority: 3,
		visibility: VIS_FULL,
		queryParams: ["url"],
	},
	{
		id: "vimeo",
		cardType: "embed",
		label: "Vimeo",
		desc: "/vimeo [video url]",
		shortcut: "/vimeo [url]",
		matches: ["vimeo"],
		section: "Embeds",
		priority: 4,
		visibility: VIS_FULL,
		queryParams: ["url"],
		insertParams: () => ({embedType: "video"}),
	},
	{
		id: "codepen",
		cardType: "embed",
		label: "CodePen",
		desc: "/codepen [pen url]",
		shortcut: "/codepen [url]",
		matches: ["codepen", "pen"],
		section: "Embeds",
		priority: 5,
		visibility: VIS_FULL,
		queryParams: ["url"],
	},
	{
		id: "spotify",
		cardType: "embed",
		label: "Spotify",
		desc: "/spotify [track or playlist url]",
		shortcut: "/spotify [url]",
		matches: ["spotify", "music", "playlist"],
		section: "Embeds",
		priority: 6,
		visibility: VIS_FULL,
		queryParams: ["url"],
	},
	{
		id: "soundcloud",
		cardType: "embed",
		label: "SoundCloud",
		desc: "/soundcloud [track or playlist url]",
		shortcut: "/soundcloud [url]",
		matches: ["soundcloud", "audio-embed"],
		section: "Embeds",
		priority: 7,
		visibility: VIS_FULL,
		queryParams: ["url"],
	},
	{
		id: "embed",
		cardType: "embed",
		label: "Other...",
		desc: "/embed [url]",
		shortcut: "/embed [url]",
		matches: ["embed", "iframe", "oembed", "custom-embed"],
		section: "Embeds",
		priority: 100,
		visibility: VIS_FULL,
		queryParams: ["url"],
	},
];

function isSubsequence(needle: string, haystack: string): boolean {
	let i = 0;
	for (const ch of haystack) {
		if (ch === needle[i]) i++;
		if (i === needle.length) return true;
	}
	return needle.length === 0;
}

/**
 * Score a menu item against a query. Lower is better.
 * - 0: exact label or exact match keyword
 * - 1: label/keyword starts with the query
 * - 2: word boundary hit
 * - 3: substring hit
 * - 4: ordered subsequence (fuzzy)
 * - Infinity: no match
 */
function scoreCardMenuEntry(
	entry: LabCardMenuEntry,
	rawQuery: string,
): number {
	const query = rawQuery.trim().toLowerCase();
	if (!query) return 0;

	const label = entry.label.toLowerCase();
	const shortcut = entry.shortcut.toLowerCase();
	const desc = entry.desc.toLowerCase();
	const candidates = [label, ...entry.matches.map(m => m.toLowerCase())];

	let best = Infinity;
	for (const candidate of candidates) {
		if (candidate === query) return 0;
		if (candidate.startsWith(query)) best = Math.min(best, 1);
		else if (candidate.split(/[\s/_-]+/).some(part => part.startsWith(query))) {
			best = Math.min(best, 2);
		} else if (candidate.includes(query)) {
			best = Math.min(best, 3);
		} else if (isSubsequence(query, candidate)) {
			best = Math.min(best, 4);
		}
	}

	if (best === Infinity) {
		if (shortcut.includes(query)) {
			best = 3;
		} else if (desc.includes(query)) {
			best = 3.5;
		} else if (isSubsequence(query, desc)) {
			best = 4.5;
		}
	}

	return best;
}

export function normalizeCardMenuContext(
	siteOrCtx?: Site | Partial<LabCardMenuContext> | null,
): LabCardMenuContext {
	if (!siteOrCtx) {
		return {
			siteTitle: "",
			siteUrl: "",
			membersEnabled: true,
			stripeEnabled: true,
			unsplashEnabled: true,
			klipyEnabled: true,
			transistorEnabled: true,
			emailCtaEnabled: true,
			headerV1Enabled: false,
			postType: "post",
		};
	}

	const ctx = siteOrCtx as Record<string, unknown>;
	const title = typeof ctx.title === "string" ? ctx.title : typeof ctx.siteTitle === "string" ? ctx.siteTitle : "";
	const siteUrl = typeof ctx.siteUrl === "string" ? ctx.siteUrl : typeof ctx.base === "string" ? ctx.base : "";
	const siteDescription = typeof ctx.siteDescription === "string" ? ctx.siteDescription : "";

	return {
		siteTitle: title,
		siteUrl,
		siteDescription,
		membersEnabled: ctx.membersEnabled !== false,
		stripeEnabled: ctx.stripeEnabled !== false,
		unsplashEnabled: ctx.unsplashEnabled !== false,
		klipyEnabled: ctx.klipyEnabled !== false,
		transistorEnabled: ctx.transistorEnabled !== false,
		emailCtaEnabled: ctx.emailCtaEnabled !== false,
		headerV1Enabled: ctx.headerV1Enabled === true,
		postType: ctx.postType === "page" ? "page" : "post",
	};
}

export function filterCardMenu(
	rawQuery: string,
	siteOrCtx?: Site | Partial<LabCardMenuContext> | null,
	catalog = LAB_CARD_CATALOG,
): CardMenuGroup[] {
	const ctx = normalizeCardMenuContext(siteOrCtx);
	// Clean leading slash if user typed /something
	const query = rawQuery.replace(/^\/+/, "").trim();

	const visible = catalog
		.filter(entry => !entry.isHidden?.(ctx))
		.map(entry => ({entry, score: scoreCardMenuEntry(entry, query)}))
		.filter(({score}) => score !== Infinity);

	const sectionMap = new Map<string, Array<{entry: LabCardMenuEntry; score: number}>>();
	for (const item of visible) {
		const section = item.entry.section ?? "Primary";
		if (!sectionMap.has(section)) {
			sectionMap.set(section, []);
		}
		sectionMap.get(section)!.push(item);
	}

	const result: CardMenuGroup[] = [];
	const sortedSections = [...sectionMap.keys()].sort((a, b) => {
		if (a === "Primary") return -1;
		if (b === "Primary") return 1;
		if (a === "Embeds") return -1;
		if (b === "Embeds") return 1;
		return a.localeCompare(b);
	});

	for (const section of sortedSections) {
		const itemsWithScores = sectionMap.get(section)!;
		itemsWithScores.sort((a, b) => {
			if (a.score !== b.score) return a.score - b.score;
			return a.entry.priority - b.entry.priority;
		});
		result.push({
			section,
			items: itemsWithScores.map(i => i.entry),
		});
	}

	return result;
}

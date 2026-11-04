/**
 * Footnote serialization and round-trip utilities for Lexical Lab and Ghost/Koenig Lexical.
 *
 * In Ghost/Koenig:
 * - Inline references: link node with url "#fn{label}" and child text node with format 64 (superscript).
 * - Footnote definitions: an HTML card at the end of root.children containing:
 *   <hr class="footnotes-sep">
 *   <section class="footnotes">
 *     <ol class="footnotes-list">
 *       <li id="fn${id}" class="footnote-item">
 *         <p>${text} <a href="#fnref${id}" class="footnote-backref">↩</a></p>
 *       </li>
 *     </ol>
 *   </section>
 */

export interface FootnoteItem {
	id: string;
	text: string;
}

const BLOCK_TYPES = new Set([
	"paragraph",
	"quote",
	"extended-quote",
	"heading",
	"extended-heading",
]);

const HTML_BLOCK_TYPES = new Set([
	"p",
	"div",
	"section",
	"article",
	"blockquote",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]);

const VOID_HTML_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
]);

const TEXT_FORMAT_TAGS: Array<{bit: number; open: string; close: string}> = [
	{bit: 1, open: "<strong>", close: "</strong>"},
	{bit: 2, open: "<em>", close: "</em>"},
	{bit: 4, open: "<s>", close: "</s>"},
	{bit: 8, open: "<u>", close: "</u>"},
	{bit: 16, open: "<code>", close: "</code>"},
	{bit: 32, open: "<sub>", close: "</sub>"},
	{bit: 64, open: "<sup>", close: "</sup>"},
	{bit: 128, open: "<mark>", close: "</mark>"},
];

const HTML_FORMAT_BITS: Record<string, number> = {
	b: 1,
	strong: 1,
	i: 2,
	em: 2,
	s: 4,
	strike: 4,
	del: 4,
	u: 8,
	code: 16,
	sub: 32,
	sup: 64,
	mark: 128,
};

/** Extracts a footnote label from a `#fn...` URL, ignoring `#fnref...` URLs. */
function getFootnoteLabelFromUrl(url: string): string | null {
	if (!url.startsWith("#fn") || url.startsWith("#fnref")) {
		return null;
	}
	const label = url.slice(3);
	return label.length > 0 ? label : null;
}

function escapeHtmlText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtmlText(value).replace(/"/g, "&quot;");
}

const HTML_TAG_SPLIT_REGEX = /(<[^>]*>)/g;

function formatMarkdownBoldItalic(text: string): string {
	return text
		.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
		.replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
		.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
		.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, "$1<em>$2</em>");
}

function formatMarkdownInlineSegment(segment: string): string {
	if (segment.length === 0) {
		return "";
	}

	// Stash generated markup so later passes cannot re-process its contents
	// (e.g. underscores inside a link URL turning into emphasis).
	const placeholders: string[] = [];
	const stash = (html: string): string => {
		const token = `\u0000${placeholders.length}\u0000`;
		placeholders.push(html);
		return token;
	};

	let result = segment.replace(/`([^`\n]+)`/g, (_match, code: string) =>
		stash(`<code>${escapeHtmlText(code)}</code>`),
	);

	result = result.replace(
		/\[([^\]\n]+)\]\(([^)\s]+)\)/g,
		(_match, label: string, url: string) =>
			stash(
				`<a href="${escapeHtmlAttribute(url)}">${formatMarkdownBoldItalic(label)}</a>`,
			),
	);

	result = formatMarkdownBoldItalic(result);

	return result.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => {
		return placeholders[Number(index)] ?? "";
	});
}

/**
 * Converts Markdown inline formatting in a footnote definition to HTML while
 * leaving any existing HTML tags (and their attributes) untouched.
 *
 * Supported: `**bold**`, `__bold__`, `*italic*`, `_italic_`, `` `code` ``,
 * `[label](url)` and newlines. Definitions may therefore mix HTML and Markdown.
 */
export function formatFootnoteDefinitionText(text: string): string {
	if (!text) {
		return "";
	}

	return text
		.split(HTML_TAG_SPLIT_REGEX)
		.map(part => {
			const isTag = part.startsWith("<") && part.endsWith(">");
			if (isTag) {
				return part;
			}
			return formatMarkdownInlineSegment(part).replace(/\n/g, "<br>");
		})
		.join("");
}

/** Returns true when a footnote definition contains HTML or Markdown formatting. */
export function hasFootnoteDefinitionFormatting(text: string): boolean {
	if (!text) {
		return false;
	}
	return (
		/<\/?[a-z][^>]*>/i.test(text) ||
		/\*\*[^*\n]+\*\*/.test(text) ||
		/(^|[^\w*])\*[^*\n]+\*(?!\*)/.test(text) ||
		/__[^_\n]+__/.test(text) ||
		/(^|[^\w_])_[^_\n]+_(?![\w_])/.test(text) ||
		/`[^`\n]+`/.test(text) ||
		/\[[^\]\n]+\]\([^)\s]+\)/.test(text)
	);
}

function serializeFootnoteReferenceHtml(label: string): string {
	const safeLabel = escapeHtmlAttribute(label);
	return `<sup class="footnote-ref"><a href="#fn${safeLabel}" id="fnref${safeLabel}">${escapeHtmlText(label)}</a></sup>`;
}

function applyTextFormat(escapedText: string, format: number): string {
	let html = escapedText;
	for (const {bit, open, close} of TEXT_FORMAT_TAGS) {
		if ((format & bit) !== 0) {
			html = `${open}${html}${close}`;
		}
	}
	return html;
}

function serializeInlineChildren(children: unknown): string {
	if (!Array.isArray(children)) {
		return "";
	}
	return children.map(serializeInlineNode).join("");
}

function serializeInlineNode(node: unknown): string {
	if (!node || typeof node !== "object") {
		return "";
	}
	const record = node as Record<string, unknown>;

	switch (record.type) {
		case "text":
		case "extended-text": {
			const text = typeof record.text === "string" ? record.text : "";
			const format = typeof record.format === "number" ? record.format : 0;
			return applyTextFormat(escapeHtmlText(text), format);
		}
		case "linebreak":
			return "<br>";
		case "footnote-reference": {
			const label = String(record.label ?? "");
			return label.length > 0 ? serializeFootnoteReferenceHtml(label) : "";
		}
		case "link":
		case "autolink": {
			const url = typeof record.url === "string" ? record.url : "";
			const footnoteLabel = getFootnoteLabelFromUrl(url);
			if (footnoteLabel) {
				return serializeFootnoteReferenceHtml(footnoteLabel);
			}
			const attributes = [`href="${escapeHtmlAttribute(url)}"`];
			for (const name of ["title", "target", "rel"] as const) {
				const value = record[name];
				if (typeof value === "string" && value.length > 0) {
					attributes.push(`${name}="${escapeHtmlAttribute(value)}"`);
				}
			}
			const inner = serializeInlineChildren(record.children);
			return `<a ${attributes.join(" ")}>${inner || escapeHtmlText(url)}</a>`;
		}
		default: {
			if (Array.isArray(record.children)) {
				return serializeInlineChildren(record.children);
			}
			if (typeof record.text === "string") {
				return escapeHtmlText(record.text);
			}
			return "";
		}
	}
}

function serializeBlockAsHtml(block: Record<string, unknown>): string {
	const inner = serializeInlineChildren(block.children);
	switch (block.type) {
		case "quote":
		case "extended-quote":
			return `<blockquote><p>${inner}</p></blockquote>`;
		case "heading":
		case "extended-heading": {
			const rawTag =
				typeof block.tag === "string" ? block.tag.toLowerCase() : "";
			const tag = /^h[1-6]$/.test(rawTag) ? rawTag : "h2";
			return `<${tag}>${inner}</${tag}>`;
		}
		default:
			return `<p>${inner}</p>`;
	}
}

function containsFootnoteReference(node: unknown): boolean {
	if (!node || typeof node !== "object") {
		return false;
	}
	if (Array.isArray(node)) {
		return node.some(containsFootnoteReference);
	}
	const record = node as Record<string, unknown>;
	if (record.type === "footnote-reference") {
		return true;
	}
	if (
		(record.type === "link" || record.type === "autolink") &&
		typeof record.url === "string" &&
		getFootnoteLabelFromUrl(record.url) !== null
	) {
		return true;
	}
	if (Array.isArray(record.children)) {
		return record.children.some(containsFootnoteReference);
	}
	return false;
}

/**
 * Walks a Lexical JSON tree and converts block nodes (paragraph, quote,
 * heading) that contain footnote references into Ghost HTML card nodes.
 *
 * Ghost renders Lexical link nodes as `<a href="#fn1"><sup>1</sup></a>` with no
 * `id`, so the footnote HTML card's back-reference links (`href="#fnref1"`)
 * cannot find their target. Emitting the reference inside an HTML card lets us
 * include the `id="fnref1"` attribute that `LinkNode` does not support.
 */
export function convertFootnotedParagraphsToHtmlCards(node: unknown): unknown {
	if (!node || typeof node !== "object") {
		return node;
	}
	if (Array.isArray(node)) {
		return node.map(convertFootnotedParagraphsToHtmlCards);
	}

	const record = node as Record<string, unknown>;
	const type = record.type;

	if (
		typeof type === "string" &&
		BLOCK_TYPES.has(type) &&
		containsFootnoteReference(record)
	) {
		return {
			type: "html",
			version: 1,
			html: serializeBlockAsHtml(record),
		};
	}

	// Never recurse into cards; the footnote definitions card must stay intact.
	if (type === "html" || type === "ghost-card") {
		return node;
	}

	// Block-level HTML cards are not valid inside list items, so leave lists alone.
	if (type === "list" || type === "listitem") {
		return node;
	}

	const res: Record<string, unknown> = {...record};
	if (record.root && typeof record.root === "object") {
		res.root = convertFootnotedParagraphsToHtmlCards(record.root);
	}
	if (Array.isArray(record.children)) {
		res.children = record.children.map(convertFootnotedParagraphsToHtmlCards);
	}
	return res;
}

type ParsedHtmlNode =
	| {kind: "text"; text: string}
	| {
			kind: "element";
			tag: string;
			attributes: Record<string, string>;
			children: ParsedHtmlNode[];
	  };

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
			String.fromCodePoint(parseInt(hex, 16)),
		)
		.replace(/&#([0-9]+);/g, (_match, dec: string) =>
			String.fromCodePoint(parseInt(dec, 10)),
		)
		.replace(/&nbsp;/gi, " ")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&");
}

function parseHtmlAttributes(source: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const attributeRegex =
		/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
	let match: RegExpExecArray | null;
	while ((match = attributeRegex.exec(source)) !== null) {
		const name = (match[1] ?? "").toLowerCase();
		if (!name) {
			continue;
		}
		const value = match[2] ?? match[3] ?? match[4] ?? "";
		attributes[name] = decodeHtmlEntities(value);
	}
	return attributes;
}

function parseHtmlFragment(html: string): ParsedHtmlNode[] {
	const rootChildren: ParsedHtmlNode[] = [];
	const stack: Array<{tag: string; children: ParsedHtmlNode[]}> = [
		{tag: "#root", children: rootChildren},
	];

	const tagRegex =
		/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/\s*([a-zA-Z][a-zA-Z0-9-]*)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

	const pushText = (text: string) => {
		if (text.length > 0) {
			stack[stack.length - 1].children.push({
				kind: "text",
				text: decodeHtmlEntities(text),
			});
		}
	};

	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = tagRegex.exec(html)) !== null) {
		if (match.index > lastIndex) {
			pushText(html.slice(lastIndex, match.index));
		}
		lastIndex = tagRegex.lastIndex;

		if (match[1]) {
			const closingTag = match[1].toLowerCase();
			for (let i = stack.length - 1; i > 0; i--) {
				if (stack[i].tag === closingTag) {
					stack.length = i;
					break;
				}
			}
			continue;
		}

		const tag = match[2]?.toLowerCase();
		if (!tag) {
			continue;
		}

		const element: ParsedHtmlNode = {
			kind: "element",
			tag,
			attributes: parseHtmlAttributes(match[3] ?? ""),
			children: [],
		};
		stack[stack.length - 1].children.push(element);

		const selfClosing = match[4] === "/" || VOID_HTML_ELEMENTS.has(tag);
		if (!selfClosing) {
			stack.push({tag, children: element.children});
		}
	}

	if (lastIndex < html.length) {
		pushText(html.slice(lastIndex));
	}

	return rootChildren;
}

function createTextNode(text: string, format: number): Record<string, unknown> {
	return {
		type: "text",
		text,
		format,
		detail: 0,
		mode: "normal",
		style: "",
		version: 1,
	};
}

function createParagraphNode(
	children: unknown[],
): Record<string, unknown> {
	return {
		type: "paragraph",
		version: 1,
		direction: null,
		format: "",
		indent: 0,
		textFormat: 0,
		textStyle: "",
		children,
	};
}

function convertInlineHtmlNodes(
	nodes: ParsedHtmlNode[],
	format = 0,
): unknown[] {
	const result: unknown[] = [];

	for (const node of nodes) {
		if (node.kind === "text") {
			if (node.text.length > 0) {
				result.push(createTextNode(node.text, format));
			}
			continue;
		}

		const {tag} = node;
		if (tag === "br") {
			result.push({type: "linebreak", version: 1});
			continue;
		}

		if (tag === "a") {
			const href = node.attributes.href ?? "";
			const footnoteLabel = getFootnoteLabelFromUrl(href);
			if (footnoteLabel) {
				result.push({
					type: "footnote-reference",
					label: footnoteLabel,
					version: 1,
				});
				continue;
			}
			const linkChildren = convertInlineHtmlNodes(node.children, format);
			result.push({
				type: "link",
				version: 1,
				url: href,
				rel: node.attributes.rel ?? null,
				target: node.attributes.target ?? null,
				title: node.attributes.title ?? null,
				children:
					linkChildren.length > 0
						? linkChildren
						: href
							? [createTextNode(href, format)]
							: [],
			});
			continue;
		}

		const bit = HTML_FORMAT_BITS[tag];
		result.push(
			...convertInlineHtmlNodes(node.children, bit ? format | bit : format),
		);
	}

	return result;
}

function convertBlockHtmlElement(
	element: Extract<ParsedHtmlNode, {kind: "element"}>,
): unknown[] {
	const {tag} = element;

	if (tag === "p") {
		return [createParagraphNode(convertInlineHtmlNodes(element.children))];
	}

	if (tag === "blockquote") {
		const children: unknown[] = [];
		for (const child of element.children) {
			if (child.kind === "text") {
				children.push(...convertInlineHtmlNodes([child]));
			} else if (child.tag === "p" || child.tag === "blockquote") {
				children.push(...convertInlineHtmlNodes(child.children));
			} else {
				children.push(...convertInlineHtmlNodes([child]));
			}
		}
		return [
			{
				type: "quote",
				version: 1,
				direction: null,
				format: "",
				indent: 0,
				children,
			},
		];
	}

	if (/^h[1-6]$/.test(tag)) {
		return [
			{
				type: "heading",
				tag,
				version: 1,
				direction: null,
				format: "",
				indent: 0,
				children: convertInlineHtmlNodes(element.children),
			},
		];
	}

	return [createParagraphNode(convertInlineHtmlNodes(element.children))];
}

/**
 * Checks whether a serialized node is an HTML card produced from a block that
 * contained inline footnote references.
 */
export function isFootnoteReferenceHtmlCard(node: unknown): boolean {
	if (!node || typeof node !== "object") {
		return false;
	}
	if (isFootnotesHtmlCard(node)) {
		return false;
	}
	const html = getHtmlFromCard(node);
	if (!html) {
		return false;
	}
	return /class\s*=\s*["'][^"']*\bfootnote-ref\b[^"']*["']/i.test(html);
}

/**
 * Parses an HTML card containing inline footnote references back into regular
 * Lexical nodes (`paragraph`/`quote`/`heading` with `footnote-reference`
 * children) so the content is editable in the Lab again.
 */
export function convertFootnoteHtmlCardToLexicalNodes(html: string): unknown[] {
	if (!html || typeof html !== "string") {
		return [];
	}

	const parsed = parseHtmlFragment(html);
	const nodes: unknown[] = [];
	let pendingInline: unknown[] = [];

	const flushInline = () => {
		if (pendingInline.length > 0) {
			nodes.push(createParagraphNode(pendingInline));
			pendingInline = [];
		}
	};

	for (const node of parsed) {
		if (node.kind === "text") {
			if (node.text.trim().length === 0 && pendingInline.length === 0) {
				continue;
			}
			pendingInline.push(...convertInlineHtmlNodes([node]));
			continue;
		}

		if (HTML_BLOCK_TYPES.has(node.tag)) {
			flushInline();
			nodes.push(...convertBlockHtmlElement(node));
		} else {
			pendingInline.push(...convertInlineHtmlNodes([node]));
		}
	}

	flushInline();
	return nodes;
}

/**
 * Compiles a list or dictionary of footnote definitions into the exact
 * Ghost-compatible HTML markup for the bottom footnotes card.
 */
export function compileFootnotesHtml(
	definitions: Record<string, string> | FootnoteItem[],
): string {
	const items: FootnoteItem[] = Array.isArray(definitions)
		? definitions
		: Object.entries(definitions).map(([id, text]) => ({id, text}));

	if (items.length === 0) {
		return "";
	}

	const listHtml = items
		.map(item => {
			const formattedText = formatFootnoteDefinitionText(item.text);
			const textPart = formattedText ? `${formattedText} ` : "";
			return `    <li id="fn${item.id}" class="footnote-item">\n      <p>${textPart}<a href="#fnref${item.id}" class="footnote-backref">↩</a></p>\n    </li>`;
		})
		.join("\n");

	return `<hr class="footnotes-sep">\n<section class="footnotes">\n  <ol class="footnotes-list">\n${listHtml}\n  </ol>\n</section>`;
}

/**
 * Compiles footnote definitions into a serialized Ghost HTML card node:
 * `{ type: "html", version: 1, html: "..." }`
 */
export function compileFootnotesCard(
	definitions: Record<string, string> | FootnoteItem[],
): {type: "html"; version: 1; html: string} | null {
	const html = compileFootnotesHtml(definitions);
	if (!html) {
		return null;
	}
	return {
		type: "html",
		version: 1,
		html,
	};
}

/**
 * Checks whether a serialized Lexical node represents a Ghost footnotes HTML card.
 */
export function isFootnotesHtmlCard(node: unknown): boolean {
	if (!node || typeof node !== "object") {
		return false;
	}
	const record = node as Record<string, unknown>;

	if (record.type === "html" && typeof record.html === "string") {
		return (
			record.html.includes("class=\"footnotes\"") ||
			record.html.includes("class='footnotes'") ||
			record.html.includes("class=\"footnotes-sep\"") ||
			record.html.includes("<section class=\"footnotes\">")
		);
	}

	if (record.type === "ghost-card" && record.cardType === "html") {
		const data = record.data as Record<string, unknown> | undefined;
		if (data && typeof data.html === "string") {
			return (
				data.html.includes("class=\"footnotes\"") ||
				data.html.includes("class='footnotes'") ||
				data.html.includes("class=\"footnotes-sep\"") ||
				data.html.includes("<section class=\"footnotes\">")
			);
		}
	}

	return false;
}

/**
 * Extracts raw HTML string from an HTML card or ghost-card wrapping an HTML card.
 */
export function getHtmlFromCard(node: unknown): string | null {
	if (!node || typeof node !== "object") {
		return null;
	}
	const record = node as Record<string, unknown>;
	if (record.type === "html" && typeof record.html === "string") {
		return record.html;
	}
	if (record.type === "ghost-card" && record.cardType === "html") {
		const data = record.data as Record<string, unknown> | undefined;
		if (data && typeof data.html === "string") {
			return data.html;
		}
	}
	return null;
}

/**
 * Parses a Ghost footnotes HTML card markup and extracts definition texts mapped by id/label.
 */
export function extractFootnoteDefinitionsFromHtml(
	html: string,
): Record<string, string> {
	const definitions: Record<string, string> = {};
	if (!html || typeof html !== "string") {
		return definitions;
	}

	const itemRegex = /<li\s+[^>]*id="fn([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi;
	let match: RegExpExecArray | null;

	while ((match = itemRegex.exec(html)) !== null) {
		const id = match[1];
		let content = match[2] ?? "";

		// Remove backref link e.g. <a href="#fnref..." class="footnote-backref">↩</a>
		content = content.replace(
			/<a\s+[^>]*class="[^"]*footnote-backref[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
			"",
		);
		content = content.replace(
			/<a\s+[^>]*href="#fnref[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
			"",
		);

		// Remove wrapping <p> and </p> tags
		content = content.replace(/<\/?p[^>]*>/gi, "");

		definitions[id] = content.trim();
	}

	return definitions;
}

/**
 * Collects all footnote reference labels in document traversal order.
 */
export function findFootnoteReferenceLabels(node: unknown): string[] {
	const labels: string[] = [];
	const seen = new Set<string>();

	function walk(current: unknown) {
		if (!current || typeof current !== "object") {
			return;
		}
		if (Array.isArray(current)) {
			for (const item of current) {
				walk(item);
			}
			return;
		}

		const record = current as Record<string, unknown>;
		if (
			record.type === "footnote-reference" &&
			typeof record.label === "string" &&
			record.label.length > 0
		) {
			if (!seen.has(record.label)) {
				seen.add(record.label);
				labels.push(record.label);
			}
		} else if (
			record.type === "link" &&
			typeof record.url === "string" &&
			record.url.startsWith("#fn") &&
			!record.url.startsWith("#fnref")
		) {
			const label = record.url.slice(3);
			if (label.length > 0 && !seen.has(label)) {
				seen.add(label);
				labels.push(label);
			}
		}

		if (record.root && typeof record.root === "object") {
			walk(record.root);
		}
		if (Array.isArray(record.children)) {
			for (const child of record.children) {
				walk(child);
			}
		}
	}

	walk(node);
	return labels;
}


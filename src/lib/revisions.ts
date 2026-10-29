import type {PostRevision} from "./api";

const REVISION_REASON_LABELS: Record<string, string> = {
	initial_revision: "Initial version",
	explicit_save: "Saved revision (Cmd+S)",
	background_save: "Autosave",
	published: "Published",
	unpublished: "Unpublished",
};

export function formatRevisionReason(reason?: string): string {
	if (!reason) {
		return "Revision";
	}
	return REVISION_REASON_LABELS[reason] ?? "Revision";
}

type LexicalNode = {
	type?: string;
	text?: unknown;
	children?: unknown;
};

const BLOCK_TYPES = new Set([
	"root",
	"paragraph",
	"heading",
	"quote",
	"list",
	"listitem",
	"code",
	"horizontalrule",
	"table",
	"tablerow",
	"tablecell",
]);

function isBlockNode(node: LexicalNode): boolean {
	if (!node || typeof node !== "object") {
		return false;
	}
	return typeof node.type === "string" && BLOCK_TYPES.has(node.type);
}

function nodeText(node: LexicalNode): string {
	if (!node || typeof node !== "object") {
		return "";
	}
	if (node.type === "linebreak") {
		return "\n";
	}
	if (typeof node.text === "string") {
		return node.text;
	}

	const children = Array.isArray(node.children)
		? (node.children as LexicalNode[])
		: [];
	if (children.length === 0) {
		return "";
	}

	// Inline children flow together; nested blocks start a new line.
	const parts: string[] = [];
	let inlineBuffer = "";
	for (const child of children) {
		if (isBlockNode(child)) {
			if (inlineBuffer) {
				parts.push(inlineBuffer);
				inlineBuffer = "";
			}
			parts.push(nodeText(child));
		} else {
			inlineBuffer += nodeText(child);
		}
	}
	if (inlineBuffer) {
		parts.push(inlineBuffer);
	}

	return parts.filter(part => part !== "").join("\n");
}

/**
 * Best-effort plain-text extraction from Ghost's Lexical JSON. Returns an
 * empty string instead of throwing when the value is missing or malformed.
 */
export function extractLexicalPlainText(lexical: string): string {
	if (!lexical) {
		return "";
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(lexical);
	} catch {
		return "";
	}

	if (!parsed || typeof parsed !== "object") {
		return "";
	}

	const root = (parsed as {root?: unknown}).root;
	if (!root || typeof root !== "object") {
		return "";
	}

	return nodeText(root as LexicalNode);
}

function revisionTimestamp(revision: PostRevision): number {
	if (
		typeof revision.created_at_ts === "number" &&
		Number.isFinite(revision.created_at_ts)
	) {
		return revision.created_at_ts;
	}

	const parsed = Date.parse(revision.created_at);
	return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortRevisionsNewestFirst(
	revisions: PostRevision[],
): PostRevision[] {
	return [...revisions].sort(
		(a, b) => revisionTimestamp(b) - revisionTimestamp(a),
	);
}

export function buildRestorePatch(revision: PostRevision): {
	title: string;
	lexical: string;
	custom_excerpt: string | null;
	feature_image: string | null;
	feature_image_alt: string | null;
	feature_image_caption: string | null;
} {
	return {
		title: revision.title,
		lexical: revision.lexical,
		custom_excerpt: revision.custom_excerpt ?? null,
		feature_image: revision.feature_image ?? null,
		feature_image_alt: revision.feature_image_alt ?? null,
		feature_image_caption: revision.feature_image_caption ?? null,
	};
}

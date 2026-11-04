import type {
	ElementTransformer,
	TextFormatTransformer,
	TextMatchTransformer,
} from "@lexical/markdown";
import {TRANSFORMERS} from "@lexical/markdown";
import {
	$createHorizontalRuleNode,
	$isHorizontalRuleNode,
	HorizontalRuleNode,
} from "@lexical/extension";
import type {LexicalNode, TextNode} from "lexical";
import {$createFootnoteReferenceNode, $isFootnoteReferenceNode, FootnoteReferenceNode} from "./FootnoteReferenceNode";
import {$createGhostCardNode, $isGhostCardNode, GhostCardNode} from "./GhostCardNode";

export const HIGHLIGHT: TextFormatTransformer = {
	format: ["highlight"],
	tag: "==",
	type: "text-format",
};

// `@lexical/markdown` no longer ships a horizontal-rule transformer, so the lab
// provides one to keep Koenig's `horizontalrule` nodes round-tripping through
// `---` markdown.
export const HORIZONTAL_RULE_TRANSFORMER: ElementTransformer = {
	dependencies: [HorizontalRuleNode],
	export: (node: LexicalNode) => {
		if (!$isHorizontalRuleNode(node)) {
			return null;
		}
		return "---";
	},
	regExp: /^(?:---|\*\*\*|___)\s*$/,
	replace: (parentNode) => {
		parentNode.replace($createHorizontalRuleNode());
	},
	triggerOnEnter: true,
	type: "element",
};

export const EM_DASH_TRANSFORMER: TextMatchTransformer = {
	dependencies: [],
	export: () => null,
	importRegExp: /(?:(?<!-)---(?!-)|–-)/,
	regExp: /(?:(?<=[^-])---|–-)$/,
	replace: (textNode: TextNode) => {
		textNode.setTextContent("—");
		textNode.selectEnd();
	},
	trigger: "-",
	type: "text-match",
};

export const EN_DASH_TRANSFORMER: TextMatchTransformer = {
	dependencies: [],
	export: () => null,
	importRegExp: /(?<!-)--(?!-)/,
	regExp: /(?<=[^-])--$/,
	replace: (textNode: TextNode) => {
		textNode.setTextContent("–");
		textNode.selectEnd();
	},
	trigger: "-",
	type: "text-match",
};

export const ELLIPSIS_TRANSFORMER: TextMatchTransformer = {
	dependencies: [],
	export: () => null,
	importRegExp: /\.\.\./,
	regExp: /\.\.\.$/,
	replace: (textNode: TextNode) => {
		textNode.setTextContent("…");
		textNode.selectEnd();
	},
	trigger: ".",
	type: "text-match",
};

function encodeUtf8Base64(str: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(str, "utf-8").toString("base64");
	}
	const bytes = new TextEncoder().encode(str);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

function decodeUtf8Base64(base64: string): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(base64, "base64").toString("utf-8");
	}
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

export const GHOST_CARD_TRANSFORMER: ElementTransformer = {
	dependencies: [GhostCardNode],
	export: (node: LexicalNode) => {
		if (!$isGhostCardNode(node)) {
			return null;
		}
		const payload = {
			cardType: node.getCardType(),
			data: node.getData(),
		};
		const json = JSON.stringify(payload);
		const encoded = encodeUtf8Base64(json);
		return `<!--kg-card:${node.getCardType()} ${encoded}-->`;
	},
	regExp: /^<!--kg-card:([a-zA-Z0-9_-]+)\s+(.+?)-->$/,
	replace: (parentNode, _children, match) => {
		try {
			const raw = match[2];
			let json = "";
			if (raw.startsWith("{")) {
				json = raw;
			} else {
				json = decodeUtf8Base64(raw);
			}
			const parsed = JSON.parse(json);
			const cardType = parsed.cardType || match[1];
			const data = parsed.data || parsed;
			const cardNode = $createGhostCardNode(cardType, data);
			parentNode.replace(cardNode);
		} catch {
			// ignore malformed card comment
		}
	},
	type: "element",
};

export const FOOTNOTE_TEXT_MATCH_TRANSFORMER: TextMatchTransformer = {
	dependencies: [FootnoteReferenceNode],
	export: (node: LexicalNode) => {
		if (!$isFootnoteReferenceNode(node)) {
			return null;
		}
		return `[^${node.getLabel()}]`;
	},
	importRegExp: /(?:\[\^([a-zA-Z0-9_-]+)\])/,
	regExp: /(?:\[\^([a-zA-Z0-9_-]+)\])$/,
	replace: (textNode: TextNode, match: RegExpMatchArray) => {
		const label = match[1];
		if (!label) return;
		const footnoteNode = $createFootnoteReferenceNode(label);
		textNode.replace(footnoteNode);
	},
	trigger: "]",
	type: "text-match",
};

export function createFootnoteDefinitionTransformer(
	onDefineFootnote: (label: string, text: string) => void,
): ElementTransformer {
	return {
		dependencies: [],
		export: () => null,
		regExp: /^\[\^([a-zA-Z0-9_-]+)\]:\s*(.*)$/,
		replace: (parentNode, _children, match) => {
			const label = match[1];
			const text = match[2] ?? "";
			if (label) {
				onDefineFootnote(label, text.trim());
				parentNode.remove();
			}
		},
		type: "element",
		triggerOnEnter: true,
	};
}

const BASE_TRANSFORMERS = TRANSFORMERS.filter(
	t => !(t.type === "text-format" && t.tag === "=="),
);

export function createLabMarkdownTransformers(
	onDefineFootnote?: (label: string, text: string) => void,
) {
	if (onDefineFootnote) {
		return [
			HORIZONTAL_RULE_TRANSFORMER,
			GHOST_CARD_TRANSFORMER,
			FOOTNOTE_TEXT_MATCH_TRANSFORMER,
			EM_DASH_TRANSFORMER,
			EN_DASH_TRANSFORMER,
			ELLIPSIS_TRANSFORMER,
			HIGHLIGHT,
			createFootnoteDefinitionTransformer(onDefineFootnote),
			...BASE_TRANSFORMERS,
		];
	}
	return [
		HORIZONTAL_RULE_TRANSFORMER,
		GHOST_CARD_TRANSFORMER,
		FOOTNOTE_TEXT_MATCH_TRANSFORMER,
		EM_DASH_TRANSFORMER,
		EN_DASH_TRANSFORMER,
		ELLIPSIS_TRANSFORMER,
		HIGHLIGHT,
		...BASE_TRANSFORMERS,
	];
}

export const LAB_MARKDOWN_TRANSFORMERS = createLabMarkdownTransformers();


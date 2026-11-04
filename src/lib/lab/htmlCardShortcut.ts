import type {ElementNode, LexicalEditor} from "lexical";
import {
	$createParagraphNode,
	$getSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ENTER_COMMAND,
	KEY_SPACE_COMMAND,
	mergeRegister,
} from "lexical";
import {$createGhostCardNode, type GhostCardNode} from "./GhostCardNode";

const HTML_CARD_TYPE = "html";

/**
 * Bare commands that insert an empty HTML card: a Markdown fence opened with
 * `html` (` ```html `) or the `/html` slash command.
 */
const EMPTY_HTML_CARD_PATTERN = /^(?:```html|\/html)$/i;

/**
 * A complete fenced HTML block, e.g.
 *
 * ```html
 * <div>Hello</div>
 * ```
 */
const FENCED_HTML_PATTERN = /^```html\s*([\s\S]*?)```$/i;

/**
 * An opening fence with inline content but no closing fence yet, e.g.
 * `` ```html <div>Hi</div> `` followed by Enter. Enter commits whatever the
 * user typed after the fence into the card.
 */
const OPEN_FENCED_HTML_PATTERN = /^```html(?:[ \t]+|\r?\n+)([\s\S]*)$/i;

/**
 * Returns the HTML that should be stored on an HTML card when `text` is an
 * HTML-card trigger, or `null` when the text is ordinary paragraph content.
 *
 * - `` ```html `` / `` ```html ` `` / `/html` / `/html ` -> empty card (`""`)
 * - a complete fenced block -> the HTML between the fences
 */
export function extractHtmlCardHtml(text: string): string | null {
	const normalized = text.replace(/\u00a0/g, " ").trim();

	if (EMPTY_HTML_CARD_PATTERN.test(normalized)) {
		return "";
	}

	const fenced = normalized.match(FENCED_HTML_PATTERN);
	if (fenced) {
		return fenced[1].replace(/^\r?\n/, "").replace(/\r?\n$/, "");
	}

	const openFenced = normalized.match(OPEN_FENCED_HTML_PATTERN);
	if (openFenced) {
		return openFenced[1].trim();
	}

	return null;
}

/**
 * Replaces `block` with an HTML Ghost card. When the card is the last block in
 * the document a trailing paragraph is added so the user can keep typing;
 * otherwise the cursor moves to the next block.
 */
export function $replaceBlockWithHtmlCard(
	block: ElementNode,
	html: string,
): GhostCardNode {
	const card = $createGhostCardNode(HTML_CARD_TYPE, {
		type: HTML_CARD_TYPE,
		version: 1,
		html,
	});

	block.replace(card);

	const next = card.getNextSibling();
	if (next !== null) {
		if ($isElementNode(next)) {
			next.selectStart();
		} else {
			card.selectNext();
		}
	} else {
		const paragraph = $createParagraphNode();
		card.insertAfter(paragraph);
		paragraph.selectStart();
	}

	return card;
}

function isTextInputTarget(target: EventTarget | null): boolean {
	if (!target) {
		return false;
	}
	const tagName = (target as {tagName?: unknown}).tagName;
	return tagName === "TEXTAREA" || tagName === "INPUT";
}

/**
 * Runs inside a Lexical update. If the current paragraph only contains an
 * HTML-card trigger, replaces it with an HTML Ghost card and returns the new
 * card. Returns `null` when the shortcut does not apply.
 *
 * When `isEnter` is true, bare `/html` is skipped so `SlashMenuPlugin` can handle
 * it (and any inline argument) without collision.
 */
function $applyHtmlCardShortcut(isEnter = false): GhostCardNode | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}

	const block = selection.anchor.getNode().getTopLevelElement();
	if (!$isParagraphNode(block)) {
		return null;
	}

	const text = block.getTextContent().replace(/\u00a0/g, " ").trim();
	if (isEnter && /^\/html$/i.test(text)) {
		return null;
	}

	const html = extractHtmlCardHtml(text);
	if (html === null) {
		return null;
	}

	return $replaceBlockWithHtmlCard(block, html);
}

/**
 * Registers the Enter/Space handlers that turn ```html or /html paragraphs into
 * HTML Ghost cards. Returns an unregister function.
 */
export function registerHtmlCardShortcut(editor: LexicalEditor): () => void {
	const handleShortcut = (
		event: KeyboardEvent | null,
		isEnter: boolean,
	): boolean => {
		// Never treat keystrokes inside the card source editor (or any other
		// embedded input) as editor shortcuts.
		if (event && isTextInputTarget(event.target)) {
			return false;
		}

		// Command listeners run inside a Lexical update context, so the
		// paragraph can be converted directly here. This also lets the handler
		// return `true` synchronously so the keyboard event is cancelled.
		const card = $applyHtmlCardShortcut(isEnter);
		if (card === null) {
			return false;
		}

		if (event) {
			event.preventDefault();
		}
		return true;
	};

	return mergeRegister(
		editor.registerCommand(
			KEY_ENTER_COMMAND,
			event => handleShortcut(event, true),
			COMMAND_PRIORITY_HIGH,
		),
		editor.registerCommand(
			KEY_SPACE_COMMAND,
			event => handleShortcut(event, false),
			COMMAND_PRIORITY_HIGH,
		),
	);
}

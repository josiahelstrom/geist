import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	KEY_ENTER_COMMAND,
	KEY_SPACE_COMMAND,
	createEditor,
	type LexicalEditor,
} from "lexical";import {describe, expect, it, vi} from "vitest";
import {$isGhostCardNode, type GhostCardNode} from "./GhostCardNode";
import {
	$replaceBlockWithHtmlCard,
	extractHtmlCardHtml,
	registerHtmlCardShortcut,
} from "./htmlCardShortcut";
import {LAB_NODES} from "./labNodes";

function createShortcutEditor(paragraphText: string): LexicalEditor {
	const editor = createEditor({nodes: LAB_NODES});

	editor.update(() => {
		const paragraph = $createParagraphNode();
		paragraph.append($createTextNode(paragraphText));
		$getRoot().append(paragraph);
		paragraph.selectEnd();
	}, {discrete: true});

	return editor;
}

function getFirstHtmlCard(editor: LexicalEditor): GhostCardNode | null {
	let card: GhostCardNode | null = null;
	editor.getEditorState().read(() => {
		const first = $getRoot().getFirstChild();
		if ($isGhostCardNode(first)) {
			card = first;
		}
	});
	return card;
}

function keyboardEvent(): KeyboardEvent {
	return {
		preventDefault: vi.fn(),
		target: null,
	} as unknown as KeyboardEvent;
}

describe("extractHtmlCardHtml", () => {
	it("recognizes the bare ```html and /html triggers", () => {
		expect(extractHtmlCardHtml("```html")).toBe("");
		expect(extractHtmlCardHtml("```html ")).toBe("");
		expect(extractHtmlCardHtml("  ```HTML  ")).toBe("");
		expect(extractHtmlCardHtml("/html")).toBe("");
		expect(extractHtmlCardHtml("/html ")).toBe("");
	});

	it("extracts the content of a complete fenced HTML block", () => {
		expect(
			extractHtmlCardHtml("```html\n<section>Hello</section>\n```"),
		).toBe("<section>Hello</section>");
		expect(extractHtmlCardHtml("```html<section>Inline</section>```")).toBe(
			"<section>Inline</section>",
		);
		expect(extractHtmlCardHtml("```html\n```")).toBe("");
	});

	it("extracts inline content after an opening fence", () => {
		expect(extractHtmlCardHtml("```html <div>Inline</div>")).toBe(
			"<div>Inline</div>",
		);
		expect(
			extractHtmlCardHtml("```html\n<div>Next line</div>"),
		).toBe("<div>Next line</div>");
	});

	it("ignores ordinary paragraph content", () => {
		expect(extractHtmlCardHtml("Hello ```html")).toBeNull();
		expect(extractHtmlCardHtml("/html is a command")).toBeNull();
		expect(extractHtmlCardHtml("```js\nconsole.log(1)\n```")).toBeNull();
		expect(extractHtmlCardHtml("")).toBeNull();
	});
});

describe("$replaceBlockWithHtmlCard", () => {
	it("replaces the paragraph with an HTML Ghost card and keeps typing possible", () => {
		const editor = createEditor({nodes: LAB_NODES});

		editor.update(() => {
			const paragraph = $createParagraphNode();
			paragraph.append($createTextNode("```html"));
			$getRoot().append(paragraph);

			const card = $replaceBlockWithHtmlCard(
				paragraph,
				"<p>Inserted</p>",
			);

			expect($isGhostCardNode(card)).toBe(true);
			expect(card.getCardType()).toBe("html");
			expect(card.getData()).toEqual({
				type: "html",
				version: 1,
				html: "<p>Inserted</p>",
			});

			const children = $getRoot().getChildren();
			expect(children[0]).toBe(card);
			// A trailing paragraph lets the user continue typing after the card.
			expect(children).toHaveLength(2);
			expect(children[1]?.getType()).toBe("paragraph");
		});
	});
});

describe("registerHtmlCardShortcut", () => {
	it("inserts an HTML card when space follows the /html command", async () => {
		const editor = createShortcutEditor("/html");
		const unregister = registerHtmlCardShortcut(editor);
		const event = keyboardEvent();

		const handled = editor.dispatchCommand(KEY_SPACE_COMMAND, event);
		await Promise.resolve();

		expect(handled).toBe(true);
		expect(event.preventDefault).toHaveBeenCalled();
		const card = getFirstHtmlCard(editor);
		expect(card).not.toBeNull();
		expect(card?.getCardType()).toBe("html");
		expect(card?.getData()).toEqual({type: "html", version: 1, html: ""});

		unregister();
	});

	it("leaves /html on Enter alone so SlashMenuPlugin can handle it", async () => {
		const editor = createShortcutEditor("/html");
		const unregister = registerHtmlCardShortcut(editor);
		const event = keyboardEvent();

		const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event);
		await Promise.resolve();

		expect(handled).toBe(false);
		expect(getFirstHtmlCard(editor)).toBeNull();

		unregister();
	});

	it("inserts an HTML card when Enter follows the ```html fence", async () => {
		const editor = createShortcutEditor("```html");
		const unregister = registerHtmlCardShortcut(editor);
		const event = keyboardEvent();

		const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event);
		await Promise.resolve();

		expect(handled).toBe(true);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(getFirstHtmlCard(editor)?.getData()).toEqual({
			type: "html",
			version: 1,
			html: "",
		});

		unregister();
	});

	it("inserts an HTML card when space follows the ```html fence", async () => {
		const editor = createShortcutEditor("```html");
		const unregister = registerHtmlCardShortcut(editor);
		const event = keyboardEvent();

		const handled = editor.dispatchCommand(KEY_SPACE_COMMAND, event);
		await Promise.resolve();

		expect(handled).toBe(true);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(getFirstHtmlCard(editor)?.getData()).toEqual({
			type: "html",
			version: 1,
			html: "",
		});

		unregister();
	});

	it("stores the fenced content on the card when Enter follows a complete fence", async () => {
		const editor = createShortcutEditor(
			"```html\n<section>Hello</section>\n```",
		);
		const unregister = registerHtmlCardShortcut(editor);

		const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, null);
		await Promise.resolve();

		expect(handled).toBe(true);
		expect(getFirstHtmlCard(editor)?.getData()).toEqual({
			type: "html",
			version: 1,
			html: "<section>Hello</section>",
		});

		unregister();
	});

	it("leaves ordinary paragraphs alone", async () => {
		const editor = createShortcutEditor("Just some text");
		const unregister = registerHtmlCardShortcut(editor);

		const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, null);
		await Promise.resolve();

		expect(handled).toBe(false);
		expect(getFirstHtmlCard(editor)).toBeNull();

		unregister();
	});

	it("ignores shortcuts fired from the card source textarea", async () => {
		const editor = createShortcutEditor("/html");
		const unregister = registerHtmlCardShortcut(editor);
		const event = keyboardEvent();
		(event as unknown as {target: {tagName: string}}).target = {
			tagName: "TEXTAREA",
		};

		const handled = editor.dispatchCommand(KEY_ENTER_COMMAND, event);
		await Promise.resolve();

		expect(handled).toBe(false);
		expect(getFirstHtmlCard(editor)).toBeNull();

		unregister();
	});
});

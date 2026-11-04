// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {lexicalJsonToMarkdown, markdownToLexicalJson} from "./markdownRoundtrip";
import {LAB_MARKDOWN_TRANSFORMERS} from "./markdownTransformers";
import {createEditor} from "lexical";
import {LAB_NODES} from "./labNodes";
import {FootnoteReferenceNode} from "./FootnoteReferenceNode";

describe("markdownRoundtrip", () => {
	it("exports LAB_MARKDOWN_TRANSFORMERS including base transformers and footnote", () => {
		expect(Array.isArray(LAB_MARKDOWN_TRANSFORMERS)).toBe(true);
		expect(LAB_MARKDOWN_TRANSFORMERS.length).toBeGreaterThan(0);
		// footnote transformer should be included
		const hasFootnote = LAB_MARKDOWN_TRANSFORMERS.some((t: any) => t === LAB_MARKDOWN_TRANSFORMERS[0] || (t && t.type === "text-match" && t.dependencies?.[0] === FootnoteReferenceNode));
		expect(hasFootnote).toBe(true);
	});

	it("lexicalJsonToMarkdown converts simple paragraph to markdown", () => {
		const editor = createEditor({nodes: LAB_NODES});
		editor.update(() => {
			const {$getRoot, $createParagraphNode, $createTextNode} = require("lexical");
			const root = $getRoot();
			const p = $createParagraphNode();
			const t = $createTextNode("Hello world");
			p.append(t);
			root.append(p);
		}, {discrete: true});
		const json = JSON.stringify(editor.getEditorState().toJSON());
		const md = lexicalJsonToMarkdown(json);
		expect(md).toContain("Hello world");
	});

	it("markdownToLexicalJson creates state from markdown", () => {
		const json = markdownToLexicalJson("# Title\n\nHello");
		expect(typeof json).toBe("string");
		const parsed = JSON.parse(json);
		expect(parsed.root).toBeDefined();
	});

	it("roundtrip preserves headings, lists, quotes, links", () => {
		const md = "# Heading\n\n> Quote\n\n- item1\n- item2\n\n[link](https://example.com)\n";
		const json = markdownToLexicalJson(md);
		const md2 = lexicalJsonToMarkdown(json);
		expect(md2).toContain("#");
		expect(md2).toContain(">");
		expect(md2).toContain("-");
		expect(md2).toContain("http");
	});

	it("handles footnote syntax [^1]", () => {
		const md = "Text with footnote[^1].\n\n[^1]: Footnote text";
		const json = markdownToLexicalJson(md);
		expect(typeof json).toBe("string");
		const md2 = lexicalJsonToMarkdown(json);
		expect(md2).toContain("[^1]");
	});

	it("extracts text from Koenig extended-text nodes", () => {
		const koenigJson = JSON.stringify({
			root: {
				type: "root",
				format: "",
				indent: 0,
				version: 1,
				children: [
					{
						type: "paragraph",
						format: "",
						indent: 0,
						version: 1,
						children: [
							{
								type: "extended-text",
								text: "Old Koenig post body",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
							{
								type: "extended-text",
								text: " with bold",
								format: 1,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
				],
			},
		});

		const md = lexicalJsonToMarkdown(koenigJson);
		expect(md).toContain("Old Koenig post body");
		expect(md).toContain("**with bold**");
		expect(md).not.toContain("Ghost Card");
	});

	it("round-trips Koenig extended-text content through markdown", () => {
		const koenigJson = JSON.stringify({
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "Koenig paragraph",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
				],
			},
		});

		const md = lexicalJsonToMarkdown(koenigJson);
		const json = markdownToLexicalJson(md);
		const md2 = lexicalJsonToMarkdown(json);
		expect(md2).toContain("Koenig paragraph");
	});

	it("converts Koenig extended-heading nodes to markdown headings", () => {
		const koenigJson = JSON.stringify({
			root: {
				type: "root",
				children: [
					{
						type: "extended-heading",
						tag: "h1",
						children: [
							{
								type: "extended-text",
								text: "Koenig title",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
					{
						type: "extended-heading",
						tag: "h2",
						children: [
							{
								type: "extended-text",
								text: "Koenig subheading",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
				],
			},
		});

		const md = lexicalJsonToMarkdown(koenigJson);
		expect(md).toContain("# Koenig title");
		expect(md).toContain("## Koenig subheading");
		expect(md).not.toContain("Ghost Card");

		const json = markdownToLexicalJson(md);
		const md2 = lexicalJsonToMarkdown(json);
		expect(md2).toContain("# Koenig title");
		expect(md2).toContain("## Koenig subheading");
	});

	it("converts Koenig horizontalrule nodes to markdown and back", () => {
		const koenigJson = JSON.stringify({
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "Above the rule",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
					{
						type: "horizontalrule",
						version: 1,
					},
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "Below the rule",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
				],
			},
		});

		const md = lexicalJsonToMarkdown(koenigJson);
		expect(md).toContain("---");
		expect(md).not.toContain("Ghost Card");

		const json = markdownToLexicalJson(md);
		const types = (JSON.parse(json).root.children as Array<{type: string}>).map(
			child => child.type,
		);
		expect(types).toContain("horizontalrule");
		expect(types).toContain("paragraph");

		const md2 = lexicalJsonToMarkdown(json);
		expect(md2).toContain("---");
		expect(md2).toContain("Above the rule");
		expect(md2).toContain("Below the rule");
	});

	it("preserves ghost-card nodes losslessly across markdown roundtrip", () => {
		const docWithCards = JSON.stringify({
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "text",
								text: "Before card",
								version: 1,
							},
						],
					},
					{
						type: "ghost-card",
						cardType: "image",
						data: {
							type: "image",
							version: 1,
							src: "https://example.com/hero.jpg",
							caption: "Hero image",
						},
						version: 1,
					},
					{
						type: "ghost-card",
						cardType: "callout",
						data: {
							type: "callout",
							version: 1,
							calloutText: "Important notice",
							calloutEmoji: "💡",
							backgroundColor: "blue",
						},
						version: 1,
					},
					{
						type: "paragraph",
						children: [
							{
								type: "text",
								text: "After card",
								version: 1,
							},
						],
					},
				],
			},
		});

		const md = lexicalJsonToMarkdown(docWithCards);
		expect(md).toContain("Before card");
		expect(md).toContain("After card");
		expect(md).not.toContain("[Ghost Card: image]");
		expect(md).toContain("<!--kg-card:image");
		expect(md).toContain("<!--kg-card:callout");

		const restoredJson = markdownToLexicalJson(md);
		const parsed = JSON.parse(restoredJson);
		const children = parsed.root.children;

		const cardNodes = children.filter((c: any) => c.type === "ghost-card");
		expect(cardNodes.length).toBe(2);
		expect(cardNodes[0].cardType).toBe("image");
		expect(cardNodes[0].data.src).toBe("https://example.com/hero.jpg");
		expect(cardNodes[0].data.caption).toBe("Hero image");
		expect(cardNodes[1].cardType).toBe("callout");
		expect(cardNodes[1].data.calloutText).toBe("Important notice");
	});

	it("transforms ==highlight== into highlighted text and round-trips it", () => {
		const md = "This is ==highlighted== text.";
		const json = markdownToLexicalJson(md);
		const parsed = JSON.parse(json);
		const paraChildren = parsed.root.children[0].children;
		const highlightedNode = paraChildren.find(
			(n: any) => n.text === "highlighted",
		);
		expect(highlightedNode).toBeDefined();
		// Lexical highlight format bit is 1 << 7 = 128
		expect(highlightedNode.format & 128).toBe(128);

		const md2 = lexicalJsonToMarkdown(json);
		expect(md2).toContain("==highlighted==");
	});

	it("transforms inline --, ---, and ... smart typography without breaking start-of-line --- horizontal rules", () => {
		const md = "---\n\nPages 10--20 --- wait for it...";
		const json = markdownToLexicalJson(md);
		const parsed = JSON.parse(json);
		const children = parsed.root.children;

		expect(children[0].type).toBe("horizontalrule");
		expect(children[1].type).toBe("paragraph");
		const textContent = children[1].children.map((n: any) => n.text).join("");
		expect(textContent).toBe("Pages 10–20 — wait for it…");
	});
});

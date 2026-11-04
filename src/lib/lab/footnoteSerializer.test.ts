import {describe, expect, it} from "vitest";
import {
	compileFootnotesCard,
	compileFootnotesHtml,
	convertFootnoteHtmlCardToLexicalNodes,
	convertFootnotedParagraphsToHtmlCards,
	extractFootnoteDefinitionsFromHtml,
	findFootnoteReferenceLabels,
	isFootnoteReferenceHtmlCard,
	isFootnotesHtmlCard,
} from "./footnoteSerializer";
import {unwrapGhostCards, wrapUnknownGhostCards} from "./GhostCardNode";

describe("footnoteSerializer", () => {
	it("compiles definitions into exact Ghost-compatible HTML card markup", () => {
		const definitions = {
			"1": "First source citation.",
			source: "https://example.com/paper",
		};

		const html = compileFootnotesHtml(definitions);
		expect(html).toContain('<hr class="footnotes-sep">');
		expect(html).toContain('<section class="footnotes">');
		expect(html).toContain('<ol class="footnotes-list">');
		expect(html).toContain(
			'<li id="fn1" class="footnote-item">\n      <p>First source citation. <a href="#fnref1" class="footnote-backref">↩</a></p>\n    </li>',
		);
		expect(html).toContain(
			'<li id="fnsource" class="footnote-item">\n      <p>https://example.com/paper <a href="#fnrefsource" class="footnote-backref">↩</a></p>\n    </li>',
		);

		const card = compileFootnotesCard(definitions);
		expect(card).toEqual({
			type: "html",
			version: 1,
			html,
		});
	});

	it("returns empty string and null card when definitions are empty", () => {
		expect(compileFootnotesHtml({})).toBe("");
		expect(compileFootnotesCard({})).toBeNull();
	});

	it("supports HTML and Markdown formatting in footnote definitions", () => {
		const html = compileFootnotesHtml({
			"1": "Baruch Spinoza, <i>Treatise</i>.",
			"2": "Read *Ethics* and **Politics** at [the archive](https://example.com/a_b).",
			"3": "First line\nSecond line with `code`.",
		});

		// Existing HTML tags pass through untouched.
		expect(html).toContain("Baruch Spinoza, <i>Treatise</i>.");
		// Markdown emphasis is converted, and underscores in URLs survive.
		expect(html).toContain(
			'Read <em>Ethics</em> and <strong>Politics</strong> at <a href="https://example.com/a_b">the archive</a>.',
		);
		// Newlines become line breaks and inline code is rendered.
		expect(html).toContain("First line<br>Second line with <code>code</code>.");
	});

	it("round-trips formatted definitions without double-converting markup", () => {
		const html = compileFootnotesHtml({"1": "See <em>Ethics</em> and *Politics*."});
		const definitions = extractFootnoteDefinitionsFromHtml(html);
		expect(definitions).toEqual({"1": "See <em>Ethics</em> and <em>Politics</em>."});

		expect(compileFootnotesHtml(definitions)).toBe(html);
	});

	it("extracts footnote definitions from Ghost HTML markup losslessly", () => {
		const html = `<hr class="footnotes-sep">
<section class="footnotes">
  <ol class="footnotes-list">
    <li id="fn1" class="footnote-item">
      <p>A simple note. <a href="#fnref1" class="footnote-backref">↩</a></p>
    </li>
    <li id="fnref-doc" class="footnote-item">
      <p>Reference documentation with <strong>bold</strong>. <a href="#fnrefref-doc" class="footnote-backref">↩</a></p>
    </li>
  </ol>
</section>`;

		const defs = extractFootnoteDefinitionsFromHtml(html);
		expect(defs).toEqual({
			"1": "A simple note.",
			"ref-doc": "Reference documentation with <strong>bold</strong>.",
		});
	});

	it("identifies footnotes HTML cards accurately", () => {
		const footnoteCard = {
			type: "html",
			version: 1,
			html: '<hr class="footnotes-sep"><section class="footnotes">...</section>',
		};
		const regularHtmlCard = {
			type: "html",
			version: 1,
			html: '<div class="custom-embed">Hello</div>',
		};
		const wrappedFootnoteCard = {
			type: "ghost-card",
			cardType: "html",
			data: {
				type: "html",
				html: '<hr class="footnotes-sep"><section class="footnotes">...</section>',
			},
		};

		expect(isFootnotesHtmlCard(footnoteCard)).toBe(true);
		expect(isFootnotesHtmlCard(wrappedFootnoteCard)).toBe(true);
		expect(isFootnotesHtmlCard(regularHtmlCard)).toBe(false);
		expect(isFootnotesHtmlCard(null)).toBe(false);
		expect(isFootnotesHtmlCard({type: "paragraph"})).toBe(false);
	});

	it("converts Ghost link nodes with #fn{label} to footnote-reference nodes", () => {
		const doc = {
			type: "paragraph",
			children: [
				{type: "text", text: "Some claim "},
				{
					type: "link",
					version: 1,
					url: "#fn1",
					children: [
						{
							type: "text",
							version: 1,
							text: "1",
							format: 64,
						},
					],
				},
				{type: "text", text: " and another claim "},
				{
					type: "link",
					version: 1,
					url: "#fncustom-ref",
					children: [
						{
							type: "text",
							version: 1,
							text: "custom-ref",
							format: 64,
						},
					],
				},
			],
		};

		const converted = wrapUnknownGhostCards(doc) as any;
		expect(converted.children[1]).toEqual({
			type: "footnote-reference",
			label: "1",
			version: 1,
		});
		expect(converted.children[3]).toEqual({
			type: "footnote-reference",
			label: "custom-ref",
			version: 1,
		});
	});

	it("finds all footnote reference labels in traversal order", () => {
		const doc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{type: "footnote-reference", label: "2"},
							{type: "footnote-reference", label: "1"},
						],
					},
					{
						type: "paragraph",
						children: [
							{type: "link", url: "#fn3"},
							{type: "footnote-reference", label: "2"}, // duplicate
						],
					},
				],
			},
		};

		expect(findFootnoteReferenceLabels(doc)).toEqual(["2", "1", "3"]);
	});

	it("extracts definitions and wraps footnote references via wrapUnknownGhostCards and unwrapGhostCards", () => {
		const ghostDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{type: "text", text: "Fact check verified "},
							{
								type: "link",
								version: 1,
								url: "#fn1",
								children: [
									{
										type: "text",
										version: 1,
										text: "1",
										format: 64,
									},
								],
							},
						],
					},
					{
						type: "html",
						version: 1,
						html: `<hr class="footnotes-sep">\n<section class="footnotes">\n  <ol class="footnotes-list">\n    <li id="fn1" class="footnote-item">\n      <p>Source 2024. <a href="#fnref1" class="footnote-backref">↩</a></p>\n    </li>\n  </ol>\n</section>`,
					},
				],
			},
		};

		// Import: removes raw HTML card and converts link to footnote-reference
		let definitions: Record<string, string> = {};
		const importedDoc = wrapUnknownGhostCards(ghostDoc, undefined, {
			onExtractFootnotes: defs => {
				definitions = {...definitions, ...defs};
			},
		}) as any;
		expect(definitions).toEqual({"1": "Source 2024."});

		const importedRoot = importedDoc.root;
		expect(importedRoot.children).toHaveLength(1); // HTML card removed!
		expect(importedRoot.children[0].children[1]).toEqual({
			type: "footnote-reference",
			label: "1",
			version: 1,
		});

		// Export: converts footnote-reference to link and appends HTML card
		const exported = unwrapGhostCards(importedDoc, definitions) as any;
		expect(exported.root.children).toHaveLength(2);
		expect(exported.root.children[1].type).toBe("html");
		expect(exported.root.children[1].html).toContain('<li id="fn1" class="footnote-item">');
	});

	it("converts a paragraph containing a footnote reference into an HTML card", () => {
		const doc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{type: "text", text: "Some claim ", format: 0},
							{
								type: "link",
								version: 1,
								url: "#fn1",
								children: [{type: "text", text: "1", format: 64}],
							},
						],
					},
				],
			},
		};

		const converted = convertFootnotedParagraphsToHtmlCards(doc) as any;
		expect(converted.root.children).toHaveLength(1);
		expect(converted.root.children[0]).toEqual({
			type: "html",
			version: 1,
			html: '<p>Some claim <sup class="footnote-ref"><a href="#fn1" id="fnref1">1</a></sup></p>',
		});
	});

	it("converts a blockquote containing a footnote reference into an HTML card", () => {
		const doc = {
			root: {
				type: "root",
				children: [
					{
						type: "quote",
						children: [
							{type: "text", text: "Quoted claim "},
							{type: "footnote-reference", label: "2", version: 1},
						],
					},
				],
			},
		};

		const converted = convertFootnotedParagraphsToHtmlCards(doc) as any;
		expect(converted.root.children[0]).toEqual({
			type: "html",
			version: 1,
			html: '<blockquote><p>Quoted claim <sup class="footnote-ref"><a href="#fn2" id="fnref2">2</a></sup></p></blockquote>',
		});

		// Roundtrip back to an editable quote node.
		const nodes = convertFootnoteHtmlCardToLexicalNodes(
			converted.root.children[0].html,
		) as any[];
		expect(nodes).toHaveLength(1);
		expect(nodes[0].type).toBe("quote");
		expect(nodes[0].children[0]).toMatchObject({
			type: "text",
			text: "Quoted claim ",
		});
		expect(nodes[0].children[1]).toEqual({
			type: "footnote-reference",
			label: "2",
			version: 1,
		});
	});

	it("leaves paragraphs without footnote references untouched", () => {
		const doc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [{type: "text", text: "No footnotes here."}],
					},
				],
			},
		};

		expect(convertFootnotedParagraphsToHtmlCards(doc)).toEqual(doc);
	});

	it("imports footnote-ref HTML cards back as editable nodes", () => {
		const card = {
			type: "html",
			version: 1,
			html: '<p>Some claim <sup class="footnote-ref"><a href="#fn1" id="fnref1">1</a></sup></p>',
		};

		expect(isFootnoteReferenceHtmlCard(card)).toBe(true);
		expect(isFootnoteReferenceHtmlCard({type: "paragraph"})).toBe(false);
		expect(
			isFootnoteReferenceHtmlCard({
				type: "html",
				version: 1,
				html: compileFootnotesHtml({"1": "A note."}),
			}),
		).toBe(false);

		const nodes = convertFootnoteHtmlCardToLexicalNodes(card.html) as any[];
		expect(nodes).toHaveLength(1);
		expect(nodes[0].type).toBe("paragraph");
		expect(nodes[0].children[0]).toMatchObject({
			type: "text",
			text: "Some claim ",
		});
		expect(nodes[0].children[1]).toEqual({
			type: "footnote-reference",
			label: "1",
			version: 1,
		});

		const wrapped = wrapUnknownGhostCards({
			root: {type: "root", children: [card]},
		}) as any;
		expect(wrapped.root.children).toHaveLength(1);
		expect(wrapped.root.children[0].type).toBe("paragraph");
	});

	it("integrates seamlessly with wrapUnknownGhostCards and unwrapGhostCards", () => {
		const ghostPayload = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "A statement ",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
							{
								type: "link",
								version: 1,
								url: "#fn42",
								children: [
									{
										type: "extended-text",
										version: 1,
										text: "42",
										format: 64,
									},
								],
							},
						],
					},
					{
						type: "html",
						version: 1,
						html: compileFootnotesHtml({"42": "The answer."}),
					},
				],
			},
		};

		let extractedDefs: Record<string, string> = {};
		const wrapped = wrapUnknownGhostCards(ghostPayload, undefined, {
			onExtractFootnotes: defs => {
				extractedDefs = defs;
			},
		}) as any;

		expect(extractedDefs).toEqual({"42": "The answer."});
		expect(wrapped.root.children).toHaveLength(1);
		expect(wrapped.root.children[0].children[1]).toEqual({
			type: "footnote-reference",
			label: "42",
			version: 1,
		});

		// Saving unwraps back to Ghost payload. The paragraph is emitted as an
		// HTML card so the footnote back-reference gets an `id="fnref42"` target.
		const unwrapped = unwrapGhostCards(wrapped, extractedDefs);
		expect(unwrapped).toEqual({
			root: {
				type: "root",
				children: [
					{
						type: "html",
						version: 1,
						html: '<p>A statement <sup class="footnote-ref"><a href="#fn42" id="fnref42">42</a></sup></p>',
					},
					{
						type: "html",
						version: 1,
						html: compileFootnotesHtml({"42": "The answer."}),
					},
				],
			},
		});
	});
});

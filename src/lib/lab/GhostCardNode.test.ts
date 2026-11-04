// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {createEditor} from "lexical";
import {
	$createGhostCardNode,
	GhostCardNode,
	sanitizeGhostCardHtml,
	unwrapGhostCards,
	wrapUnknownGhostCards,
} from "./GhostCardNode";

describe("GhostCardNode", () => {
	it("serializes and deserializes lossless payload", () => {
		const editor = createEditor({nodes: [GhostCardNode]});
		const payload = {
			type: "image",
			src: "https://example.com/photo.jpg",
			caption: "A photo",
			width: 800,
		};

		editor.update(() => {
			const node = GhostCardNode.importJSON(payload);
			expect(node.getCardType()).toBe("image");
			expect(node.getData()).toEqual(payload);

			const exported = node.exportJSON();
			expect(exported.type).toBe("ghost-card");
			expect(exported.cardType).toBe("image");
			expect(exported.data).toEqual(payload);
		});
	});

	it("preserves cardType and data getters/setters", () => {
		const editor = createEditor({nodes: [GhostCardNode]});

		editor.update(() => {
			const node = $createGhostCardNode("callout", {text: "Note"});
			expect(node.getCardType()).toBe("callout");
			expect(node.getData()).toEqual({text: "Note"});

			node.setCardType("bookmark");
			node.updateData({url: "https://ghost.org"});
			expect(node.getCardType()).toBe("bookmark");
			expect(node.getData()).toEqual({text: "Note", url: "https://ghost.org"});
		});
	});

	it("wraps and unwraps unknown Ghost card nodes losslessly", () => {
		const originalDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "Hello world",
								format: 0,
								detail: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
					{
						type: "image",
						src: "https://example.com/cat.jpg",
						caption: "A cat",
					},
					{
						type: "callout",
						calloutText: "Important warning",
						calloutEmoji: "⚠️",
					},
				],
			},
		};

		const wrapped = wrapUnknownGhostCards(originalDoc) as typeof originalDoc;
		expect(wrapped.root.children[1].type).toBe("ghost-card");
		expect((wrapped.root.children[1] as unknown as {cardType: string}).cardType).toBe("image");
		expect(wrapped.root.children[2].type).toBe("ghost-card");
		expect((wrapped.root.children[2] as unknown as {cardType: string}).cardType).toBe("callout");

		const unwrapped = unwrapGhostCards(wrapped);
		expect(unwrapped).toEqual(originalDoc);
	});

	it("is idempotent when wrapping multiple times and does not create nested ghost-cards", () => {
		const originalDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "image",
						src: "https://example.com/cat.jpg",
						caption: "A cat",
					},
					{
						type: "ghost-card",
						cardType: "callout",
						data: {type: "callout", text: "Already wrapped"},
						version: 1,
					},
				],
			},
		};

		const wrappedOnce = wrapUnknownGhostCards(originalDoc);
		const wrappedTwice = wrapUnknownGhostCards(wrappedOnce);

		expect(wrappedTwice).toEqual(wrappedOnce);

		const child0 = (wrappedTwice as any).root.children[0];
		expect(child0.type).toBe("ghost-card");
		expect(child0.cardType).toBe("image");
		expect(child0.data.type).toBe("image");

		const child1 = (wrappedTwice as any).root.children[1];
		expect(child1.type).toBe("ghost-card");
		expect(child1.cardType).toBe("callout");
		expect(child1.data.type).toBe("callout");

		const unwrapped = unwrapGhostCards(wrappedTwice);
		expect(unwrapped).toEqual({
			root: {
				type: "root",
				children: [
					{
						type: "image",
						src: "https://example.com/cat.jpg",
						caption: "A cat",
					},
					{
						type: "callout",
						text: "Already wrapped",
					},
				],
			},
		});
	});

	it("does not corrupt card metadata with nested type properties", () => {
		const originalDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "callout",
						calloutText: "Custom callout",
						nestedMetadata: {
							type: "badge",
							icon: {
								type: "svg",
								path: "M0 0h24v24H0z",
							},
						},
						actions: [
							{
								type: "button",
								label: "Click me",
							},
						],
					},
				],
			},
		};

		const wrapped = wrapUnknownGhostCards(originalDoc) as any;
		const card = wrapped.root.children[0];

		expect(card.type).toBe("ghost-card");
		expect(card.cardType).toBe("callout");
		expect(card.data.nestedMetadata.type).toBe("badge");
		expect(card.data.nestedMetadata.icon.type).toBe("svg");
		expect(card.data.actions[0].type).toBe("button");

		const unwrapped = unwrapGhostCards(wrapped);
		expect(unwrapped).toEqual(originalDoc);
	});

	it("converts extended-quote to quote on wrap and quote to extended-quote on unwrap", () => {
		const ghostDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "extended-quote",
						children: [
							{
								type: "extended-text",
								text: "To be or not to be.",
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
		};

		const wrapped = wrapUnknownGhostCards(ghostDoc) as any;
		expect(wrapped.root.children[0].type).toBe("quote");
		expect(wrapped.root.children[0].children[0].text).toBe("To be or not to be.");

		const unwrapped = unwrapGhostCards(wrapped) as any;
		expect(unwrapped).toEqual(ghostDoc);
		expect(unwrapped.root.children[0].type).toBe("extended-quote");
	});

	it("converts Koenig extended-text nodes to standard text nodes on wrap", () => {
		const ghostDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "Koenig body copy",
								format: 1,
								detail: 0,
								mode: "normal",
								style: "color: red;",
								version: 1,
							},
						],
					},
				],
			},
		};

		const wrapped = wrapUnknownGhostCards(ghostDoc) as any;
		expect(wrapped.root.children[0].children[0]).toEqual({
			type: "text",
			text: "Koenig body copy",
			format: 1,
			detail: 0,
			mode: "normal",
			style: "color: red;",
			version: 1,
		});
	});

	it("converts text nodes back to extended-text on unwrap", () => {
		const labDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "text",
								text: "Lab body copy",
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
		};

		const unwrapped = unwrapGhostCards(labDoc) as any;
		expect(unwrapped.root.children[0].children[0]).toEqual({
			type: "extended-text",
			text: "Lab body copy",
			format: 0,
			detail: 0,
			mode: "normal",
			style: "",
			version: 1,
		});
	});

	it("round-trips extended-text nodes losslessly", () => {
		const ghostDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "paragraph",
						children: [
							{
								type: "extended-text",
								text: "Round trip",
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
		};

		const wrapped = wrapUnknownGhostCards(ghostDoc) as any;
		expect(wrapped.root.children[0].children[0].type).toBe("text");
		expect(unwrapGhostCards(wrapped)).toEqual(ghostDoc);
	});

	it("converts extended-heading to heading on wrap and heading to extended-heading on unwrap", () => {
		const ghostDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "extended-heading",
						tag: "h2",
						children: [
							{
								type: "extended-text",
								text: "A subheading",
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
		};

		const wrapped = wrapUnknownGhostCards(ghostDoc) as any;
		expect(wrapped.root.children[0].type).toBe("heading");
		expect(wrapped.root.children[0].tag).toBe("h2");
		expect(wrapped.root.children[0].children[0].type).toBe("text");
		expect(wrapped.root.children[0].children[0].text).toBe("A subheading");

		const unwrapped = unwrapGhostCards(wrapped) as any;
		expect(unwrapped).toEqual(ghostDoc);
		expect(unwrapped.root.children[0].type).toBe("extended-heading");
		expect(unwrapped.root.children[0].tag).toBe("h2");
	});

	it("passes horizontalrule nodes through unchanged without wrapping them", () => {
		const ghostDoc = {
			root: {
				type: "root",
				children: [
					{
						type: "horizontalrule",
						version: 1,
					},
				],
			},
		};

		const wrapped = wrapUnknownGhostCards(ghostDoc) as any;
		expect(wrapped.root.children[0]).toEqual({
			type: "horizontalrule",
			version: 1,
		});
		expect(wrapped.root.children[0].type).not.toBe("ghost-card");

		expect(unwrapGhostCards(wrapped)).toEqual(ghostDoc);
	});

	describe("sanitizeGhostCardHtml", () => {
		it("strips scripts, iframes, event handlers and javascript URLs", () => {
			const dirty = [
				"<p onclick=\"alert('x')\">Hello <a href=\"javascript:alert('x')\">world</a></p>",
				"<script>alert('x')</script>",
				"<iframe src=\"https://example.com\"></iframe>",
			].join("");

			const clean = sanitizeGhostCardHtml(dirty);

			expect(clean).toContain("<p>Hello");
			expect(clean).toContain("<a>world</a>");
			expect(clean).not.toContain("href");
			expect(clean).not.toMatch(/<script/i);
			expect(clean).not.toMatch(/<iframe/i);
			expect(clean).not.toMatch(/onclick/i);
			expect(clean).not.toMatch(/javascript:/i);
		});

		it("preserves benign markup", () => {
			const html =
				'<figure class="image"><img src="https://example.com/a.png" alt="A"><figcaption>Caption</figcaption></figure>';

			expect(sanitizeGhostCardHtml(html)).toBe(html);
		});

		it("neutralizes obfuscated javascript URLs", () => {
			const clean = sanitizeGhostCardHtml(
				'<a href="java\nscript:alert(1)">Click</a>',
			);

			expect(clean).toBe("<a>Click</a>");
			expect(clean).not.toContain("href");
			expect(clean).not.toMatch(/javascript:/i);
		});

		it("removes inline styles and form markup from previews", () => {
			const clean = sanitizeGhostCardHtml(
				"<style>body { display: none; }</style><form><input name=\"q\"></form><p>Kept</p>",
			);

			expect(clean).toBe("<p>Kept</p>");
		});

		it("sanitizes <svg/onload=alert(1)> cleanly by stripping svg tags", () => {
			const clean = sanitizeGhostCardHtml("<svg/onload=alert(1)>");
			expect(clean).toBe("");
			expect(clean).not.toMatch(/<svg/i);
			expect(clean).not.toMatch(/onload/i);
			expect(clean).not.toMatch(/alert/i);
		});

		it("strips style, arbitrary id, and name attributes while preserving footnote anchor ids", () => {
			const dirty = [
				'<div style="position:fixed;inset:0;z-index:999999" id="window" name="document">Overlay</div>',
				'<li id="fn1"><p>Note <a href="#fnref1" id="fnref1">↩</a></p></li>',
				'<sup id="fnref2"><a href="#fn2">2</a></sup>',
				"<math><mi>x</mi></math><noscript>bad</noscript>",
			].join("");

			const clean = sanitizeGhostCardHtml(dirty);
			expect(clean).toContain("<div>Overlay</div>");
			expect(clean).not.toContain("style=");
			expect(clean).not.toContain('id="window"');
			expect(clean).not.toContain('name="document"');
			expect(clean).not.toMatch(/<math/i);
			expect(clean).not.toMatch(/<noscript/i);
			expect(clean).toContain('id="fn1"');
			expect(clean).toContain('id="fnref1"');
			expect(clean).toContain('id="fnref2"');
		});

		it("sanitizes <img/src=x/onerror=alert(1)> cleanly", () => {
			const clean = sanitizeGhostCardHtml("<img/src=x/onerror=alert(1)>");
			expect(clean).toBe('<img src="x/onerror=alert(1)">');
			const parsed = new DOMParser().parseFromString(clean, "text/html");
			expect(parsed.querySelector("img")?.hasAttribute("onerror")).toBe(false);
		});

		it("strips onerror event handlers from images", () => {
			const clean = sanitizeGhostCardHtml('<img src="x" onerror="alert(1)">');
			expect(clean).toBe('<img src="x">');
			expect(clean).not.toMatch(/onerror/i);
			expect(clean).not.toMatch(/alert/i);
		});

		it("sanitizes <a href=\"jav&#x61;script:alert(1)\"> cleanly", () => {
			const clean = sanitizeGhostCardHtml('<a href="jav&#x61;script:alert(1)">Click</a>');
			expect(clean).toBe("<a>Click</a>");
			expect(clean).not.toContain("href");
			expect(clean).not.toMatch(/alert/i);
		});

		it("sanitizes <a href=\"java\\tscript:alert(1)\"> cleanly", () => {
			const clean = sanitizeGhostCardHtml('<a href="java\tscript:alert(1)">Click</a>');
			expect(clean).toBe("<a>Click</a>");
			expect(clean).not.toContain("href");
			expect(clean).not.toMatch(/alert/i);
		});

		it("rejects dangerous srcset entries while preserving safe srcset attributes", () => {
			const dirty =
				'<img src="https://example.com/a.png" srcset="https://example.com/1x.png 1x, javascript:alert(1) 2x">' +
				'<img src="https://example.com/b.png" srcset="https://example.com/1x.png 1x, https://example.com/2x.png 2x">';
			const clean = sanitizeGhostCardHtml(dirty);
			expect(clean).not.toContain("javascript:");
			expect(clean).toContain(
				'<img src="https://example.com/a.png"><img src="https://example.com/b.png" srcset="https://example.com/1x.png 1x, https://example.com/2x.png 2x">',
			);
		});

		it("strips fn- drawer ids and invalid footnote ids while setting rel=\"noopener noreferrer\" on links", () => {
			const dirty = [
				'<li id="fn-1"><a href="https://example.com" id="fn:bad">External</a></li>',
				'<li id="fn1"><a href="#fnref1" id="fnref1">↩</a></li>',
			].join("");
			const clean = sanitizeGhostCardHtml(dirty);
			expect(clean).not.toContain('id="fn-1"');
			expect(clean).not.toContain('id="fn:bad"');
			expect(clean).toContain('id="fn1"');
			expect(clean).toContain('id="fnref1"');
			expect(clean).toContain('rel="noopener noreferrer"');
		});
	});
});

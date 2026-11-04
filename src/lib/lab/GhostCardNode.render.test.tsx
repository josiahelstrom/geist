// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type {EditorConfig, LexicalEditor} from "lexical";
import {$getNodeByKey, $getRoot, createEditor} from "lexical";
import {afterEach, describe, expect, it, vi} from "vitest";
import {fetchEmbed} from "../posts";
import {LabSiteContext} from "./labContext";
import type {Site} from "../api";
import {
	GhostCardNode,
	$createGhostCardNode,
	$isGhostCardNode,
} from "./GhostCardNode";

vi.mock("../posts", async importOriginal => {
	const actual = await importOriginal<typeof import("../posts")>();
	return {
		...actual,
		fetchEmbed: vi.fn(),
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function createTestEditor(): LexicalEditor {
	return createEditor({nodes: [GhostCardNode]});
}

function createCard(
	editor: LexicalEditor,
	cardType: string,
	data: Record<string, unknown>,
): GhostCardNode {
	let node!: GhostCardNode;
	editor.update(
		() => {
			node = $createGhostCardNode(cardType, data);
			$getRoot().append(node);
		},
		{discrete: true},
	);
	return node;
}

describe("GhostCardNode HTML decorator", () => {
	it("renders a sanitized HTML preview with an HTML badge", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "html", {
			type: "html",
			html: '<div class="widget"><h2>Hello</h2><script>alert("x")</script><img src="https://example.com/a.png" onerror="alert(1)"></div>',
		});

		render(node.decorate(editor, {} as EditorConfig));

		expect(screen.getByText("Ghost Card")).toBeInTheDocument();
		expect(screen.getByText("HTML")).toBeInTheDocument();

		const content = document.querySelector(".ghost-card-html-content");
		expect(content).not.toBeNull();
		expect(content?.innerHTML).toContain("<h2>Hello</h2>");
		expect(content?.innerHTML).not.toContain("script");
		expect(content?.innerHTML).not.toContain("onerror");
	});

	it("toggles between the preview and the editable raw HTML source", () => {
		const editor = createTestEditor();
		const rawHtml =
			'<div class="widget"><h2>Hello</h2><script>alert("x")</script></div>';
		const node = createCard(editor, "html", {type: "html", html: rawHtml});

		render(node.decorate(editor, {} as EditorConfig));

		fireEvent.click(screen.getByRole("button", {name: "View source"}));

		const source = document.querySelector<HTMLTextAreaElement>(
			".ghost-card-html-editor",
		);
		expect(source).not.toBeNull();
		expect(source?.value).toBe(rawHtml);
		expect(document.querySelector(".ghost-card-html-content")).toBeNull();

		fireEvent.click(screen.getByRole("button", {name: "Preview"}));

		expect(document.querySelector(".ghost-card-html-editor")).toBeNull();
		expect(document.querySelector(".ghost-card-html-content")).not.toBeNull();
	});

	it("edits raw HTML and writes it back to the node data", async () => {
		const editor = createTestEditor();
		const node = createCard(editor, "html", {type: "html", html: ""});

		render(node.decorate(editor, {} as EditorConfig));

		const source = document.querySelector<HTMLTextAreaElement>(
			".ghost-card-html-editor",
		);
		expect(source).not.toBeNull();

		fireEvent.change(source!, {
			target: {value: "<section>Updated</section>"},
		});

		await waitFor(() => {
			let updated = "";
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					updated = String(current.getData().html);
				}
			});
			expect(updated).toBe("<section>Updated</section>");
		});
	});

	it("keeps the payload placeholder for non-HTML cards", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "image", {
			type: "image",
			src: "https://example.com/pic.jpg",
		});

		render(node.decorate(editor, {} as EditorConfig));

		expect(screen.getByText("image")).toBeInTheDocument();
		expect(
			screen.getByRole("button", {name: "Inspect payload"}),
		).toBeInTheDocument();
		expect(document.querySelector(".ghost-card-html-content")).toBeNull();
	});

	it("still renders the HTML header and opens the editor for empty HTML", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "html", {type: "html", html: "   "});

		render(node.decorate(editor, {} as EditorConfig));

		expect(screen.getByText("Ghost Card")).toBeInTheDocument();
		expect(screen.getByText("HTML")).toBeInTheDocument();
		expect(
			screen.getByRole("button", {name: "View source"}),
		).toBeInTheDocument();
		const source = document.querySelector<HTMLTextAreaElement>(
			".ghost-card-html-editor",
		);
		expect(source).not.toBeNull();
		expect(source?.value).toBe("   ");
		expect(document.querySelector(".ghost-card-html-content")).toBeNull();
	});

	it("keeps the source editor open while typing into an empty card", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "html", {type: "html", html: ""});

		render(node.decorate(editor, {} as EditorConfig));

		const source = document.querySelector<HTMLTextAreaElement>(
			".ghost-card-html-editor",
		);
		expect(source).not.toBeNull();

		fireEvent.change(source!, {
			target: {value: "<div>Hi</div>"},
		});

		expect(document.querySelector(".ghost-card-html-editor")).not.toBeNull();
		expect(document.querySelector(".ghost-card-html-content")).toBeNull();
		expect(
			document.querySelector<HTMLTextAreaElement>(".ghost-card-html-editor")
				?.value,
		).toBe("<div>Hi</div>");
	});

	it("finds HTML nested under a data field and matches the type case-insensitively", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "HTML", {
			type: "html",
			data: {html: "<p>Nested content</p>"},
		});

		render(node.decorate(editor, {} as EditorConfig));

		const content = document.querySelector(".ghost-card-html-content");
		expect(content?.innerHTML).toContain("Nested content");
	});

	it("renders interactive callout card and updates emoji, text, and color", async () => {
		const editor = createTestEditor();
		const node = createCard(editor, "callout", {
			type: "callout",
			version: 1,
			calloutText: "Initial callout",
			calloutEmoji: "💡",
			backgroundColor: "blue",
		});

		render(node.decorate(editor, {} as EditorConfig));

		expect(screen.getByText("callout")).toBeInTheDocument();
		const emojiInput = screen.getByTitle("Callout emoji") as HTMLInputElement;
		expect(emojiInput.value).toBe("💡");

		const textInput = screen.getByPlaceholderText("Callout text...") as HTMLTextAreaElement;
		expect(textInput.value).toBe("Initial callout");

		// Change emoji
		fireEvent.change(emojiInput, {target: {value: "🔥"}});
		// Change text
		fireEvent.change(textInput, {target: {value: "Updated callout"}});

		// Click green swatch
		const greenSwatch = screen.getByTitle("green");
		fireEvent.click(greenSwatch);

		await waitFor(() => {
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.calloutEmoji).toBe("🔥");
			expect(currentData.calloutText).toBe("Updated callout");
			expect(currentData.backgroundColor).toBe("green");
		});
	});

	it("renders interactive button card and updates buttonText and alignment", async () => {
		const editor = createTestEditor();
		const node = createCard(editor, "button", {
			type: "button",
			version: 1,
			buttonText: "Click me",
			buttonUrl: "https://example.com",
			alignment: "center",
		});

		render(node.decorate(editor, {} as EditorConfig));

		const textInput = screen.getByPlaceholderText("Button text...") as HTMLInputElement;
		expect(textInput.value).toBe("Click me");

		fireEvent.change(textInput, {target: {value: "Get Started"}});

		const leftBtn = screen.getByRole("button", {name: "Left"});
		fireEvent.click(leftBtn);

		await waitFor(() => {
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.buttonText).toBe("Get Started");
			expect(currentData.alignment).toBe("left");
		});
	});

	it("renders paywall public preview card divider", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "paywall", {
			type: "paywall",
			version: 1,
		});

		render(node.decorate(editor, {} as EditorConfig));

		expect(screen.getByText("paywall")).toBeInTheDocument();
		expect(
			screen.getByText("— Public Preview / Members Only —"),
		).toBeInTheDocument();
	});

	it("removes card when delete button is clicked", async () => {
		const editor = createTestEditor();
		const node = createCard(editor, "bookmark", {
			type: "bookmark",
			version: 1,
			url: "https://ghost.org",
		});

		render(node.decorate(editor, {} as EditorConfig));

		const deleteBtn = screen.getByRole("button", {name: "Delete card"});
		expect(deleteBtn).toBeInTheDocument();

		fireEvent.click(deleteBtn);

		await waitFor(() => {
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				expect(current).toBeNull();
			});
		});
	});

	it("allows toggling and editing in JSON / Inspect payload mode", async () => {
		const editor = createTestEditor();
		const node = createCard(editor, "toggle", {
			type: "toggle",
			version: 1,
			heading: "FAQ Question",
			content: "FAQ Answer",
		});

		render(node.decorate(editor, {} as EditorConfig));

		const inspectBtn = screen.getByRole("button", {name: "Inspect payload"});
		fireEvent.click(inspectBtn);

		const jsonTextarea = document.querySelector<HTMLTextAreaElement>(
			".ghost-card-json-textarea",
		);
		expect(jsonTextarea).not.toBeNull();
		expect(jsonTextarea?.value).toContain("FAQ Question");

		const newPayload = {
			type: "toggle",
			version: 1,
			heading: "Updated Question",
			content: "Updated Answer",
		};
		fireEvent.change(jsonTextarea!, {
			target: {value: JSON.stringify(newPayload, null, 2)},
		});

		await waitFor(() => {
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.heading).toBe("Updated Question");
			expect(currentData.content).toBe("Updated Answer");
		});
	});

	it("auto-fetches bookmark metadata via fetchEmbed on blur or button click", async () => {
		const site: Site = {
			base: "https://example.com",
			siteUrl: "https://example.com/",
			title: "Test Site",
			version: "6.68",
			keyKind: "staff",
			role: "Owner",
			clockOffset: 0,
		};

		vi.mocked(fetchEmbed).mockResolvedValue({
			url: "https://ghost.org/docs/",
			metadata: {
				title: "Ghost Documentation",
				description: "Official Ghost developer docs",
				icon: "https://ghost.org/favicon.ico",
				author: "Ghost Foundation",
				publisher: "Ghost",
				thumbnail: "https://ghost.org/thumb.png",
			},
		});

		const editor = createTestEditor();
		const node = createCard(editor, "bookmark", {
			type: "bookmark",
			version: 1,
			url: "https://ghost.org/docs",
			metadata: {},
		});

		render(
			<LabSiteContext.Provider value={{site}}>
				{node.decorate(editor, {} as EditorConfig)}
			</LabSiteContext.Provider>,
		);

		const fetchBtn = screen.getByTestId("fetch-embed-button");
		fireEvent.click(fetchBtn);

		await waitFor(() => {
			expect(fetchEmbed).toHaveBeenCalledWith(
				site,
				"https://ghost.org/docs",
				"bookmark",
			);
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.url).toBe("https://ghost.org/docs/");
			expect(currentData.metadata.title).toBe("Ghost Documentation");
			expect(currentData.metadata.description).toBe(
				"Official Ghost developer docs",
			);
			expect(currentData.metadata.publisher).toBe("Ghost");
		});
	});

	it("fetches embed html and embedType via fetchEmbed on blur when empty", async () => {
		const site: Site = {
			base: "https://example.com",
			siteUrl: "https://example.com/",
			title: "Test Site",
			version: "6.68",
			keyKind: "staff",
			role: "Owner",
			clockOffset: 0,
		};

		vi.mocked(fetchEmbed).mockResolvedValue({
			type: "video",
			html: '<iframe src="https://www.youtube.com/embed/123"></iframe>',
			metadata: {title: "Demo Video"},
		});

		const editor = createTestEditor();
		const node = createCard(editor, "embed", {
			type: "embed",
			version: 1,
			url: "https://youtube.com/watch?v=123",
			html: "",
			metadata: {},
		});

		const {rerender} = render(
			<LabSiteContext.Provider value={{site}}>
				{node.decorate(editor, {} as EditorConfig)}
			</LabSiteContext.Provider>,
		);

		const urlInput = screen.getByPlaceholderText(
			"https://youtube.com/watch?v=...",
		);
		fireEvent.blur(urlInput);

		await waitFor(() => {
			expect(fetchEmbed).toHaveBeenCalledWith(
				site,
				"https://youtube.com/watch?v=123",
				"embed",
			);
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.embedType).toBe("video");
			expect(currentData.html).toContain("youtube.com/embed/123");
			expect(currentData.metadata.title).toBe("Demo Video");
		});

		editor.getEditorState().read(() => {
			const current = $getNodeByKey(node.getKey());
			if ($isGhostCardNode(current)) {
				rerender(
					<LabSiteContext.Provider value={{site}}>
						{current.decorate(editor, {} as EditorConfig)}
					</LabSiteContext.Provider>,
				);
			}
		});

		const iframe = document.querySelector<HTMLIFrameElement>(
			".ghost-card-embed-iframe",
		);
		expect(iframe).not.toBeNull();
		expect(iframe?.getAttribute("sandbox")).toBe(
			"allow-scripts allow-same-origin",
		);
		expect(iframe?.getAttribute("srcdoc")).toBe(
			'<iframe src="https://www.youtube.com/embed/123"></iframe>',
		);
	});

	it("toggles cardWidth between regular, wide, and full on image/video/gallery cards", async () => {
		const editor = createTestEditor();
		const node = createCard(editor, "image", {
			type: "image",
			version: 1,
			src: "https://example.com/photo.jpg",
			cardWidth: "regular",
		});

		const {rerender} = render(node.decorate(editor, {} as EditorConfig));

		const preview = document.querySelector(".ghost-card-preview");
		expect(preview).toHaveAttribute("data-card-width", "regular");

		const selector = screen.getByTestId("card-width-selector");
		expect(selector).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("card-width-wide"));

		await waitFor(() => {
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.cardWidth).toBe("wide");
		});

		editor.getEditorState().read(() => {
			const current = $getNodeByKey(node.getKey());
			if ($isGhostCardNode(current)) {
				rerender(current.decorate(editor, {} as EditorConfig));
			}
		});
		expect(document.querySelector(".ghost-card-preview")).toHaveAttribute(
			"data-card-width",
			"wide",
		);

		fireEvent.click(screen.getByTestId("card-width-full"));

		await waitFor(() => {
			let currentData: any;
			editor.getEditorState().read(() => {
				const current = $getNodeByKey(node.getKey());
				if ($isGhostCardNode(current)) {
					currentData = current.getData();
				}
			});
			expect(currentData.cardWidth).toBe("full");
		});
	});

	it("prevents accidental navigation when clicking external links in HTML preview", () => {
		const editor = createTestEditor();
		const node = createCard(editor, "html", {
			type: "html",
			html: '<p><a href="https://example.com/out">External</a> <a href="#fn1">Anchor</a></p>',
		});

		render(node.decorate(editor, {} as EditorConfig));

		const extLink = screen.getByText("External");
		expect(extLink).toHaveAttribute("rel", "noopener noreferrer");
		const extClick = new MouseEvent("click", {bubbles: true, cancelable: true});
		extLink.dispatchEvent(extClick);
		expect(extClick.defaultPrevented).toBe(true);

		const anchorLink = screen.getByText("Anchor");
		const anchorClick = new MouseEvent("click", {bubbles: true, cancelable: true});
		anchorLink.dispatchEvent(anchorClick);
		expect(anchorClick.defaultPrevented).toBe(false);
	});
});

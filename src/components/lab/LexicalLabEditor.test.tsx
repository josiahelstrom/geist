// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
	fetchPost,
	listActiveNewsletters,
	type PostDetail,
	type Site,
} from "../../lib/api";
import {createScrap, demoteDraftToScrap} from "../../lib/scraps";
import {
	deletePost,
	publishWithNewsletter,
	setPostStatus,
	unschedulePost,
} from "../../lib/posts";
import {loadSiteSettings, DEFAULT_SETTINGS} from "../../lib/cardConfig";
import {createSaver} from "../../lib/saver";
import {getUiPrefs, setUiPrefs} from "../../lib/uiPrefs";
import LexicalLabEditor from "./LexicalLabEditor";

vi.mock("../../lib/api", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/api")>();
	return {
		...actual,
		fetchPost: vi.fn(),
		listActiveNewsletters: vi.fn().mockResolvedValue([]),
	};
});

vi.mock("../../lib/cardConfig", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/cardConfig")>();
	return {
		...actual,
		loadSiteSettings: vi.fn().mockResolvedValue({
			...actual.DEFAULT_SETTINGS,
			membersEnabled: true,
		}),
	};
});

vi.mock("../../lib/scraps", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/scraps")>();
	return {...actual, demoteDraftToScrap: vi.fn()};
});

vi.mock("../../lib/posts", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/posts")>();
	return {
		...actual,
		deletePost: vi.fn(),
		publishWithNewsletter: vi.fn(),
		setPostStatus: vi.fn(),
		unschedulePost: vi.fn(),
	};
});

vi.mock("../../lib/saver", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/saver")>();
	return {
		...actual,
		createSaver: vi.fn((...args: Parameters<typeof actual.createSaver>) => {
			const s = actual.createSaver(...args);
			vi.spyOn(s, "flush").mockResolvedValue(undefined);
			return s;
		}),
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const SITE: Site = {
	base: "https://example.com",
	siteUrl: "https://example.com/",
	title: "Test Publication",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

describe("LexicalLabEditor", () => {
	it("loads and renders a scrap with title and editor content", async () => {
		const scrap = await createScrap(SITE.base, {
			title: "My Lab Scrap",
		});

		const onBack = vi.fn();
		render(
			<LexicalLabEditor
				site={SITE}
				scrapId={scrap.id}
				onBack={onBack}
			/>,
		);

		// Initially shows loading or resolves to content
		await waitFor(() => {
			expect(screen.getByDisplayValue("My Lab Scrap")).toBeInTheDocument();
		});

		expect(screen.getByText("Lexical Lab")).toBeInTheDocument();
		expect(screen.getByText("← Back")).toBeInTheDocument();

		const backBtn = screen.getByText("← Back");
		await userEvent.click(backBtn);
		expect(onBack).toHaveBeenCalled();
	});

	it("renders scrap with GhostCardNode without crashing", async () => {
		const cardLexical = JSON.stringify({
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
								type: "text",
								text: "Note before card",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
					{
						type: "image",
						src: "https://example.com/pic.jpg",
						caption: "Sample",
						version: 1,
					},
				],
			},
		});

		const scrap = await createScrap(SITE.base, {
			title: "Card Scrap",
			lexical: cardLexical,
		});

		render(<LexicalLabEditor site={SITE} scrapId={scrap.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Card Scrap")).toBeInTheDocument();
		});

		await waitFor(() => {
			expect(screen.getByText("Ghost Card")).toBeInTheDocument();
			expect(screen.getByText("image")).toBeInTheDocument();
		});
	});

	it("renders reconnect button on error if onReconnect is provided", async () => {		const onReconnect = vi.fn();
		render(
			<LexicalLabEditor
				site={SITE}
				scrapId="nonexistent-id"
				onReconnect={onReconnect}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Scrap not found.")).toBeInTheDocument();
		});

		const reconnectBtn = screen.getByText("Reconnect site");
		expect(reconnectBtn).toBeInTheDocument();
		await userEvent.click(reconnectBtn);
		expect(onReconnect).toHaveBeenCalled();
	});

	it("guards against no-op updates and does not trigger save on initial load", async () => {
		const onSave = vi.fn();
		const scrap = await createScrap(SITE.base, {
			title: "No-op Test",
		});

		render(
			<LexicalLabEditor
				site={SITE}
				scrapId={scrap.id}
				onSave={onSave}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("No-op Test")).toBeInTheDocument();
		});

		// Save status should be clean ("Saved") on mount, not "Saving..."
		expect(screen.getByTestId("save-status")).toHaveTextContent("Saved");
		expect(onSave).not.toHaveBeenCalled();
	});

	it("renders badge indicating Lexical Lab with hover hint and switches engine to koenig on click", async () => {
		setUiPrefs({editorEngine: "lexical-lab"});
		const scrap = await createScrap(SITE.base, {
			title: "Engine Badge Test",
		});

		render(
			<LexicalLabEditor
				site={SITE}
				scrapId={scrap.id}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Engine Badge Test")).toBeInTheDocument();
		});

		const badge = screen.getByText("Lexical Lab");
		expect(badge).toBeInTheDocument();
		expect(badge).toHaveAttribute("title", "⌥⌘E to switch to Koenig");

		await userEvent.click(badge);
		await waitFor(() => {
			expect(getUiPrefs().editorEngine).toBe("koenig");
		});
	});

	it("renders scrap with extended-quote and footnotes UI", async () => {
		const docWithFootnotes = JSON.stringify({
			root: {
				type: "root",
				format: "",
				indent: 0,
				version: 1,
				children: [
					{
						type: "extended-quote",
						format: "",
						indent: 0,
						version: 1,
						children: [
							{
								type: "text",
								text: "Blockquote quote text",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
					{
						type: "paragraph",
						format: "",
						indent: 0,
						version: 1,
						children: [
							{
								type: "text",
								text: "A claim with footnote",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
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
						html: `<hr class="footnotes-sep">\n<section class="footnotes">\n  <ol class="footnotes-list">\n    <li id="fn1" class="footnote-item">\n      <p>Source definition text. <a href="#fnref1" class="footnote-backref">↩</a></p>\n    </li>\n  </ol>\n</section>`,
					},
				],
			},
		});

		const scrap = await createScrap(SITE.base, {
			title: "Footnotes Scrap",
			lexical: docWithFootnotes,
		});

		render(<LexicalLabEditor site={SITE} scrapId={scrap.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Footnotes Scrap")).toBeInTheDocument();
		});

		// Check that blockquote text rendered
		await waitFor(() => {
			expect(screen.getByText("Blockquote quote text")).toBeInTheDocument();
		});

		// Check that footnote reference badge rendered in editor and footnotes list
		expect(screen.getAllByText("[1]")).toHaveLength(2);
		const fnBadge = document.querySelector(".lexical-lab-fn-ref");
		expect(fnBadge).toHaveAttribute("data-label", "1");

		// Check that footnotes section rendered and extracted definition
		expect(screen.getByTestId("footnotes-section")).toBeInTheDocument();
		expect(
			screen.getByDisplayValue("Source definition text."),
		).toBeInTheDocument();

		// User can add a new footnote
		const addBtn = screen.getByText("+ Add Footnote");
		await userEvent.click(addBtn);

		await waitFor(() => {
			expect(screen.getByText("[2]")).toBeInTheDocument();
		});
	});

	it("renders a rich preview for HTML and Markdown footnote definitions", async () => {
		const docWithFormattedFootnotes = JSON.stringify({
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
								type: "text",
								text: "A claim with footnotes",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
							{
								type: "link",
								version: 1,
								url: "#fn1",
								children: [
									{type: "text", version: 1, text: "1", format: 64},
								],
							},
							{
								type: "link",
								version: 1,
								url: "#fn2",
								children: [
									{type: "text", version: 1, text: "2", format: 64},
								],
							},
						],
					},
					{
						type: "html",
						version: 1,
						html: `<hr class="footnotes-sep">\n<section class="footnotes">\n  <ol class="footnotes-list">\n    <li id="fn1" class="footnote-item">\n      <p>Baruch Spinoza, <i>Treatise</i>. <a href="#fnref1" class="footnote-backref">↩</a></p>\n    </li>\n    <li id="fn2" class="footnote-item">\n      <p>See *Ethics* and **Politics**. <a href="#fnref2" class="footnote-backref">↩</a></p>\n    </li>\n  </ol>\n</section>`,
					},
				],
			},
		});

		const scrap = await createScrap(SITE.base, {
			title: "Formatted Footnotes",
			lexical: docWithFormattedFootnotes,
		});

		render(<LexicalLabEditor site={SITE} scrapId={scrap.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Formatted Footnotes")).toBeInTheDocument();
		});

		// Raw definition text stays editable, including its HTML/Markdown.
		const htmlInput = await screen.findByDisplayValue(
			"Baruch Spinoza, <i>Treatise</i>.",
		);
		expect(htmlInput.tagName).toBe("TEXTAREA");

		// HTML tags are rendered, not shown as escaped text.
		const htmlPreview = await screen.findByTestId("footnote-preview-1");
		expect(htmlPreview.querySelector("i")).toHaveTextContent("Treatise");
		expect(htmlPreview).not.toHaveTextContent("<i>");

		// Markdown emphasis becomes styled text in the preview.
		const markdownPreview = await screen.findByTestId("footnote-preview-2");
		expect(markdownPreview.querySelector("em")).toHaveTextContent("Ethics");
		expect(markdownPreview.querySelector("strong")).toHaveTextContent("Politics");
	});

	it("saves footnote updates immediately after load without needing to type in the body", async () => {
		const docWithFootnotes = JSON.stringify({
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
								type: "text",
								text: "Claim with footnote",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
							{
								type: "link",
								format: "",
								indent: 0,
								version: 1,
								url: "#fn1",
								children: [
									{
										type: "text",
										text: "1",
										detail: 0,
										format: 64,
										mode: "normal",
										style: "",
										version: 1,
									},
								],
							},
						],
					},
					{
						type: "html",
						version: 1,
						html: `<hr class="footnotes-sep">\n<section class="footnotes">\n  <ol class="footnotes-list">\n    <li id="fn1" class="footnote-item">\n      <p>Initial definition text. <a href="#fnref1" class="footnote-backref">↩</a></p>\n    </li>\n  </ol>\n</section>`,
					},
				],
			},
		});

		const scrap = await createScrap(SITE.base, {
			title: "Footnotes Immediate Edit Scrap",
			lexical: docWithFootnotes,
		});

		const onSave = vi.fn();
		render(
			<LexicalLabEditor
				site={SITE}
				scrapId={scrap.id}
				onSave={onSave}
			/>,
		);

		await waitFor(() => {
			expect(
				screen.getByDisplayValue("Initial definition text."),
			).toBeInTheDocument();
		});

		const textarea = screen.getByDisplayValue("Initial definition text.");
		await userEvent.clear(textarea);
		await userEvent.type(textarea, "Updated definition text.");

		await waitFor(() => {
			expect(onSave).toHaveBeenCalled();
		});

		const lastCallArg = onSave.mock.calls[onSave.mock.calls.length - 1][0];
		expect(lastCallArg).toContain("Updated definition text.");
	});

	it("renders delete scrap and promote to draft buttons when editing a scrap", async () => {
		const scrap = await createScrap(SITE.base, {
			title: "Buttons Test Scrap",
		});
		const onBack = vi.fn();
		const onOpenPost = vi.fn();

		render(
			<LexicalLabEditor
				site={SITE}
				scrapId={scrap.id}
				onBack={onBack}
				onOpenPost={onOpenPost}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Buttons Test Scrap")).toBeInTheDocument();
		});

		const deleteBtn = screen.getByTestId("delete-scrap-button");
		const promoteBtn = screen.getByTestId("promote-scrap-button");

		expect(deleteBtn).toBeInTheDocument();
		expect(promoteBtn).toBeInTheDocument();

		await userEvent.click(deleteBtn);
		expect(onBack).toHaveBeenCalled();
	});

	it("renders inspector toggle button and shows demote and delete buttons when sidebar is open", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const toggleBtn = screen.getByTestId("toggle-sidebar-button");
		expect(toggleBtn).toBeInTheDocument();
		expect(screen.queryByTestId("demote-to-scrap-button")).not.toBeInTheDocument();
		expect(screen.queryByTestId("delete-post-button")).not.toBeInTheDocument();

		await userEvent.click(toggleBtn);

		expect(screen.getByTestId("demote-to-scrap-button")).toBeInTheDocument();
		expect(screen.getByTestId("delete-post-button")).toBeInTheDocument();
	});

	it("demotes a draft post to a scrap and opens it", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);
		const scrap = await createScrap(SITE.base, {title: "Demoted Scrap"});
		vi.mocked(demoteDraftToScrap).mockResolvedValue(scrap);

		const onOpenScrap = vi.fn();
		const onBack = vi.fn();

		render(
			<LexicalLabEditor
				site={SITE}
				postId={post.id}
				onBack={onBack}
				onOpenScrap={onOpenScrap}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		await userEvent.click(screen.getByTestId("toggle-sidebar-button"));
		await userEvent.click(screen.getByTestId("demote-to-scrap-button"));

		await waitFor(() => {
			expect(demoteDraftToScrap).toHaveBeenCalledWith(SITE, post);
		});
		expect(onOpenScrap).toHaveBeenCalledWith(scrap);
		expect(onBack).not.toHaveBeenCalled();
	});

	it("deletes a post and navigates back", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);
		vi.mocked(deletePost).mockResolvedValue(undefined);

		const onBack = vi.fn();
		render(<LexicalLabEditor site={SITE} postId={post.id} onBack={onBack} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		await userEvent.click(screen.getByTestId("toggle-sidebar-button"));
		await userEvent.click(screen.getByTestId("delete-post-button"));

		await waitFor(() => {
			expect(deletePost).toHaveBeenCalledWith(SITE, post.id);
		});
		expect(onBack).toHaveBeenCalled();
	});

	it("disables demote for non-draft posts", async () => {
		const post = {...draftPost(), status: "published" as const};
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		await userEvent.click(screen.getByTestId("toggle-sidebar-button"));
		expect(screen.getByTestId("demote-to-scrap-button")).toBeDisabled();
	});

	it("renders MetadataSidebar when toggle-sidebar-button is clicked", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		expect(screen.queryByLabelText("Post settings")).not.toBeInTheDocument();

		const toggleBtn = screen.getByTestId("toggle-sidebar-button");
		await userEvent.click(toggleBtn);

		expect(screen.getByLabelText("Post settings")).toBeInTheDocument();
		expect(toggleBtn).toHaveClass("is-active");
		expect(toggleBtn).toHaveAttribute("aria-pressed", "true");

		await userEvent.click(toggleBtn);
		expect(screen.queryByLabelText("Post settings")).not.toBeInTheDocument();
		expect(toggleBtn).not.toHaveClass("is-active");
		expect(toggleBtn).toHaveAttribute("aria-pressed", "false");
	});

	it("toggling showFeatureImage updates the canvas feature image", async () => {
		setUiPrefs({showFeatureImage: true});
		const post = {
			...draftPost(),
			feature_image: "https://example.com/hero.jpg",
			feature_image_alt: "Hero image",
			feature_image_caption: "Caption text",
		};
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		expect(screen.getByTestId("editor-feature-image")).toBeInTheDocument();
		expect(screen.getByAltText("Hero image")).toBeInTheDocument();
		expect(screen.getByText("Caption text")).toBeInTheDocument();

		await userEvent.click(screen.getByTestId("toggle-sidebar-button"));
		const checkbox = screen.getByTestId("show-feature-image-checkbox");
		expect(checkbox).toBeChecked();

		await userEvent.click(checkbox);
		expect(screen.queryByTestId("editor-feature-image")).not.toBeInTheDocument();

		await userEvent.click(checkbox);
		expect(screen.getByTestId("editor-feature-image")).toBeInTheDocument();
	});

	it("toggling alwaysShowExcerpt updates inline excerpt visibility", async () => {
		setUiPrefs({alwaysShowExcerpt: false});
		const post = {
			...draftPost(),
			custom_excerpt: "",
		};
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		expect(screen.queryByTestId("excerpt-input-inline")).not.toBeInTheDocument();

		await userEvent.click(screen.getByTestId("toggle-sidebar-button"));
		const excerptCheckbox = screen.getByTestId("always-show-excerpt-checkbox");
		expect(excerptCheckbox).not.toBeChecked();

		await userEvent.click(excerptCheckbox);
		expect(screen.getByTestId("excerpt-input-inline")).toBeInTheDocument();

		await userEvent.click(excerptCheckbox);
		expect(screen.queryByTestId("excerpt-input-inline")).not.toBeInTheDocument();
	});

	it("toggling editorFont updates canvas data-editor-font", async () => {
		setUiPrefs({editorFont: "sans"});
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const canvas = document.querySelector(".lexical-lab-canvas");
		expect(canvas).toHaveAttribute("data-editor-font", "sans");

		await userEvent.click(screen.getByTestId("toggle-sidebar-button"));
		const monoOption = screen.getByTestId("font-option-mono");
		await userEvent.click(monoOption);

		expect(canvas).toHaveAttribute("data-editor-font", "mono");

		const serifOption = screen.getByTestId("font-option-serif");
		await userEvent.click(serifOption);

		expect(canvas).toHaveAttribute("data-editor-font", "serif");
	});

	it("reflects typewriter mode attribute on canvas", async () => {
		setUiPrefs({typewriterMode: true});
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const canvas = document.querySelector(".lexical-lab-canvas");
		expect(canvas).toHaveAttribute("data-typewriter", "on");

		setUiPrefs({typewriterMode: false});
		await waitFor(() => {
			expect(canvas).not.toHaveAttribute("data-typewriter");
		});
	});

	it("adjusts .app-shell-body.scrollTop toward 48% target height when typewriterMode is enabled", async () => {
		setUiPrefs({typewriterMode: true});
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		const {container: testContainer} = render(
			<div className="app-shell-body">
				<LexicalLabEditor site={SITE} postId={post.id} />
			</div>,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const appShellBody = testContainer.querySelector<HTMLElement>(".app-shell-body")!;
		let currentScrollTop = 0;
		Object.defineProperty(appShellBody, "scrollTop", {
			get: () => currentScrollTop,
			set: (val: number) => {
				currentScrollTop = val;
			},
			configurable: true,
		});
		Object.defineProperty(appShellBody, "clientHeight", {
			value: 1000,
			configurable: true,
		});
		vi.spyOn(appShellBody, "getBoundingClientRect").mockReturnValue({
			top: 100,
			bottom: 1100,
			left: 0,
			right: 800,
			width: 800,
			height: 1000,
			x: 0,
			y: 100,
			toJSON: () => {},
		});

		const editable = document.querySelector<HTMLElement>(".lexical-lab-contenteditable")!;
		expect(editable).toBeInTheDocument();
		editable.focus();

		const mockRangeRect = {
			top: 690,
			bottom: 710,
			height: 20,
			left: 50,
			right: 150,
			width: 100,
			x: 50,
			y: 690,
			toJSON: () => {},
		};
		let currentRangeRect = mockRangeRect;
		const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;
		try {
			Range.prototype.getBoundingClientRect = () =>
				currentRangeRect as unknown as DOMRect;

			const selection = window.getSelection()!;
			const range = document.createRange();
			range.selectNodeContents(editable);
			range.collapse(true);
			selection.removeAllRanges();
			selection.addRange(range);

			// Trigger selectionchange
			document.dispatchEvent(new Event("selectionchange"));

			await waitFor(() => {
				expect(appShellBody.scrollTop).toBe(120);
			});

			// Now move caret rect down by 220px
			currentRangeRect = {
				...mockRangeRect,
				top: 790,
				bottom: 810,
				y: 790,
			};

			// Trigger input
			document.dispatchEvent(new Event("input"));

			await waitFor(() => {
				expect(appShellBody.scrollTop).toBe(120 + 220);
			});
		} finally {
			Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;
		}
	});

	it("displays word count and reading time in footer pill", async () => {
		const text10Words = "word ".repeat(10).trim();
		const doc = JSON.stringify({
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
								type: "text",
								text: text10Words,
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
				],
			},
		});

		const scrap = await createScrap(SITE.base, {
			title: "Word Count Test",
			lexical: doc,
		});

		render(<LexicalLabEditor site={SITE} scrapId={scrap.id} />);

		await waitFor(() => {
			expect(screen.getByTestId("word-count")).toHaveTextContent(
				"10 words · 1 min read",
			);
		});
	});

	it("title Enter key focuses excerpt when visible, or body when excerpt hidden", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		// 1. Excerpt hidden -> focuses .lexical-lab-contenteditable
		setUiPrefs({alwaysShowExcerpt: false});
		const {unmount} = render(
			<LexicalLabEditor site={SITE} postId={post.id} />,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const titleInput = screen.getByDisplayValue("Draft Post");
		const contentEditable = document.querySelector<HTMLElement>(
			".lexical-lab-contenteditable",
		)!;
		const focusSpy = vi.spyOn(contentEditable, "focus");

		fireEvent.keyDown(titleInput, {key: "Enter", shiftKey: false});
		expect(focusSpy).toHaveBeenCalled();

		unmount();

		// 2. Excerpt shown -> focuses excerpt textarea
		setUiPrefs({alwaysShowExcerpt: true});
		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByTestId("excerpt-input-inline")).toBeInTheDocument();
		});

		const titleInput2 = screen.getByDisplayValue("Draft Post");
		const excerptInput = screen.getByTestId("excerpt-input-inline");
		const excerptFocusSpy = vi.spyOn(excerptInput, "focus");

		fireEvent.keyDown(titleInput2, {key: "Enter", shiftKey: false});
		expect(excerptFocusSpy).toHaveBeenCalled();
	});

	it("triggers saver.flush(true) on ⌘S and custom geist:save-revision event", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const saverInstance = vi.mocked(createSaver).mock.results[0]?.value;
		expect(saverInstance).toBeDefined();

		fireEvent.keyDown(window, {key: "s", metaKey: true});
		await waitFor(() => {
			expect(saverInstance.flush).toHaveBeenCalledWith(true);
		});

		window.dispatchEvent(new CustomEvent("geist:save-revision"));
		await waitFor(() => {
			expect(saverInstance.flush).toHaveBeenCalledTimes(2);
		});
	});

	it("opens the Revisions drawer and Publish modal when editing a post", async () => {
		const post = {
			...draftPost(),
			post_revisions: [
				{
					id: "rev-1",
					post_id: "post-1",
					title: "Past Revision",
					lexical: draftPost().lexical,
					created_at: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		// Status badge should show draft
		expect(screen.getByTestId("post-status-badge")).toHaveTextContent("draft");

		// Open Revisions drawer
		const revisionsBtn = screen.getByTestId("toggle-revisions-button");
		await userEvent.click(revisionsBtn);

		await waitFor(() => {
			expect(screen.getByTestId("revisions-drawer")).toBeInTheDocument();
			expect(screen.getByText("Post history")).toBeInTheDocument();
		});

		// Close revisions drawer
		await userEvent.click(revisionsBtn);
		await waitFor(() => {
			expect(screen.queryByTestId("revisions-drawer")).not.toBeInTheDocument();
		});

		// Open Publish modal
		const publishBtn = screen.getByTestId("open-publish-modal-button");
		await userEvent.click(publishBtn);

		await waitFor(() => {
			expect(screen.getByRole("dialog")).toBeInTheDocument();
			expect(
				screen.getByRole("button", {name: "Publish now"}),
			).toBeInTheDocument();
		});
	});

	it("ignores repeated ⌘S keydown events (e.repeat)", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const saverInstance = vi.mocked(createSaver).mock.results[0]?.value;
		expect(saverInstance).toBeDefined();

		fireEvent.keyDown(window, {key: "s", metaKey: true, repeat: true});
		expect(saverInstance.flush).not.toHaveBeenCalled();

		fireEvent.keyDown(window, {key: "s", metaKey: true, repeat: false});
		await waitFor(() => {
			expect(saverInstance.flush).toHaveBeenCalledWith(true);
		});
	});

	it("handlePublishAction forwards confirmedRecipientCount when publishing with newsletter", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);
		vi.mocked(listActiveNewsletters).mockResolvedValue([
			{
				id: "nl-1",
				name: "Weekly Digest",
				slug: "weekly-digest",
				status: "active",
				count: {active_members: 1420},
			},
		]);
		vi.mocked(loadSiteSettings).mockResolvedValue({
			...DEFAULT_SETTINGS,
			membersEnabled: true,
		});
		vi.mocked(publishWithNewsletter).mockResolvedValue({
			status: "published",
			updated_at: "2026-01-02T00:00:00.000Z",
		});

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		await userEvent.click(screen.getByTestId("open-publish-modal-button"));

		const webAndEmailRadio = await screen.findByRole("radio", {
			name: "Web + Email",
		});
		await userEvent.click(webAndEmailRadio);

		const confirmCheckbox = screen.getByRole("checkbox", {
			name: /I confirm sending this email to subscribers of/i,
		});
		await userEvent.click(confirmCheckbox);

		const submitBtn = screen.getByRole("button", {
			name: "Publish and send email",
		});
		await userEvent.click(submitBtn);

		await waitFor(() => {
			expect(publishWithNewsletter).toHaveBeenCalledWith(
				SITE,
				post.id,
				post.updated_at,
				{
					newsletterSlug: "weekly-digest",
					emailSegment: "all",
					emailOnly: false,
					confirmedRecipientCount: 1420,
				},
			);
		});
	});

	it("handlePublishAction aborts without calling publish API if save fails and renders actionError banner without unmounting editor", async () => {
		const post = draftPost();
		vi.mocked(fetchPost).mockResolvedValue(post);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const saverInstance = vi.mocked(createSaver).mock.results[0]?.value;
		Object.defineProperty(saverInstance, "lastError", {
			get: () => new Error("Save failed"),
			configurable: true,
		});

		await userEvent.click(screen.getByTestId("open-publish-modal-button"));
		await userEvent.click(screen.getByRole("button", {name: "Publish now"}));

		await waitFor(() => {
			expect(screen.getByTestId("action-error-banner")).toHaveTextContent(
				"Could not save your latest edits, so publishing was cancelled.",
			);
		});

		expect(setPostStatus).not.toHaveBeenCalled();
		expect(publishWithNewsletter).not.toHaveBeenCalled();
		// Editor remains mounted with its title input intact
		expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();

		// Dismissing the banner clears it
		await userEvent.click(screen.getByTestId("dismiss-action-error-button"));
		expect(screen.queryByTestId("action-error-banner")).not.toBeInTheDocument();
	});

	it("handleUnschedule clears published_at and returns post to draft", async () => {
		const scheduledPost: PostDetail = {
			...draftPost(),
			status: "scheduled",
			published_at: "2026-12-01T12:00:00.000Z",
		};
		vi.mocked(fetchPost).mockResolvedValue(scheduledPost);
		vi.mocked(unschedulePost).mockResolvedValue({
			status: "draft",
			updated_at: "2026-01-03T00:00:00.000Z",
		});
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

		render(<LexicalLabEditor site={SITE} postId={scheduledPost.id} />);

		await waitFor(() => {
			expect(screen.getByTestId("scheduled-hint")).toBeInTheDocument();
		});

		await userEvent.click(screen.getByTestId("unschedule-button"));

		await waitFor(() => {
			expect(unschedulePost).toHaveBeenCalledWith(
				SITE,
				scheduledPost.id,
				scheduledPost.updated_at,
			);
		});

		await waitFor(() => {
			expect(screen.getByTestId("post-status-badge")).toHaveTextContent("draft");
			expect(screen.queryByTestId("scheduled-hint")).not.toBeInTheDocument();
		});

		confirmSpy.mockRestore();
	});

	it("handleRestoreRevision surfaces actionError on queue failure without unmounting editor", async () => {
		const post: PostDetail = {
			...draftPost(),
			post_revisions: [
				{
					id: "rev-1",
					title: "Restored Title",
					lexical: draftPost().lexical,
					created_at: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		vi.mocked(fetchPost).mockResolvedValue(post);
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

		render(<LexicalLabEditor site={SITE} postId={post.id} />);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		const saverInstance = vi.mocked(createSaver).mock.results[0]?.value;
		vi.spyOn(saverInstance, "queue").mockRejectedValue(
			new Error("Failed to persist restored revision"),
		);

		await userEvent.click(screen.getByTestId("toggle-revisions-button"));
		const restoreBtn = await screen.findByTestId("restore-revision-button");
		await userEvent.click(restoreBtn);

		await waitFor(() => {
			expect(screen.getByTestId("action-error-banner")).toHaveTextContent(
				"Failed to persist restored revision",
			);
		});
		expect(screen.getByDisplayValue("Restored Title")).toBeInTheDocument();

		confirmSpy.mockRestore();
	});

	it("applies is-active-block to the focused top-level block on selection change and removes it from the previous block", async () => {
		const twoParagraphDoc = JSON.stringify({
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
								type: "text",
								text: "First paragraph text",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
					{
						type: "paragraph",
						format: "",
						indent: 0,
						version: 1,
						children: [
							{
								type: "text",
								text: "Second paragraph text",
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								version: 1,
							},
						],
					},
				],
			},
		});

		const scrap = await createScrap(SITE.base, {
			title: "Focus Dimming Test",
			lexical: twoParagraphDoc,
		});

		render(
			<div className="app-shell" data-focus="on">
				<LexicalLabEditor site={SITE} scrapId={scrap.id} />
			</div>,
		);

		await waitFor(() => {
			expect(screen.getByText("First paragraph text")).toBeInTheDocument();
			expect(screen.getByText("Second paragraph text")).toBeInTheDocument();
		});

		const p1 = screen.getByText("First paragraph text").closest("p")!;
		const p2 = screen.getByText("Second paragraph text").closest("p")!;
		expect(p1).not.toBeNull();
		expect(p2).not.toBeNull();

		// Select first paragraph
		const sel = window.getSelection()!;
		const range1 = document.createRange();
		range1.selectNodeContents(p1);
		range1.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range1);
		document.dispatchEvent(new Event("selectionchange"));

		await waitFor(() => {
			expect(p1).toHaveClass("is-active-block");
			expect(p2).not.toHaveClass("is-active-block");
		});

		// Move selection to second paragraph
		const range2 = document.createRange();
		range2.selectNodeContents(p2);
		range2.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range2);
		document.dispatchEvent(new Event("selectionchange"));

		await waitFor(() => {
			expect(p2).toHaveClass("is-active-block");
			expect(p1).not.toHaveClass("is-active-block");
		});
	});

	it("shows TK badge and PublishModal warning when standalone TK markers exist, and hides when none exist", async () => {
		const postWithoutTk = draftPost();
		vi.mocked(fetchPost).mockResolvedValueOnce(postWithoutTk);

		const {unmount} = render(
			<LexicalLabEditor site={SITE} postId={postWithoutTk.id} />,
		);

		await waitFor(() => {
			expect(screen.getByDisplayValue("Draft Post")).toBeInTheDocument();
		});

		expect(screen.queryByTestId("tk-badge")).not.toBeInTheDocument();
		unmount();

		const postWithTk: PostDetail = {
			...draftPost(),
			lexical: JSON.stringify({
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
									text: "Revenue grew by TK percent in TK year (not tk or TKTK).",
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
			}),
		};
		vi.mocked(fetchPost).mockResolvedValueOnce(postWithTk);

		render(<LexicalLabEditor site={SITE} postId={postWithTk.id} />);

		await waitFor(() => {
			const badge = screen.getByTestId("tk-badge");
			expect(badge).toBeInTheDocument();
			expect(badge).toHaveTextContent("TK · 2");
			expect(badge).toHaveAttribute(
				"title",
				"Editorial 'To Come' placeholders remaining in document",
			);
		});

		await userEvent.click(screen.getByTestId("open-publish-modal-button"));

		await waitFor(() => {
			expect(screen.getByTestId("tk-publish-warning")).toHaveTextContent(
				"2 unfinished “TK” placeholders in this post",
			);
		});
	});
});

function draftPost(): PostDetail {
	return {
		id: "post-1",
		uuid: "uuid-1",
		title: "Draft Post",
		status: "draft",
		updated_at: "2026-01-01T00:00:00.000Z",
		lexical: JSON.stringify({
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
								text: "Draft body",
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
		}),
	};
}

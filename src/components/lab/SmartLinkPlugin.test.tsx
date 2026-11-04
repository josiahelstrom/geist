// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {LexicalComposer} from "@lexical/react/LexicalComposer";
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin";
import {ContentEditable} from "@lexical/react/LexicalContentEditable";
import {LinkPlugin} from "@lexical/react/LexicalLinkPlugin";
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary";
import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getRoot,
	$setSelection,
	PASTE_COMMAND,
	type LexicalEditor,
} from "lexical";
import {useEffect} from "react";
import type {Site} from "../../lib/api";
import {LAB_NODES} from "../../lib/lab/labNodes";
import {searchLinks} from "../../lib/posts";
import {SmartLinkPlugin} from "./SmartLinkPlugin";

vi.mock("../../lib/posts", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/posts")>();
	return {
		...actual,
		searchLinks: vi.fn(),
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

if (
	typeof Range !== "undefined" &&
	typeof Range.prototype.getBoundingClientRect !== "function"
) {
	Range.prototype.getBoundingClientRect = () =>
		({
			top: 0,
			left: 0,
			bottom: 0,
			right: 0,
			width: 0,
			height: 0,
			x: 0,
			y: 0,
			toJSON: () => {},
		}) as DOMRect;
}

const SITE: Site = {
	base: "https://example.com",
	siteUrl: "https://example.com/",
	title: "Test Publication",
	version: "6.68",
	keyKind: "staff",
	role: "Owner",
	clockOffset: 0,
};

function EditorCapture({onEditor}: {onEditor: (editor: LexicalEditor) => void}) {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		onEditor(editor);
	}, [editor, onEditor]);
	return null;
}

function renderHarness(onEditor: (editor: LexicalEditor) => void) {
	return render(
		<LexicalComposer
			initialConfig={{
				namespace: "SmartLinkTest",
				nodes: LAB_NODES,
				onError: err => {
					throw err;
				},
			}}
		>
			<RichTextPlugin
				contentEditable={<ContentEditable data-testid="editor-editable" />}
				placeholder={null}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<LinkPlugin />
			<SmartLinkPlugin site={SITE} />
			<EditorCapture onEditor={onEditor} />
		</LexicalComposer>,
	);
}

describe("SmartLinkPlugin", () => {
	it("pasting a URL over selected text creates a link node preserving the selected text", async () => {
		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				const text = $createTextNode("Read my essay");
				p.append(text);
				root.append(p);

				const sel = $createRangeSelection();
				sel.anchor.set(text.getKey(), 5, "text");
				sel.focus.set(text.getKey(), 13, "text");
				$setSelection(sel);
			},
			{discrete: true},
		);

		const pasteEvent = {
			preventDefault: vi.fn(),
			clipboardData: {
				getData: (type: string) =>
					type === "text/plain" ? "https://example.com/essay" : "",
			},
		} as unknown as ClipboardEvent;

		editor.dispatchCommand(PASTE_COMMAND, pasteEvent);

		expect(pasteEvent.preventDefault).toHaveBeenCalled();

		await waitFor(() => {
			const json = editor.getEditorState().toJSON();
			const para = json.root.children[0] as any;
			const linkNode = para.children.find((c: any) => c.type === "link");
			expect(linkNode).toBeDefined();
			expect(linkNode.url).toBe("https://example.com/essay");
			expect(linkNode.children[0].text).toBe("my essay");
		});
	});

	it("⌘K opens the link popover, searches site links via searchLinks, and inserts a link", async () => {
		vi.mocked(searchLinks).mockImplementation(async (_site, term) => {
			if (term === "design") {
				return [
					{
						label: "Posts",
						items: [
							{
								title: "Design Systems in 2026",
								url: "https://example.com/design-systems/",
								metaText: "Published",
							},
						],
					},
				];
			}
			return [
				{
					label: "Site",
					items: [{title: "Homepage", url: "https://example.com/"}],
				},
			];
		});

		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				const text = $createTextNode("Check out ");
				p.append(text);
				root.append(p);
				text.selectEnd();
			},
			{discrete: true},
		);

		screen.getByTestId("editor-editable").focus();
		fireEvent.keyDown(window, {key: "k", metaKey: true});

		const input = await screen.findByTestId("smart-link-input");
		expect(input).toHaveAttribute(
			"placeholder",
			"Paste URL or search your posts...",
		);

		await waitFor(() => {
			expect(searchLinks).toHaveBeenCalledWith(SITE, "");
		});

		fireEvent.change(input, {target: {value: "design"}});

		await waitFor(() => {
			expect(searchLinks).toHaveBeenCalledWith(SITE, "design");
		});

		const option = await screen.findByRole("option");
		expect(option).toHaveTextContent("Design Systems in 2026");

		fireEvent.keyDown(input, {key: "Enter"});

		await waitFor(() => {
			expect(screen.queryByTestId("smart-link-input")).not.toBeInTheDocument();
		});

		const json = editor.getEditorState().toJSON();
		const para = json.root.children[0] as any;
		const linkNode = para.children.find((c: any) => c.type === "link");
		expect(linkNode).toBeDefined();
		expect(linkNode.url).toBe("https://example.com/design-systems/");
		expect(linkNode.children[0].text).toBe("Design Systems in 2026");
	});

	it("typing [[ in a paragraph opens popover and replaces [[query with post title link, and Escape closes popover", async () => {
		vi.mocked(searchLinks).mockResolvedValue([
			{
				label: "Posts",
				items: [
					{
						title: "Second Brain Guide",
						url: "https://example.com/second-brain/",
					},
				],
			},
		]);

		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				const p = $createParagraphNode();
				const text = $createTextNode("See [[brain");
				p.append(text);
				root.append(p);
				text.selectEnd();
			},
			{discrete: true},
		);

		const input = await screen.findByTestId("smart-link-input");
		expect(input).toHaveValue("brain");

		await screen.findByRole("listbox");
		fireEvent.keyDown(input, {key: "Enter"});

		await waitFor(() => {
			expect(screen.queryByTestId("smart-link-input")).not.toBeInTheDocument();
		});

		const json = editor.getEditorState().toJSON();
		const para = json.root.children[0] as any;
		expect(para.children[0].text).toBe("See ");
		const linkNode = para.children.find((c: any) => c.type === "link");
		expect(linkNode).toBeDefined();
		expect(linkNode.url).toBe("https://example.com/second-brain/");
		expect(linkNode.children[0].text).toBe("Second Brain Guide");

		// Re-open with ⌘K and verify Escape closes
		fireEvent.keyDown(window, {key: "k", metaKey: true});
		const reopened = await screen.findByTestId("smart-link-input");
		fireEvent.keyDown(reopened, {key: "Escape"});
		expect(screen.queryByTestId("smart-link-input")).not.toBeInTheDocument();
	});

	it("rejects unsafe URL schemes and ignores ⌘K when focus is outside the editor", async () => {
		vi.mocked(searchLinks).mockResolvedValue([]);

		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		// When editor is not focused, ⌘K does nothing
		(document.activeElement as HTMLElement | null)?.blur?.();
		fireEvent.keyDown(window, {key: "k", metaKey: true});
		expect(screen.queryByTestId("smart-link-input")).not.toBeInTheDocument();

		// Focus editor and press ⌘K
		screen.getByTestId("editor-editable").focus();
		fireEvent.keyDown(window, {key: "k", metaKey: true});

		const input = await screen.findByTestId("smart-link-input");
		fireEvent.change(input, {target: {value: "javascript:alert(1)"}});
		fireEvent.keyDown(input, {key: "Enter"});

		const json = editor.getEditorState().toJSON();
		const para = json.root.children[0] as any;
		const linkNode = para?.children?.find((c: any) => c.type === "link");
		expect(linkNode).toBeUndefined();
	});
});

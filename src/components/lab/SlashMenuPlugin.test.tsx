// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {LexicalComposer} from "@lexical/react/LexicalComposer";
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin";
import {ContentEditable} from "@lexical/react/LexicalContentEditable";
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary";
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$isParagraphNode,
	type LexicalEditor,
} from "lexical";
import {afterEach, describe, expect, it} from "vitest";
import {useEffect} from "react";
import {SlashMenuPlugin} from "./SlashMenuPlugin";
import {LAB_NODES} from "../../lib/lab/labNodes";
import {$isGhostCardNode} from "../../lib/lab/GhostCardNode";
import {$isHorizontalRuleNode} from "@lexical/extension";

afterEach(cleanup);

function EditorTestRig({
	onEditor,
	initialText = "",
}: {
	onEditor?: (editor: LexicalEditor) => void;
	initialText?: string;
}) {
	const initialConfig = {
		namespace: "TestSlashMenu",
		nodes: LAB_NODES,
		onError: (err: Error) => {
			throw err;
		},
	};

	function InitPlugin() {
		const [editor] = useLexicalComposerContext();
		useEffect(() => {
			onEditor?.(editor);
			if (initialText) {
				editor.update(() => {
					const root = $getRoot();
					root.clear();
					const p = $createParagraphNode();
					const t = $createTextNode(initialText);
					p.append(t);
					root.append(p);
					t.select();
				});
			}
		}, [editor]);
		return null;
	}

	return (
		<LexicalComposer initialConfig={initialConfig}>
			<RichTextPlugin
				contentEditable={<ContentEditable data-testid="test-editor" />}
				placeholder={<div>Placeholder</div>}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<InitPlugin />
			<SlashMenuPlugin />
		</LexicalComposer>
	);
}

describe("SlashMenuPlugin", () => {
	it("renders nothing initially when no slash is typed", () => {
		render(<EditorTestRig initialText="Normal text without slash" />);
		expect(screen.queryByTestId("lexical-lab-slash-menu")).toBeNull();
	});

	it("opens the floating slash menu when '/' is typed at paragraph start", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/");
			p.append(t);
			root.append(p);
			t.select(1, 1);
		});

		await waitFor(() => {
			expect(screen.getByTestId("lexical-lab-slash-menu")).toBeInTheDocument();
		});

		expect(screen.getByText("Primary")).toBeInTheDocument();
		expect(screen.getByText("Embeds")).toBeInTheDocument();
		expect(screen.getByText("Image")).toBeInTheDocument();
		expect(screen.getByText("Divider")).toBeInTheDocument();
	});

	it("filters items based on slash command query (e.g. /call)", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/call");
			p.append(t);
			root.append(p);
			t.select(5, 5);
		});

		await waitFor(() => {
			expect(screen.getByTestId("lexical-lab-slash-menu")).toBeInTheDocument();
		});

		expect(screen.getByText("Callout")).toBeInTheDocument();
		expect(screen.queryByText("Divider")).toBeNull();
	});

	it("inserts card node and trailing paragraph when item is clicked", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/cal");
			p.append(t);
			root.append(p);
			t.select(4, 4);
		});

		await waitFor(() => {
			expect(screen.getByTestId("slash-item-callout")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("slash-item-callout"));

		await waitFor(() => {
			testEditor.getEditorState().read(() => {
				const children = $getRoot().getChildren();
				expect(children.length).toBeGreaterThanOrEqual(2);
				expect($isGhostCardNode(children[0])).toBe(true);
				if ($isGhostCardNode(children[0])) {
					expect(children[0].getCardType()).toBe("callout");
					expect(children[0].getData().calloutEmoji).toBe("💡");
				}
				// Trailing paragraph created
				expect(children[1].getType()).toBe("paragraph");
			});
		});

		expect(screen.queryByTestId("lexical-lab-slash-menu")).toBeNull();
	});

	it("inserts horizontalrule node when Divider item is selected", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/hr");
			p.append(t);
			root.append(p);
			t.select(3, 3);
		});

		await waitFor(() => {
			expect(screen.getByTestId("slash-item-horizontalrule")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("slash-item-horizontalrule"));

		await waitFor(() => {
			testEditor.getEditorState().read(() => {
				const children = $getRoot().getChildren();
				expect($isHorizontalRuleNode(children[0])).toBe(true);
				expect(children[1].getType()).toBe("paragraph");
			});
		});
	});

	it("supports inline argument syntax e.g. /image https://example.com/test.jpg", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/image https://example.com/pic.png");
			p.append(t);
			root.append(p);
			t.select(34, 34);
		});

		await waitFor(() => {
			expect(screen.getByTestId("slash-item-image")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("slash-item-image"));

		await waitFor(() => {
			testEditor.getEditorState().read(() => {
				const children = $getRoot().getChildren();
				expect($isGhostCardNode(children[0])).toBe(true);
				if ($isGhostCardNode(children[0])) {
					expect(children[0].getCardType()).toBe("image");
					expect(children[0].getData().src).toBe("https://example.com/pic.png");
				}
			});
		});
	});

	it("supports inline HTML argument syntax e.g. /html <div>Hello</div>", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/html <div>Hello</div>");
			p.append(t);
			root.append(p);
			t.select(22, 22);
		});

		await waitFor(() => {
			expect(screen.getByTestId("slash-item-html")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTestId("slash-item-html"));

		await waitFor(() => {
			testEditor.getEditorState().read(() => {
				const children = $getRoot().getChildren();
				expect($isGhostCardNode(children[0])).toBe(true);
				if ($isGhostCardNode(children[0])) {
					expect(children[0].getCardType()).toBe("html");
					expect(children[0].getData().html).toBe("<div>Hello</div>");
				}
			});
		});
	});

	it("navigates with keyboard ArrowDown/ArrowUp and inserts with Enter", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/");
			p.append(t);
			root.append(p);
			t.select(1, 1);
		});

		await waitFor(() => {
			expect(screen.getByTestId("lexical-lab-slash-menu")).toBeInTheDocument();
		});

		// Press ArrowDown to select second item (Divider)
		const editorEl = screen.getByTestId("test-editor");
		fireEvent.keyDown(editorEl, {key: "ArrowDown", code: "ArrowDown"});

		await waitFor(() => {
			expect(screen.getByTestId("slash-item-horizontalrule")).toHaveClass("is-selected");
		});

		// Press Enter to insert
		fireEvent.keyDown(editorEl, {key: "Enter", code: "Enter"});

		await waitFor(() => {
			testEditor.getEditorState().read(() => {
				const children = $getRoot().getChildren();
				expect($isHorizontalRuleNode(children[0])).toBe(true);
			});
		});
	});

	it("closes menu when Escape is pressed", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/");
			p.append(t);
			root.append(p);
			t.select(1, 1);
		});

		await waitFor(() => {
			expect(screen.getByTestId("lexical-lab-slash-menu")).toBeInTheDocument();
		});

		const editorEl = screen.getByTestId("test-editor");
		fireEvent.keyDown(editorEl, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByTestId("lexical-lab-slash-menu")).toBeNull();
		});
	});

	it("renders listbox role and option roles with aria-selected", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/");
			p.append(t);
			root.append(p);
			t.select(1, 1);
		});

		await waitFor(() => {
			const menu = screen.getByTestId("lexical-lab-slash-menu");
			expect(menu).toHaveAttribute("role", "listbox");
		});

		const items = screen.getAllByRole("option");
		expect(items.length).toBeGreaterThan(0);
		expect(items[0]).toHaveAttribute("aria-selected", "true");
		if (items.length > 1) {
			expect(items[1]).toHaveAttribute("aria-selected", "false");
		}
	});

	it("does not open menu for sentences after space when command does not match any card", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/hello world this is a normal sentence");
			p.append(t);
			root.append(p);
			t.select(38, 38);
		});

		// Wait briefly to ensure it doesn't open
		await new Promise(r => setTimeout(r, 50));
		expect(screen.queryByTestId("lexical-lab-slash-menu")).toBeNull();
	});

	it("suppresses reopening on Escape until user deletes / or starts a new line", async () => {
		let testEditor!: LexicalEditor;
		render(
			<EditorTestRig
				onEditor={e => {
					testEditor = e;
				}}
			/>,
		);

		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/image");
			p.append(t);
			root.append(p);
			t.select(6, 6);
		});

		await waitFor(() => {
			expect(screen.getByTestId("lexical-lab-slash-menu")).toBeInTheDocument();
		});

		const editorEl = screen.getByTestId("test-editor");
		fireEvent.keyDown(editorEl, {key: "Escape", code: "Escape"});

		await waitFor(() => {
			expect(screen.queryByTestId("lexical-lab-slash-menu")).toBeNull();
		});

		// Type more on the same command line (e.g. /image https://example.com)
		testEditor.update(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			if ($isParagraphNode(p)) {
				p.clear();
				const t = $createTextNode("/image https://example.com");
				p.append(t);
				t.select(26, 26);
			}
		});

		await new Promise(r => setTimeout(r, 50));
		// Menu should remain closed!
		expect(screen.queryByTestId("lexical-lab-slash-menu")).toBeNull();

		// Delete slash
		testEditor.update(() => {
			const root = $getRoot();
			const p = root.getFirstChild();
			if ($isParagraphNode(p)) {
				p.clear();
				const t = $createTextNode("image https://example.com");
				p.append(t);
				t.select(25, 25);
			}
		});

		// Now type / on a fresh line or newly typed /
		testEditor.update(() => {
			const root = $getRoot();
			root.clear();
			const p = $createParagraphNode();
			const t = $createTextNode("/");
			p.append(t);
			root.append(p);
			t.select(1, 1);
		});

		await waitFor(() => {
			expect(screen.getByTestId("lexical-lab-slash-menu")).toBeInTheDocument();
		});
	});
});

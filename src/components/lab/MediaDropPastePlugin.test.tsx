// @vitest-environment jsdom
import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vitest";
import {LexicalComposer} from "@lexical/react/LexicalComposer";
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {RichTextPlugin} from "@lexical/react/LexicalRichTextPlugin";
import {ContentEditable} from "@lexical/react/LexicalContentEditable";
import {LexicalErrorBoundary} from "@lexical/react/LexicalErrorBoundary";
import {
	DROP_COMMAND,
	PASTE_COMMAND,
	type LexicalEditor,
} from "lexical";
import {useEffect} from "react";
import {api, type Site} from "../../lib/api";
import {LAB_NODES} from "../../lib/lab/labNodes";
import {MediaDropPastePlugin} from "./MediaDropPastePlugin";

vi.mock("../../lib/api", async importOriginal => {
	const actual = await importOriginal<typeof import("../../lib/api")>();
	return {
		...actual,
		api: vi.fn(),
	};
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const SITE: Site = {
	base: "https://example.com",
	siteUrl: "https://example.com/",
	title: "Test Site",
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
				namespace: "MediaDropPasteTest",
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
			<MediaDropPastePlugin site={SITE} />
			<EditorCapture onEditor={onEditor} />
		</LexicalComposer>,
	);
}

describe("MediaDropPastePlugin", () => {
	it("pasting an image file inserts an image GhostCardNode and updates its src after upload", async () => {
		vi.mocked(api).mockResolvedValue({
			images: [{url: "https://example.com/content/images/pasted.png"}],
		});

		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		const file = new File(["png-bytes"], "pasted-screenshot.png", {
			type: "image/png",
		});
		const pasteEvent = {
			preventDefault: vi.fn(),
			clipboardData: {
				files: [file],
			},
		} as unknown as ClipboardEvent;

		const handled = editor.dispatchCommand(PASTE_COMMAND, pasteEvent);
		expect(handled).toBe(true);
		expect(pasteEvent.preventDefault).toHaveBeenCalled();

		await waitFor(() => {
			expect(api).toHaveBeenCalledWith(
				SITE,
				"/images/upload/",
				expect.objectContaining({method: "POST"}),
			);
			const json = editor.getEditorState().toJSON();
			const imageCard = json.root.children.find(
				(c: any) => c.type === "ghost-card" && c.cardType === "image",
			) as any;
			expect(imageCard).toBeDefined();
			expect(imageCard.data.src).toBe(
				"https://example.com/content/images/pasted.png",
			);
			expect(imageCard.data.fileName).toBe("pasted-screenshot.png");
		});
	});

	it("dropping an image file inserts an image GhostCardNode and updates its src after upload", async () => {
		vi.mocked(api).mockResolvedValue({
			images: [{url: "https://example.com/content/images/dropped.jpg"}],
		});

		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		const file = new File(["jpg-bytes"], "dropped-photo.jpg", {
			type: "image/jpeg",
		});
		const dropEvent = {
			preventDefault: vi.fn(),
			dataTransfer: {
				files: [file],
			},
		} as unknown as DragEvent;

		const handled = editor.dispatchCommand(DROP_COMMAND, dropEvent);
		expect(handled).toBe(true);
		expect(dropEvent.preventDefault).toHaveBeenCalled();

		await waitFor(() => {
			expect(api).toHaveBeenCalledWith(
				SITE,
				"/images/upload/",
				expect.objectContaining({method: "POST"}),
			);
			const json = editor.getEditorState().toJSON();
			const imageCard = json.root.children.find(
				(c: any) => c.type === "ghost-card" && c.cardType === "image",
			) as any;
			expect(imageCard).toBeDefined();
			expect(imageCard.data.src).toBe(
				"https://example.com/content/images/dropped.jpg",
			);
			expect(imageCard.data.fileName).toBe("dropped-photo.jpg");
		});
	});

	it("dropping a non-image file calls preventDefault() without navigating or inserting an image card", () => {
		let editor!: LexicalEditor;
		renderHarness(e => {
			editor = e;
		});

		const file = new File(["pdf-bytes"], "document.pdf", {
			type: "application/pdf",
		});
		const dropEvent = {
			preventDefault: vi.fn(),
			dataTransfer: {
				files: [file],
			},
		} as unknown as DragEvent;

		const handled = editor.dispatchCommand(DROP_COMMAND, dropEvent);
		expect(handled).toBe(true);
		expect(dropEvent.preventDefault).toHaveBeenCalled();
		expect(api).not.toHaveBeenCalled();

		const json = editor.getEditorState().toJSON();
		const imageCard = json.root.children.find(
			(c: any) => c.type === "ghost-card" && c.cardType === "image",
		);
		expect(imageCard).toBeUndefined();
	});
});

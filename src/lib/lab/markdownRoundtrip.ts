import {createEditor} from "lexical";
import {$convertToMarkdownString, $convertFromMarkdownString} from "@lexical/markdown";
import {wrapUnknownGhostCards} from "./GhostCardNode";
import {LAB_NODES} from "./labNodes";
import {LAB_MARKDOWN_TRANSFORMERS} from "./markdownTransformers";

export function lexicalJsonToMarkdown(lexicalJson: string): string {
	try {
		// Normalize Ghost/Koenig-only nodes (notably `extended-text`) before
		// parsing so their text is not lost or turned into an opaque card.
		const parsed = JSON.parse(lexicalJson);
		const normalized = JSON.stringify(wrapUnknownGhostCards(parsed));
		const editor = createEditor({nodes: LAB_NODES});
		const state = editor.parseEditorState(normalized);
		editor.setEditorState(state);
		let markdown = "";
		editor.getEditorState().read(() => {
			markdown = $convertToMarkdownString(LAB_MARKDOWN_TRANSFORMERS);
		});
		return markdown;
	} catch {
		return "";
	}
}

export function markdownToLexicalJson(md: string): string {
	try {
		const editor = createEditor({nodes: LAB_NODES});
		editor.update(
			() => {
				$convertFromMarkdownString(md, LAB_MARKDOWN_TRANSFORMERS);
			},
			{discrete: true},
		);
		return JSON.stringify(editor.getEditorState().toJSON());
	} catch {
		const editor = createEditor({nodes: LAB_NODES});
		return JSON.stringify(editor.getEditorState().toJSON());
	}
}

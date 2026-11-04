import type {
	DOMExportOutput,
	EditorConfig,
	LexicalEditor,
	LexicalNode,
	NodeKey,
	SerializedLexicalNode,
	Spread,
} from "lexical";
import {DecoratorNode} from "lexical";
import type {JSX} from "react";
import React from "react";

export type SerializedFootnoteReferenceNode = Spread<
	{
		label: string;
	},
	SerializedLexicalNode
>;

export class FootnoteReferenceNode extends DecoratorNode<JSX.Element> {
	__label: string;

	static override getType(): string {
		return "footnote-reference";
	}

	static override clone(node: FootnoteReferenceNode): FootnoteReferenceNode {
		return new FootnoteReferenceNode(node.__label, node.__key);
	}

	constructor(label: string, key?: NodeKey) {
		super(key);
		this.__label = label;
	}

	getLabel(): string {
		return this.__label;
	}

	setLabel(label: string): void {
		const writable = this.getWritable();
		writable.__label = label;
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const element = document.createElement("span");
		element.className = "lexical-lab-fn-ref-wrapper";
		element.setAttribute("data-label", this.__label);
		element.id = `fnref${this.__label}`;
		return element;
	}

	override updateDOM(
		prevNode: FootnoteReferenceNode,
		dom: HTMLElement,
	): boolean {
		if (prevNode.__label !== this.__label) {
			dom.setAttribute("data-label", this.__label);
			dom.id = `fnref${this.__label}`;
		}
		return false;
	}

	static override importJSON(
		serializedNode: SerializedFootnoteReferenceNode,
	): FootnoteReferenceNode {
		return $createFootnoteReferenceNode(serializedNode.label);
	}

	override exportJSON(): SerializedFootnoteReferenceNode {
		return {
			type: "footnote-reference",
			label: this.__label,
			version: 1,
		};
	}

	override exportDOM(): DOMExportOutput {
		const element = document.createElement("sup");
		element.className = "lexical-lab-fn-ref";
		element.setAttribute("data-label", this.__label);
		const link = document.createElement("a");
		link.href = `#fn${this.__label}`;
		link.textContent = `[${this.__label}]`;
		element.appendChild(link);
		return {element};
	}

	override getTextContent(): string {
		return `[^${this.__label}]`;
	}

	override isInline(): boolean {
		return true;
	}

	override isKeyboardSelectable(): boolean {
		return true;
	}

	override decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
		return React.createElement(FootnoteReferenceComponent, {
			label: this.__label,
			nodeKey: this.__key,
		});
	}
}

function FootnoteReferenceComponent({
	label,
}: {
	label: string;
	nodeKey: NodeKey;
}) {
	const handleClick = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (typeof window !== "undefined") {
			window.dispatchEvent(
				new CustomEvent("lexical-lab:jump-footnote", {detail: {label}}),
			);
		}
	};

	return React.createElement(
		"sup",
		{
			className: "lexical-lab-fn-ref",
			"data-label": label,
			onClick: handleClick,
			title: `Jump to footnote [^${label}]`,
		},
		`[${label}]`,
	);
}

export function $createFootnoteReferenceNode(
	label: string,
): FootnoteReferenceNode {
	return new FootnoteReferenceNode(label);
}

export function $isFootnoteReferenceNode(
	node: LexicalNode | null | undefined,
): node is FootnoteReferenceNode {
	return node instanceof FootnoteReferenceNode;
}

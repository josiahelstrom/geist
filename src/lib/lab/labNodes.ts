import {HeadingNode, QuoteNode} from "@lexical/rich-text";
import {HorizontalRuleNode} from "@lexical/extension";
import {ListNode, ListItemNode} from "@lexical/list";
import {LinkNode, AutoLinkNode} from "@lexical/link";
import {CodeNode} from "@lexical/code";
import {GhostCardNode} from "./GhostCardNode";
import {FootnoteReferenceNode} from "./FootnoteReferenceNode";

export const LAB_NODES = [
	HeadingNode,
	QuoteNode,
	HorizontalRuleNode,
	ListNode,
	ListItemNode,
	LinkNode,
	AutoLinkNode,
	CodeNode,
	GhostCardNode,
	FootnoteReferenceNode,
];

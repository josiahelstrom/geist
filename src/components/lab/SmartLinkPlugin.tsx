import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {
	$createLinkNode,
	$toggleLink,
	TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	COMMAND_PRIORITY_LOW,
	PASTE_COMMAND,
} from "lexical";
import {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import type {Site} from "../../lib/api";
import {LabSiteContext} from "../../lib/lab/labContext";
import {
	searchLinks,
	type LinkGroup,
	type LinkItem,
} from "../../lib/posts";

export type SmartLinkPluginProps = {
	site?: Site;
};

type PopoverPosition = {
	top: number;
	left: number;
};

type SavedRange = {
	anchorKey: string;
	anchorOffset: number;
	anchorType: "text" | "element";
	focusKey: string;
	focusOffset: number;
	focusType: "text" | "element";
	isCollapsed: boolean;
};

const SMART_URL_REGEX = /^(?:https?:\/\/|mailto:)\S+$/i;
const SAFE_LINK_URL_REGEX = /^(?:https?:\/\/|mailto:|\/|#)/i;
const WIKILINK_TRIGGER_REGEX = /\[\[([^\][\n]*)$/;

export function SmartLinkPlugin({site}: SmartLinkPluginProps) {
	const [editor] = useLexicalComposerContext();
	const labSiteContext = useContext(LabSiteContext);
	const effectiveSite = site ?? labSiteContext?.site ?? undefined;

	const [isOpen, setIsOpen] = useState(false);
	const [mode, setMode] = useState<"cmd-k" | "wikilink">("cmd-k");
	const [inputValue, setInputValue] = useState("");
	const [groups, setGroups] = useState<LinkGroup[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [position, setPosition] = useState<PopoverPosition>({top: 120, left: 120});

	const inputRef = useRef<HTMLInputElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const savedRangeRef = useRef<SavedRange | null>(null);
	const wikilinkNodeKeyRef = useRef<string | null>(null);
	const dismissedWikilinkTextRef = useRef<string | null>(null);

	const flatItems: LinkItem[] = useMemo(() => {
		return groups.flatMap(g => g.items);
	}, [groups]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [inputValue, groups]);

	const computePopoverPosition = useCallback((): PopoverPosition => {
		let top = 120;
		let left = 120;
		const domSelection = window.getSelection();
		if (domSelection && domSelection.rangeCount > 0) {
			const range = domSelection.getRangeAt(0);
			if (typeof range.getBoundingClientRect === "function") {
				const rect = range.getBoundingClientRect();
				if (rect.top > 0 || rect.left > 0 || rect.bottom > 0) {
					top = rect.bottom + 8;
					left = Math.min(Math.max(rect.left, 20), window.innerWidth - 340);
				}
			}
		}
		return {top, left};
	}, []);

	const captureCurrentSelection = useCallback(() => {
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) {
				savedRangeRef.current = {
					anchorKey: selection.anchor.key,
					anchorOffset: selection.anchor.offset,
					anchorType: selection.anchor.type,
					focusKey: selection.focus.key,
					focusOffset: selection.focus.offset,
					focusType: selection.focus.type,
					isCollapsed: selection.isCollapsed(),
				};
			} else {
				savedRangeRef.current = null;
			}
		});
	}, [editor]);

	const closePopover = useCallback(
		(restoreFocus = true) => {
			if (mode === "wikilink") {
				editor.getEditorState().read(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						const topLevel = selection.anchor.getNode().getTopLevelElement();
						if ($isParagraphNode(topLevel)) {
							dismissedWikilinkTextRef.current = topLevel.getTextContent();
						}
					}
				});
			}
			setIsOpen(false);
			setInputValue("");
			setGroups([]);
			if (restoreFocus) {
				editor.getRootElement()?.focus();
			}
		},
		[editor, mode],
	);

	// 1. Paste-URL-over-selection to Link
	useEffect(() => {
		return editor.registerCommand(
			PASTE_COMMAND,
			event => {
				const clipboardData =
					event && "clipboardData" in event ? event.clipboardData : null;
				const pastedText = clipboardData?.getData("text/plain")?.trim() ?? "";
				if (!pastedText || !SMART_URL_REGEX.test(pastedText)) {
					return false;
				}
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || selection.isCollapsed()) {
					return false;
				}
				event.preventDefault();
				const handled = editor.dispatchCommand(TOGGLE_LINK_COMMAND, pastedText);
				if (!handled) {
					$toggleLink(pastedText);
				}
				return true;
			},
			COMMAND_PRIORITY_LOW,
		);
	}, [editor]);

	// 2. Open popover on ⌘K / Ctrl+K
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.isComposing) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				if (!editor.getRootElement()?.contains(document.activeElement)) {
					return;
				}
				e.preventDefault();
				captureCurrentSelection();
				setMode("cmd-k");
				setInputValue("");
				setPosition(computePopoverPosition());
				setIsOpen(true);
				queueMicrotask(() => {
					inputRef.current?.focus();
				});
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [editor, captureCurrentSelection, computePopoverPosition]);

	// 3. Detect typing `[[` in a paragraph
	useEffect(() => {
		return editor.registerUpdateListener(({editorState}) => {
			editorState.read(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
					return;
				}
				const anchorNode = selection.anchor.getNode();
				const topLevel = anchorNode.getTopLevelElement();
				if (!$isParagraphNode(topLevel) || !$isTextNode(anchorNode)) {
					dismissedWikilinkTextRef.current = null;
					return;
				}

				const paraText = topLevel.getTextContent();
				if (
					dismissedWikilinkTextRef.current !== null &&
					paraText === dismissedWikilinkTextRef.current
				) {
					return;
				}
				dismissedWikilinkTextRef.current = null;

				const textBeforeCaret = anchorNode
					.getTextContent()
					.slice(0, selection.anchor.offset);
				const match = textBeforeCaret.match(WIKILINK_TRIGGER_REGEX);
				if (!match) {
					return;
				}

				wikilinkNodeKeyRef.current = anchorNode.getKey();
				savedRangeRef.current = {
					anchorKey: selection.anchor.key,
					anchorOffset: selection.anchor.offset,
					anchorType: selection.anchor.type,
					focusKey: selection.focus.key,
					focusOffset: selection.focus.offset,
					focusType: selection.focus.type,
					isCollapsed: true,
				};
				setMode("wikilink");
				setInputValue(match[1] ?? "");
				setPosition(computePopoverPosition());
				setIsOpen(true);
				queueMicrotask(() => {
					inputRef.current?.focus();
				});
			});
		});
	}, [editor, computePopoverPosition]);

	// 4. Query site links when popover is open and input is a search term (or empty)
	useEffect(() => {
		if (!isOpen || !effectiveSite) {
			return;
		}
		const trimmed = inputValue.trim();
		if (SMART_URL_REGEX.test(trimmed)) {
			setGroups([]);
			return;
		}
		let cancelled = false;
		const runSearch = () => {
			searchLinks(effectiveSite, trimmed)
				.then(res => {
					if (!cancelled) {
						setGroups(res);
					}
				})
				.catch(() => {
					if (!cancelled) {
						setGroups([]);
					}
				});
		};
		if (trimmed.length === 0) {
			runSearch();
			return () => {
				cancelled = true;
			};
		}
		const timer = setTimeout(runSearch, 180);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [isOpen, effectiveSite, inputValue]);

	const applyLink = useCallback(
		(url: string, label?: string) => {
			const cleanUrl = url.trim();
			if (!cleanUrl || !SAFE_LINK_URL_REGEX.test(cleanUrl)) {
				return;
			}
			const linkText = label?.trim() || cleanUrl;

			editor.update(() => {
				if (mode === "wikilink") {
					let targetNode = wikilinkNodeKeyRef.current
						? $getNodeByKey(wikilinkNodeKeyRef.current)
						: null;
					if (!$isTextNode(targetNode)) {
						const sel = $getSelection();
						if ($isRangeSelection(sel)) {
							const node = sel.anchor.getNode();
							if ($isTextNode(node)) {
								targetNode = node;
							}
						}
					}

					const linkNode = $createLinkNode(cleanUrl);
					linkNode.append($createTextNode(linkText));

					if ($isTextNode(targetNode)) {
						const text = targetNode.getTextContent();
						const match = text.match(/\[\[([^\][\n]*)$/);
						if (match && match.index !== undefined) {
							const start = match.index;
							const end = start + match[0].length;
							if (start === 0 && end === text.length) {
								targetNode.replace(linkNode);
							} else if (start === 0) {
								const [matched] = targetNode.splitText(end);
								matched.replace(linkNode);
							} else {
								const [, matched] = targetNode.splitText(start, end);
								matched.replace(linkNode);
							}
							linkNode.selectEnd();
							return;
						}
					}

					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertNodes([linkNode]);
					}
					return;
				}

				// cmd-k mode
				let selection = $getSelection();
				const saved = savedRangeRef.current;
				if (
					saved &&
					(!$isRangeSelection(selection) ||
						(!saved.isCollapsed && selection.isCollapsed()))
				) {
					const anchorExists = $getNodeByKey(saved.anchorKey) !== null;
					const focusExists = $getNodeByKey(saved.focusKey) !== null;
					if (anchorExists && focusExists) {
						const restored = $createRangeSelection();
						restored.anchor.set(
							saved.anchorKey,
							saved.anchorOffset,
							saved.anchorType,
						);
						restored.focus.set(
							saved.focusKey,
							saved.focusOffset,
							saved.focusType,
						);
						$setSelection(restored);
						selection = restored;
					}
				}

				if ($isRangeSelection(selection) && !selection.isCollapsed()) {
					const handled = editor.dispatchCommand(TOGGLE_LINK_COMMAND, cleanUrl);
					if (!handled) {
						$toggleLink(cleanUrl);
					}
					return;
				}

				const linkNode = $createLinkNode(cleanUrl);
				linkNode.append($createTextNode(linkText));

				if ($isRangeSelection(selection)) {
					selection.insertNodes([linkNode]);
				} else {
					const root = $getRoot();
					const lastChild = root.getLastChild();
					if ($isElementNode(lastChild)) {
						lastChild.append(linkNode);
						linkNode.selectEnd();
					} else {
						const p = $createParagraphNode();
						p.append(linkNode);
						root.append(p);
						linkNode.selectEnd();
					}
				}
			});

			closePopover(true);
		},
		[editor, mode, closePopover],
	);

	// Close on click outside
	useEffect(() => {
		if (!isOpen) return;
		function onMouseDown(e: MouseEvent) {
			if (
				popoverRef.current &&
				e.target instanceof Node &&
				!popoverRef.current.contains(e.target)
			) {
				closePopover(false);
			}
		}
		document.addEventListener("mousedown", onMouseDown);
		return () => document.removeEventListener("mousedown", onMouseDown);
	}, [isOpen, closePopover]);

	if (!isOpen) {
		return null;
	}

	let optionIndexTracker = 0;

	return (
		<div
			ref={popoverRef}
			className="lexical-lab-smart-link-popover"
			style={{top: `${position.top}px`, left: `${position.left}px`}}
			data-testid="smart-link-popover"
		>
			<input
				ref={inputRef}
				type="text"
				className="lexical-lab-smart-link-input"
				placeholder="Paste URL or search your posts..."
				data-testid="smart-link-input"
				value={inputValue}
				onChange={e => setInputValue(e.target.value)}
				onKeyDown={e => {
					if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						closePopover(true);
						return;
					}
					if (e.key === "ArrowDown") {
						if (flatItems.length > 0) {
							e.preventDefault();
							setSelectedIndex(prev => (prev + 1) % flatItems.length);
						}
						return;
					}
					if (e.key === "ArrowUp") {
						if (flatItems.length > 0) {
							e.preventDefault();
							setSelectedIndex(
								prev => (prev - 1 + flatItems.length) % flatItems.length,
							);
						}
						return;
					}
					if (e.key === "Enter") {
						e.preventDefault();
						const trimmed = inputValue.trim();
						if (SMART_URL_REGEX.test(trimmed)) {
							applyLink(trimmed, trimmed);
							return;
						}
						const selected = flatItems[selectedIndex];
						if (selected) {
							applyLink(selected.url, selected.title);
							return;
						}
						if (trimmed) {
							const normalizedUrl =
								/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
								trimmed.startsWith("/") ||
								trimmed.startsWith("#")
									? trimmed
									: `https://${trimmed}`;
							applyLink(normalizedUrl, trimmed);
						}
					}
				}}
			/>

			{flatItems.length > 0 && (
				<div
					className="lexical-lab-smart-link-results"
					role="listbox"
					data-testid="smart-link-results"
				>
					{groups.map(group => (
						<div key={group.label} className="lexical-lab-slash-section">
							<div className="lexical-lab-slash-section-header">
								{group.label}
							</div>
							{group.items.map(item => {
								const idx = optionIndexTracker++;
								const isSelected = idx === selectedIndex;
								return (
									<div
										key={`${group.label}-${item.url}-${item.title}`}
										className={`lexical-lab-slash-item ${
											isSelected ? "is-selected" : ""
										}`}
										role="option"
										aria-selected={isSelected}
										data-testid={`smart-link-option-${idx}`}
										onMouseEnter={() => setSelectedIndex(idx)}
										onMouseDown={e => {
											e.preventDefault();
											applyLink(item.url, item.title);
										}}
										onClick={() => applyLink(item.url, item.title)}
									>
										<div className="lexical-lab-slash-item-main">
											<span className="lexical-lab-slash-item-label">
												{item.title}
											</span>
											<span className="lexical-lab-slash-item-desc">
												{item.metaText ?? item.url}
											</span>
										</div>
									</div>
								);
							})}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

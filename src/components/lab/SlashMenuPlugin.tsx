import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$getSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
} from "lexical";
import {$createHorizontalRuleNode} from "@lexical/extension";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {Site} from "../../lib/api";
import {
	DEFAULT_CARD_PAYLOADS,
	filterCardMenu,
	normalizeCardMenuContext,
	type CardMenuGroup,
	type LabCardMenuEntry,
} from "../../lib/lab/ghostCardCatalog";
import {$createGhostCardNode} from "../../lib/lab/GhostCardNode";

export type SlashMenuPluginProps = {
	site?: Site;
};

type MenuPosition = {
	top: number;
	left: number;
};

export function SlashMenuPlugin({site}: SlashMenuPluginProps) {
	const [editor] = useLexicalComposerContext();
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [arg, setArg] = useState("");
	const [position, setPosition] = useState<MenuPosition | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const dismissedTextRef = useRef<string | null>(null);
	const dismissedNodeKeyRef = useRef<string | null>(null);

	const groups: CardMenuGroup[] = useMemo(() => {
		if (!isOpen) return [];
		return filterCardMenu(query, site);
	}, [isOpen, query, site]);

	const flatItems: LabCardMenuEntry[] = useMemo(() => {
		return groups.flatMap(g => g.items);
	}, [groups]);

	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	const insertItem = useCallback(
		(item: LabCardMenuEntry, inlineArg: string) => {
			editor.update(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

				const anchorNode = selection.anchor.getNode();
				const paragraph = anchorNode.getTopLevelElement();
				if (!$isParagraphNode(paragraph)) return;

				if (item.cardType === "horizontalrule") {
					const hrNode = $createHorizontalRuleNode();
					paragraph.replace(hrNode);

					const next = hrNode.getNextSibling();
					if (next !== null) {
						if ($isElementNode(next)) {
							next.selectStart();
						} else {
							hrNode.selectNext();
						}
					} else {
						const trailing = $createParagraphNode();
						hrNode.insertAfter(trailing);
						trailing.selectStart();
					}
					return;
				}

				const defaults = DEFAULT_CARD_PAYLOADS[item.cardType] ?? {
					type: item.cardType,
					version: 1,
				};
				const ctx = normalizeCardMenuContext(site);
				const insertDefaults = item.insertParams?.(ctx) ?? {};

				const argData: Record<string, unknown> = {};
				const trimmedArg = inlineArg.trim();
				if (trimmedArg) {
					if (item.queryParams && item.queryParams.length > 0) {
						argData[item.queryParams[0]] = trimmedArg;
					} else if (item.cardType === "callout") {
						argData.calloutText = trimmedArg;
					} else if (item.cardType === "button") {
						if (trimmedArg.startsWith("http://") || trimmedArg.startsWith("https://")) {
							argData.buttonUrl = trimmedArg;
						} else {
							argData.buttonText = trimmedArg;
						}
					} else if (item.cardType === "bookmark" || item.cardType === "embed") {
						argData.url = trimmedArg;
					} else if (
						item.cardType === "image" ||
						item.cardType === "video" ||
						item.cardType === "audio" ||
						item.cardType === "file"
					) {
						argData.src = trimmedArg;
					} else if (item.cardType === "markdown") {
						argData.markdown = trimmedArg;
					} else if (item.cardType === "codeblock") {
						argData.code = trimmedArg;
					} else if (item.cardType === "html") {
						argData.html = trimmedArg;
					}
				}

				const payload = {
					...defaults,
					...insertDefaults,
					...argData,
				};

				const card = $createGhostCardNode(item.cardType, payload);
				paragraph.replace(card);

				const next = card.getNextSibling();
				if (next !== null) {
					if ($isElementNode(next)) {
						next.selectStart();
					} else {
						card.selectNext();
					}
				} else {
					const trailing = $createParagraphNode();
					card.insertAfter(trailing);
					trailing.selectStart();
				}
			});

			setIsOpen(false);
			setPosition(null);
			dismissedTextRef.current = null;
			dismissedNodeKeyRef.current = null;
		},
		[editor, site],
	);

	// Detect typing slash at start of paragraph
	const checkSlashMenu = useCallback(() => {
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
				setIsOpen(false);
				return;
			}

			const anchorNode = selection.anchor.getNode();
			const topLevel = anchorNode.getTopLevelElement();
			if (!$isParagraphNode(topLevel)) {
				dismissedTextRef.current = null;
				dismissedNodeKeyRef.current = null;
				setIsOpen(false);
				return;
			}

			const currentKey = topLevel.getKey();
			if (dismissedNodeKeyRef.current && dismissedNodeKeyRef.current !== currentKey) {
				dismissedTextRef.current = null;
				dismissedNodeKeyRef.current = null;
			}

			const text = topLevel.getTextContent();
			if (!text.startsWith("/")) {
				dismissedTextRef.current = null;
				dismissedNodeKeyRef.current = null;
				setIsOpen(false);
				return;
			}

			// Escape suppression check
			if (dismissedTextRef.current !== null) {
				const dismissed = dismissedTextRef.current;
				const dismissedCmd = dismissed.slice(1).split(" ")[0];
				const currentCmd = text.slice(1).split(" ")[0];
				if (
					text === dismissed ||
					(text.startsWith(dismissed) &&
						(dismissedCmd === "" || currentCmd === dismissedCmd))
				) {
					setIsOpen(false);
					return;
				}
				dismissedTextRef.current = null;
				dismissedNodeKeyRef.current = null;
			}

			// Parse command and argument: e.g. "/image https://..." or "/callout Hello"
			const withoutSlash = text.slice(1);
			const spaceIndex = withoutSlash.indexOf(" ");
			let cmd = withoutSlash;
			let currentArg = "";
			if (spaceIndex !== -1) {
				const cmdToken = withoutSlash.slice(0, spaceIndex);
				if (!cmdToken) {
					setIsOpen(false);
					return;
				}
				// Verify cmdToken matches a card shortcut/keyword
				const matches = filterCardMenu(cmdToken, site);
				if (!matches.some(g => g.items.length > 0)) {
					setIsOpen(false);
					return;
				}
				cmd = cmdToken;
				currentArg = withoutSlash.slice(spaceIndex + 1);
			} else if (cmd) {
				const matches = filterCardMenu(cmd, site);
				if (!matches.some(g => g.items.length > 0)) {
					setIsOpen(false);
					return;
				}
			}

			setQuery(cmd);
			setArg(currentArg);

			// Calculate menu position right below the cursor only when menu is opening/open
			let top = 100;
			let left = 100;
			const domSelection = window.getSelection();
			if (domSelection && domSelection.rangeCount > 0) {
				const range = domSelection.getRangeAt(0);
				if (typeof range.getBoundingClientRect === "function") {
					const rect = range.getBoundingClientRect();
					top = rect.bottom + 6;
					left = Math.min(Math.max(rect.left, 20), window.innerWidth - 320);
				} else {
					const domElement = editor.getElementByKey(topLevel.getKey());
					if (domElement && typeof domElement.getBoundingClientRect === "function") {
						const rect = domElement.getBoundingClientRect();
						top = rect.bottom + 6;
						left = Math.min(Math.max(rect.left, 20), window.innerWidth - 320);
					}
				}
			}

			setPosition(prev => {
				if (prev && prev.top === top && prev.left === left) {
					return prev;
				}
				return {top, left};
			});

			setIsOpen(true);
		});
	}, [editor, site]);

	useEffect(() => {
		return editor.registerUpdateListener(() => {
			checkSlashMenu();
		});
	}, [editor, checkSlashMenu]);

	// Keyboard navigation commands
	useEffect(() => {
		if (!isOpen) return;

		const unregisterArrowDown = editor.registerCommand(
			KEY_ARROW_DOWN_COMMAND,
			event => {
				if (flatItems.length === 0) return false;
				event?.preventDefault();
				setSelectedIndex(prev => (prev + 1) % flatItems.length);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const unregisterArrowUp = editor.registerCommand(
			KEY_ARROW_UP_COMMAND,
			event => {
				if (flatItems.length === 0) return false;
				event?.preventDefault();
				setSelectedIndex(
					prev => (prev - 1 + flatItems.length) % flatItems.length,
				);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const unregisterEnter = editor.registerCommand(
			KEY_ENTER_COMMAND,
			event => {
				if (flatItems.length === 0) return false;
				event?.preventDefault();
				const selected = flatItems[selectedIndex];
				if (selected) {
					insertItem(selected, arg);
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);

		const unregisterEscape = editor.registerCommand(
			KEY_ESCAPE_COMMAND,
			event => {
				event?.preventDefault();
				editor.getEditorState().read(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						const anchorNode = selection.anchor.getNode();
						const topLevel = anchorNode.getTopLevelElement();
						if ($isParagraphNode(topLevel)) {
							dismissedTextRef.current = topLevel.getTextContent();
							dismissedNodeKeyRef.current = topLevel.getKey();
						}
					}
				});
				setIsOpen(false);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);

		return () => {
			unregisterArrowDown();
			unregisterArrowUp();
			unregisterEnter();
			unregisterEscape();
		};
	}, [editor, isOpen, flatItems, selectedIndex, arg, insertItem]);

	// Auto-scroll selected item into view
	useEffect(() => {
		if (!menuRef.current) return;
		const activeEl = menuRef.current.querySelector<HTMLElement>(
			".lexical-lab-slash-item.is-selected",
		);
		if (activeEl && typeof activeEl.scrollIntoView === "function") {
			activeEl.scrollIntoView({block: "nearest"});
		}
	}, [selectedIndex]);

	if (!isOpen || !position || flatItems.length === 0) {
		return null;
	}

	let currentIndexTracker = 0;

	return (
		<div
			ref={menuRef}
			className="lexical-lab-slash-menu"
			style={{top: `${position.top}px`, left: `${position.left}px`}}
			data-testid="lexical-lab-slash-menu"
			role="listbox"
		>
			{groups.map(group => (
				<div key={group.section} className="lexical-lab-slash-section">
					<div className="lexical-lab-slash-section-header">
						{group.section}
					</div>
					{group.items.map(item => {
						const index = currentIndexTracker++;
						const isSelected = index === selectedIndex;
						return (
							<div
								key={item.id}
								className={`lexical-lab-slash-item ${
									isSelected ? "is-selected" : ""
								}`}
								onClick={() => insertItem(item, arg)}
								onMouseEnter={() => setSelectedIndex(index)}
								data-testid={`slash-item-${item.id}`}
								role="option"
								aria-selected={isSelected}
							>
								<div className="lexical-lab-slash-item-main">
									<span className="lexical-lab-slash-item-label">
										{item.label}
									</span>
									<span className="lexical-lab-slash-item-desc">
										{item.desc}
									</span>
								</div>
								<div className="lexical-lab-slash-item-shortcut">
									{item.shortcut}
								</div>
							</div>
						);
					})}
				</div>
			))}
		</div>
	);
}
